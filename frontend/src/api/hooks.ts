import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  changePassword,
  getMe,
  login,
  logout,
  register,
  requestEmailVerification,
  requestPasswordReset,
  resetPassword,
  verifyEmail,
} from "./auth";
import {
  claimAgent,
  completeFileUpload,
  createModerationRule,
  createUploadIntent,
  createRoom,
  deleteModerationRule,
  dissolveRoom,
  getAgentAccess,
  getAttachment,
  getConnector,
  grantAgentToUser,
  joinRoom,
  listAttachments,
  listMembers,
  listMessages,
  listModerationRules,
  listPresence,
  listPublicRooms,
  listRooms,
  removeRoomMember,
  requestAgentCollaboration,
  respondToAgentCollaboration,
  revokeAgentCollaboration,
  revokeAgentGrant,
  rotateInvite,
  sendMessage,
  uploadToPresignedUrl,
  updateRoom,
} from "./rooms";
import { ApiError } from "./client";
import type {
  AgentTaskInput,
  ModerationAction,
  LoginInput,
  Message,
  RegisterInput,
  SendMessageResult,
  TextMessageInput,
  RoomVisibility,
  UpdateRoomInput,
} from "./types";
import { useMessageStore } from "../stores/messageStore";
import { useMemberStore } from "../stores/memberStore";
import { useDeliveryStore } from "../stores/deliveryStore";
import { useTokenStore } from "../stores/tokenStore";

const AUTH_KEYS = {
  me: ["auth", "me"] as const,
  rooms: ["rooms"] as const,
  publicRooms: ["public-rooms"] as const,
  members: (roomId: string) => ["rooms", roomId, "members"] as const,
  presence: (roomId: string) => ["rooms", roomId, "presence"] as const,
  connector: (roomId: string) => ["rooms", roomId, "connector"] as const,
  messages: (roomId: string) => ["rooms", roomId, "messages"] as const,
  agentAccess: (roomId: string) => ["rooms", roomId, "agent-access"] as const,
  attachment: (roomId: string, attachmentId: string) =>
    ["rooms", roomId, "attachments", attachmentId] as const,
  attachments: (roomId: string) => ["rooms", roomId, "attachments"] as const,
  moderation: (roomId: string) => ["rooms", roomId, "moderation"] as const,
};

/**
 * True when an ApiError means the account session itself is invalid and the
 * local token must be cleared (per the integration contract, NOT for
 * 401 INVALID_TOKEN which is room-scoped).
 */
export function isSessionInvalid(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    (error.code === "INVALID_SESSION" || error.code === "AUTH_REQUIRED")
  );
}

function useAuthToken(): string | null {
  return useTokenStore((state) => state.token);
}

/** Restores the login state at startup: validates the stored token via /auth/me. */
export function useCurrentUser() {
  const token = useAuthToken();
  return useQuery({
    queryKey: AUTH_KEYS.me,
    queryFn: () => getMe(token as string),
    enabled: Boolean(token),
    retry: false,
  });
}

export function useLogin() {
  const setSession = useTokenStore((state) => state.setSession);
  return useMutation({
    mutationFn: (input: LoginInput) => login(input),
    onSuccess: (access) =>
      setSession(access.accessToken, access.expiresAt, access.user),
  });
}

export function useRegister() {
  const setSession = useTokenStore((state) => state.setSession);
  return useMutation({
    mutationFn: (input: RegisterInput) => register(input),
    onSuccess: (access) =>
      setSession(access.accessToken, access.expiresAt, access.user),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const token = useAuthToken();
  const clearSession = useTokenStore((state) => state.clearSession);
  return useMutation({
    mutationFn: () => (token ? logout(token) : Promise.resolve()),
    onSettled: () => {
      clearSession();
      void queryClient.clear();
      navigate("/login", { replace: true });
    },
  });
}

export function useRequestEmailVerification() {
  const token = useAuthToken();
  return useMutation({
    mutationFn: () => requestEmailVerification(token as string),
  });
}

export function useVerifyEmail() {
  const token = useAuthToken();
  const setUser = useTokenStore((state) => state.setUser);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => verifyEmail(token as string, code),
    onSuccess: ({ user }) => {
      setUser(user);
      queryClient.setQueryData(AUTH_KEYS.me, { user });
    },
  });
}

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: (email: string) => requestPasswordReset(email),
  });
}

export function useResetPassword() {
  return useMutation({ mutationFn: resetPassword });
}

export function useChangePassword() {
  const token = useAuthToken();
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      changePassword(token as string, input),
  });
}

export function useRooms() {
  const token = useAuthToken();
  return useQuery({
    queryKey: AUTH_KEYS.rooms,
    queryFn: () => listRooms(token as string),
    enabled: Boolean(token),
  });
}

export function useCreateRoom() {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; visibility: RoomVisibility }) =>
      createRoom(token as string, input.name, input.visibility),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.rooms }),
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.publicRooms }),
      ]);
    },
  });
}

export function usePublicRooms() {
  return useQuery({
    queryKey: AUTH_KEYS.publicRooms,
    queryFn: listPublicRooms,
  });
}

export function useUpdateRoom(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateRoomInput) =>
      updateRoom(token as string, roomId, input),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.rooms }),
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.publicRooms }),
      ]);
    },
  });
}

export function useDissolveRoom(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => dissolveRoom(token as string, roomId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.rooms }),
        queryClient.invalidateQueries({ queryKey: AUTH_KEYS.publicRooms }),
      ]);
    },
  });
}

export function useJoinRoom(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { inviteCode?: string; displayName: string }) =>
      joinRoom(token as string, roomId, {
        ...(input.inviteCode ? { inviteCode: input.inviteCode } : {}),
        displayName: input.displayName,
        actorType: "human",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: AUTH_KEYS.rooms });
    },
  });
}

export function useJoinPublicRoom() {
  const token = useAuthToken();
  const displayName = useTokenStore((state) => state.user?.displayName ?? "");
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roomId: string) =>
      joinRoom(token as string, roomId, {
        displayName,
        actorType: "human",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: AUTH_KEYS.rooms });
    },
  });
}

export function useRemoveMember(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      removeRoomMember(token as string, roomId, memberId),
    onSuccess: async (_result, memberId) => {
      useMemberStore.getState().removeMember(memberId);
      await queryClient.invalidateQueries({
        queryKey: AUTH_KEYS.members(roomId),
      });
    },
  });
}

export function useMembers(roomId: string, enabled = true) {
  const token = useAuthToken();
  const setMembers = useMemberStore((state) => state.setMembers);
  return useQuery({
    queryKey: AUTH_KEYS.members(roomId),
    queryFn: async () => {
      const result = await listMembers(token as string, roomId);
      setMembers(result.items);
      return result.items;
    },
    enabled: Boolean(token) && Boolean(roomId) && enabled,
  });
}

export function usePresence(roomId: string, enabled = true) {
  const token = useAuthToken();
  const setPresence = useMemberStore((state) => state.setPresence);
  return useQuery({
    queryKey: AUTH_KEYS.presence(roomId),
    queryFn: async () => {
      const result = await listPresence(token as string, roomId);
      for (const item of result.items) {
        setPresence(item.memberId, item.online);
      }
      return result.items;
    },
    enabled: Boolean(token) && Boolean(roomId) && enabled,
    refetchInterval: 30_000,
  });
}

export function useConnector(roomId: string, enabled = true) {
  const token = useAuthToken();
  return useQuery({
    queryKey: AUTH_KEYS.connector(roomId),
    queryFn: () => getConnector(token as string, roomId),
    enabled: Boolean(token) && Boolean(roomId) && enabled,
    retry: false,
  });
}

export function useAgentAccess(roomId: string, enabled = true) {
  const token = useAuthToken();
  return useQuery({
    queryKey: AUTH_KEYS.agentAccess(roomId),
    queryFn: () => getAgentAccess(token as string, roomId),
    enabled: Boolean(token) && Boolean(roomId) && enabled,
    retry: false,
  });
}

function useInvalidateAgentAccess(roomId: string) {
  const queryClient = useQueryClient();
  return async () => {
    await queryClient.invalidateQueries({
      queryKey: AUTH_KEYS.agentAccess(roomId),
    });
  };
}

export function useClaimAgent(roomId: string) {
  const token = useAuthToken();
  const invalidate = useInvalidateAgentAccess(roomId);
  return useMutation({
    mutationFn: (input: { agentId: string; claimCode: string }) =>
      claimAgent(token as string, roomId, input.agentId, input.claimCode),
    onSuccess: invalidate,
  });
}

export function useGrantAgent(roomId: string) {
  const token = useAuthToken();
  const invalidate = useInvalidateAgentAccess(roomId);
  return useMutation({
    mutationFn: (input: { agentId: string; granteeMemberId: string }) =>
      grantAgentToUser(
        token as string,
        roomId,
        input.agentId,
        input.granteeMemberId,
      ),
    onSuccess: invalidate,
  });
}

export function useRevokeAgentGrant(roomId: string) {
  const token = useAuthToken();
  const invalidate = useInvalidateAgentAccess(roomId);
  return useMutation({
    mutationFn: (input: { agentId: string; grantId: string }) =>
      revokeAgentGrant(token as string, roomId, input.agentId, input.grantId),
    onSuccess: invalidate,
  });
}

export function useRequestAgentCollaboration(roomId: string) {
  const token = useAuthToken();
  const invalidate = useInvalidateAgentAccess(roomId);
  return useMutation({
    mutationFn: (input: {
      requesterAgentMemberId: string;
      targetAgentMemberId: string;
    }) =>
      requestAgentCollaboration(
        token as string,
        roomId,
        input.requesterAgentMemberId,
        input.targetAgentMemberId,
      ),
    onSuccess: invalidate,
  });
}

export function useRespondAgentCollaboration(roomId: string) {
  const token = useAuthToken();
  const invalidate = useInvalidateAgentAccess(roomId);
  return useMutation({
    mutationFn: (input: {
      collaborationId: string;
      action: "accept" | "reject";
    }) =>
      respondToAgentCollaboration(
        token as string,
        roomId,
        input.collaborationId,
        input.action,
      ),
    onSuccess: invalidate,
  });
}

export function useRevokeAgentCollaboration(roomId: string) {
  const token = useAuthToken();
  const invalidate = useInvalidateAgentAccess(roomId);
  return useMutation({
    mutationFn: (collaborationId: string) =>
      revokeAgentCollaboration(token as string, roomId, collaborationId),
    onSuccess: invalidate,
  });
}

export function useRotateInvite(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => rotateInvite(token as string, roomId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: AUTH_KEYS.connector(roomId),
      });
    },
  });
}

/**
 * Loads history by walking pages from sequence 0 to the tail, merging into
 * the message store. The API only supports ascending `afterSequence` (no
 * beforeSequence contract), so this is the only way to show the newest
 * messages on entry. The cap guards against unbounded loops.
 */
const MAX_HISTORY_PAGES = 20; // 20 × 50 = 1000 messages
const HISTORY_PAGE_SIZE = 50;

export function useMessageHistory(roomId: string, enabled = true) {
  const token = useAuthToken();
  const upsertMessages = useMessageStore((state) => state.upsertMessages);
  const setHasOlder = useMessageStore((state) => state.setHasOlder);

  return useQuery({
    queryKey: [...AUTH_KEYS.messages(roomId), "history"],
    queryFn: async () => {
      let after = 0;
      let nextAfter = 0;
      const items: Message[] = [];
      for (let page = 0; page < MAX_HISTORY_PAGES; page++) {
        const result = await listMessages(
          token as string,
          roomId,
          after,
          HISTORY_PAGE_SIZE,
        );
        items.push(...result.items);
        nextAfter = result.nextAfterSequence;
        if (result.items.length === 0 || nextAfter <= after) break;
        after = nextAfter;
      }
      upsertMessages(items);
      // Walked from 0, so nothing older exists beyond the current store.
      setHasOlder(false);
      return { items, nextAfterSequence: nextAfter };
    },
    enabled: Boolean(token) && Boolean(roomId) && enabled,
    staleTime: 0,
  });
}

export function useSendText(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      text: string;
      attachmentIds?: string[];
    }): Promise<SendMessageResult> => {
      const body: TextMessageInput = {
        kind: "text",
        text: input.text,
        ...(input.attachmentIds?.length
          ? { attachmentIds: input.attachmentIds }
          : {}),
      };
      return sendMessage(token as string, roomId, body);
    },
    onSuccess: (result) => {
      useMessageStore.getState().upsertMessages([result.message]);
      useDeliveryStore.getState().upsertDeliveries(result.deliveries);
      void queryClient.invalidateQueries({
        queryKey: AUTH_KEYS.messages(roomId),
      });
    },
  });
}

export function useSendTask(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AgentTaskInput): Promise<SendMessageResult> =>
      sendMessage(token as string, roomId, input),
    onSuccess: (result) => {
      useMessageStore.getState().upsertMessages([result.message]);
      useDeliveryStore.getState().upsertDeliveries(result.deliveries);
      void queryClient.invalidateQueries({
        queryKey: AUTH_KEYS.messages(roomId),
      });
    },
  });
}

export function useUploadAttachment(roomId: string) {
  const token = useAuthToken();
  return useMutation({
    mutationFn: async (file: File) => {
      const mediaType = file.type || "application/octet-stream";
      const intent = await createUploadIntent(token as string, roomId, {
        name: file.name,
        mediaType,
        size: file.size,
      });
      await uploadToPresignedUrl(intent.presignedUrl, file);
      return completeFileUpload(token as string, roomId, intent.fileId);
    },
  });
}

export function useAttachment(
  roomId: string,
  attachmentId: string,
  enabled: boolean,
) {
  const token = useAuthToken();
  return useQuery({
    queryKey: AUTH_KEYS.attachment(roomId, attachmentId),
    queryFn: () => getAttachment(token as string, roomId, attachmentId),
    enabled: Boolean(token) && enabled,
    staleTime: 45_000,
    gcTime: 5 * 60_000,
  });
}

export function useRoomAttachments(roomId: string, enabled: boolean) {
  const token = useAuthToken();
  return useQuery({
    queryKey: AUTH_KEYS.attachments(roomId),
    queryFn: () => listAttachments(token as string, roomId),
    enabled: Boolean(token) && enabled,
  });
}

export function useModerationRules(roomId: string, enabled: boolean) {
  const token = useAuthToken();
  return useQuery({
    queryKey: AUTH_KEYS.moderation(roomId),
    queryFn: () => listModerationRules(token as string, roomId),
    enabled: Boolean(token) && enabled,
    retry: false,
  });
}

export function useCreateModerationRule(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { pattern: string; action: ModerationAction }) =>
      createModerationRule(
        token as string,
        roomId,
        input.pattern,
        input.action,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: AUTH_KEYS.moderation(roomId) }),
  });
}

export function useDeleteModerationRule(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) =>
      deleteModerationRule(token as string, roomId, ruleId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: AUTH_KEYS.moderation(roomId) }),
  });
}
