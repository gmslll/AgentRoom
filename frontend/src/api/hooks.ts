import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getMe, login, logout, register } from "./auth";
import {
  createRoom,
  getConnector,
  joinRoom,
  listMembers,
  listMessages,
  listPresence,
  listRooms,
  removeRoomMember,
  rotateInvite,
  sendMessage,
} from "./rooms";
import { ApiError } from "./client";
import type {
  AgentTaskInput,
  LoginInput,
  Message,
  RegisterInput,
  SendMessageResult,
  TextMessageInput,
} from "./types";
import { useMessageStore } from "../stores/messageStore";
import { useMemberStore } from "../stores/memberStore";
import { useDeliveryStore } from "../stores/deliveryStore";
import { useTokenStore } from "../stores/tokenStore";

const AUTH_KEYS = {
  me: ["auth", "me"] as const,
  rooms: ["rooms"] as const,
  members: (roomId: string) => ["rooms", roomId, "members"] as const,
  connector: (roomId: string) => ["rooms", roomId, "connector"] as const,
  messages: (roomId: string) => ["rooms", roomId, "messages"] as const,
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
    mutationFn: (name: string) => createRoom(token as string, name),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: AUTH_KEYS.rooms });
    },
  });
}

export function useJoinRoom(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { inviteCode: string; displayName: string }) =>
      joinRoom(token as string, roomId, {
        inviteCode: input.inviteCode,
        displayName: input.displayName,
        actorType: "human",
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: AUTH_KEYS.rooms });
    },
  });
}

export function useMembers(roomId: string) {
  const token = useAuthToken();
  const setMembers = useMemberStore((state) => state.setMembers);
  return useQuery({
    queryKey: AUTH_KEYS.members(roomId),
    queryFn: async () => {
      const result = await listMembers(token as string, roomId);
      setMembers(result.items);
      return result.items;
    },
    enabled: Boolean(token) && Boolean(roomId),
  });
}

/**
 * Loads the presence snapshot (online state derived from live WebSocket
 * connections) into the member store. Never guess online state from the
 * member list.
 */
export function usePresence(roomId: string) {
  const token = useAuthToken();
  const setPresence = useMemberStore((state) => state.setPresence);
  return useQuery({
    queryKey: ["rooms", roomId, "presence"],
    queryFn: async () => {
      const result = await listPresence(token as string, roomId);
      for (const item of result.items) {
        setPresence(item.memberId, item.online);
      }
      return result.items;
    },
    enabled: Boolean(token) && Boolean(roomId),
  });
}

/** Removes a member (owner only). The room owner cannot be removed. */
export function useRemoveMember(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      removeRoomMember(token as string, roomId, memberId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: AUTH_KEYS.members(roomId),
      });
      await queryClient.invalidateQueries({
        queryKey: ["rooms", roomId, "presence"],
      });
    },
  });
}

export function useConnector(roomId: string) {
  const token = useAuthToken();
  return useQuery({
    queryKey: AUTH_KEYS.connector(roomId),
    queryFn: () => getConnector(token as string, roomId),
    enabled: Boolean(token) && Boolean(roomId),
    retry: false,
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

export function useMessageHistory(roomId: string) {
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
    enabled: Boolean(token) && Boolean(roomId),
    staleTime: 0,
  });
}

export function useSendText(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { text: string }): Promise<SendMessageResult> => {
      const body: TextMessageInput = { kind: "text", text: input.text };
      return sendMessage(token as string, roomId, body);
    },
    onSuccess: (result) => {
      useMessageStore.getState().upsertMessages([result.message]);
      useDeliveryStore.getState().upsertDeliveries(result.deliveries);
      void queryClient.invalidateQueries({ queryKey: AUTH_KEYS.messages(roomId) });
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
      void queryClient.invalidateQueries({ queryKey: AUTH_KEYS.messages(roomId) });
    },
  });
}
