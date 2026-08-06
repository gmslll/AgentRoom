import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { getMe, login, logout, register } from "./auth";
import {
  createRoom,
  getConnector,
  joinRoom,
  listMembers,
  listMessages,
  listRooms,
  rotateInvite,
  sendMessage,
} from "./rooms";
import { ApiError } from "./client";
import type {
  AgentTaskInput,
  LoginInput,
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
 * Loads history up to the current watermark (or a full page when empty) and
 * merges it into the message store. Returns whether older messages remain.
 */
export function useMessageHistory(roomId: string) {
  const token = useAuthToken();
  const queryClient = useQueryClient();
  const upsertMessages = useMessageStore((state) => state.upsertMessages);
  const setHasOlder = useMessageStore((state) => state.setHasOlder);
  const watermark = useMessageStore((state) => state.watermark);

  return useQuery({
    queryKey: [...AUTH_KEYS.messages(roomId), "history", watermark],
    queryFn: async () => {
      const result = await listMessages(token as string, roomId, watermark, 50);
      upsertMessages(result.items);
      setHasOlder(result.nextAfterSequence > 0);
      void queryClient.invalidateQueries({
        queryKey: AUTH_KEYS.messages(roomId),
      });
      return result;
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
