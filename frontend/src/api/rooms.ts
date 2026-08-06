import { api } from "./client";
import type {
  AccountRoomMembership,
  ConnectorResponse,
  CreatedRoomAccess,
  JoinRoomInput,
  Member,
  MemberPresence,
  MessageInput,
  MessageListResult,
  RealtimeTicket,
  RotateInviteResponse,
  RoomAccess,
  Room,
  RoomVisibility,
  SendMessageResult,
  UpdateRoomInput,
} from "./types";

export async function listRooms(
  token: string,
): Promise<{ items: AccountRoomMembership[] }> {
  return api<{ items: AccountRoomMembership[] }>("/v1/rooms", {}, { token });
}

export async function createRoom(
  token: string,
  name: string,
  visibility: RoomVisibility,
): Promise<CreatedRoomAccess> {
  return api<CreatedRoomAccess>(
    "/v1/rooms",
    { method: "POST", body: JSON.stringify({ name, visibility }) },
    { token },
  );
}

export async function listPublicRooms(): Promise<{ items: Room[] }> {
  return api<{ items: Room[] }>("/v1/public-rooms");
}

export async function updateRoom(
  token: string,
  roomId: string,
  input: UpdateRoomInput,
): Promise<{ room: Room }> {
  return api<{ room: Room }>(
    `/v1/rooms/${roomId}`,
    { method: "PATCH", body: JSON.stringify(input) },
    { token },
  );
}

export async function dissolveRoom(
  token: string,
  roomId: string,
): Promise<void> {
  return api<void>(
    `/v1/rooms/${roomId}`,
    { method: "DELETE" },
    { token },
  );
}

export async function joinRoom(
  token: string,
  roomId: string,
  input: JoinRoomInput,
): Promise<RoomAccess> {
  return api<RoomAccess>(
    `/v1/rooms/${roomId}/members`,
    { method: "POST", body: JSON.stringify(input) },
    { token },
  );
}

export async function listMembers(
  token: string,
  roomId: string,
): Promise<{ items: Member[] }> {
  return api<{ items: Member[] }>(
    `/v1/rooms/${roomId}/members`,
    {},
    { token },
  );
}

export async function listPresence(
  token: string,
  roomId: string,
): Promise<{ items: MemberPresence[] }> {
  return api<{ items: MemberPresence[] }>(
    `/v1/rooms/${roomId}/presence`,
    {},
    { token },
  );
}

export async function removeRoomMember(
  token: string,
  roomId: string,
  memberId: string,
): Promise<void> {
  return api<void>(
    `/v1/rooms/${roomId}/members/${memberId}`,
    { method: "DELETE" },
    { token },
  );
}

export async function getConnector(
  token: string,
  roomId: string,
): Promise<ConnectorResponse> {
  return api<ConnectorResponse>(
    `/v1/rooms/${roomId}/connector`,
    {},
    { token },
  );
}

export async function rotateInvite(
  token: string,
  roomId: string,
): Promise<RotateInviteResponse> {
  return api<RotateInviteResponse>(
    `/v1/rooms/${roomId}/invite-code/rotate`,
    { method: "POST" },
    { token },
  );
}

export async function listMessages(
  token: string,
  roomId: string,
  afterSequence: number,
  limit = 50,
): Promise<MessageListResult> {
  const query = new URLSearchParams({
    afterSequence: String(afterSequence),
    limit: String(limit),
  });
  return api<MessageListResult>(
    `/v1/rooms/${roomId}/messages?${query}`,
    {},
    { token },
  );
}

export async function sendMessage(
  token: string,
  roomId: string,
  input: MessageInput,
): Promise<SendMessageResult> {
  return api<SendMessageResult>(
    `/v1/rooms/${roomId}/messages`,
    { method: "POST", body: JSON.stringify(input) },
    { token },
  );
}

export async function getRealtimeTicket(
  token: string,
  roomId: string,
): Promise<RealtimeTicket> {
  return api<RealtimeTicket>(
    `/v1/rooms/${roomId}/realtime-tickets`,
    { method: "POST" },
    { token },
  );
}
