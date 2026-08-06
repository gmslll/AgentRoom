import { api } from "./client";
import type {
  AccountRoomMembership,
  AgentAccessOverview,
  AgentCollaboration,
  AgentOwnership,
  AgentUserGrant,
  Attachment,
  ConnectorResponse,
  CreatedRoomAccess,
  JoinRoomInput,
  Member,
  MemberPresence,
  MessageInput,
  MessageListResult,
  ModerationAction,
  ModerationRule,
  RealtimeTicket,
  ResolvedAttachment,
  RotateInviteResponse,
  RoomAccess,
  Room,
  RoomVisibility,
  SendMessageResult,
  UploadIntent,
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
  return api<void>(`/v1/rooms/${roomId}`, { method: "DELETE" }, { token });
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
  return api<{ items: Member[] }>(`/v1/rooms/${roomId}/members`, {}, { token });
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
  return api<ConnectorResponse>(`/v1/rooms/${roomId}/connector`, {}, { token });
}

export async function getAgentAccess(
  token: string,
  roomId: string,
): Promise<AgentAccessOverview> {
  return api<AgentAccessOverview>(
    `/v1/rooms/${roomId}/agent-access`,
    {},
    { token },
  );
}

export async function claimAgent(
  token: string,
  roomId: string,
  agentId: string,
  claimCode: string,
): Promise<{ ownership: AgentOwnership }> {
  return api<{ ownership: AgentOwnership }>(
    `/v1/rooms/${roomId}/agents/${agentId}/claim`,
    { method: "POST", body: JSON.stringify({ claimCode }) },
    { token },
  );
}

export async function grantAgentToUser(
  token: string,
  roomId: string,
  agentId: string,
  granteeMemberId: string,
): Promise<{ grant: AgentUserGrant }> {
  return api<{ grant: AgentUserGrant }>(
    `/v1/rooms/${roomId}/agents/${agentId}/grants`,
    { method: "POST", body: JSON.stringify({ granteeMemberId }) },
    { token },
  );
}

export async function revokeAgentGrant(
  token: string,
  roomId: string,
  agentId: string,
  grantId: string,
): Promise<void> {
  await api<void>(
    `/v1/rooms/${roomId}/agents/${agentId}/grants/${grantId}`,
    { method: "DELETE" },
    { token },
  );
}

export async function requestAgentCollaboration(
  token: string,
  roomId: string,
  requesterAgentMemberId: string,
  targetAgentMemberId: string,
): Promise<{ collaboration: AgentCollaboration }> {
  return api<{ collaboration: AgentCollaboration }>(
    `/v1/rooms/${roomId}/agent-collaborations`,
    {
      method: "POST",
      body: JSON.stringify({ requesterAgentMemberId, targetAgentMemberId }),
    },
    { token },
  );
}

export async function respondToAgentCollaboration(
  token: string,
  roomId: string,
  collaborationId: string,
  action: "accept" | "reject",
): Promise<{ collaboration: AgentCollaboration }> {
  return api<{ collaboration: AgentCollaboration }>(
    `/v1/rooms/${roomId}/agent-collaborations/${collaborationId}/respond`,
    { method: "POST", body: JSON.stringify({ action }) },
    { token },
  );
}

export async function revokeAgentCollaboration(
  token: string,
  roomId: string,
  collaborationId: string,
): Promise<{ collaboration: AgentCollaboration }> {
  return api<{ collaboration: AgentCollaboration }>(
    `/v1/rooms/${roomId}/agent-collaborations/${collaborationId}`,
    { method: "DELETE" },
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

export async function createUploadIntent(
  token: string,
  roomId: string,
  input: { name: string; mediaType: string; size: number; sha256?: string },
): Promise<UploadIntent> {
  return api<UploadIntent>(
    `/v1/rooms/${roomId}/files/upload-intents`,
    { method: "POST", body: JSON.stringify(input) },
    { token },
  );
}

export async function uploadToPresignedUrl(
  presignedUrl: string,
  file: File,
): Promise<void> {
  const response = await fetch(presignedUrl, {
    method: "PUT",
    headers: { "content-type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) {
    throw new Error(`Object upload failed (${response.status})`);
  }
}

export async function completeFileUpload(
  token: string,
  roomId: string,
  fileId: string,
): Promise<ResolvedAttachment> {
  return api<ResolvedAttachment>(
    `/v1/rooms/${roomId}/files/${fileId}/complete`,
    { method: "POST" },
    { token },
  );
}

export async function getAttachment(
  token: string,
  roomId: string,
  attachmentId: string,
): Promise<ResolvedAttachment> {
  return api<ResolvedAttachment>(
    `/v1/rooms/${roomId}/attachments/${attachmentId}`,
    {},
    { token },
  );
}

export async function listAttachments(
  token: string,
  roomId: string,
): Promise<{ items: Attachment[] }> {
  return api<{ items: Attachment[] }>(
    `/v1/rooms/${roomId}/attachments`,
    {},
    { token },
  );
}

export async function listModerationRules(
  token: string,
  roomId: string,
): Promise<{ items: ModerationRule[] }> {
  return api<{ items: ModerationRule[] }>(
    `/v1/rooms/${roomId}/moderation/rules`,
    {},
    { token },
  );
}

export async function createModerationRule(
  token: string,
  roomId: string,
  pattern: string,
  action: ModerationAction,
): Promise<ModerationRule> {
  return api<ModerationRule>(
    `/v1/rooms/${roomId}/moderation/rules`,
    { method: "POST", body: JSON.stringify({ pattern, action }) },
    { token },
  );
}

export async function deleteModerationRule(
  token: string,
  roomId: string,
  ruleId: string,
): Promise<void> {
  await api<void>(
    `/v1/rooms/${roomId}/moderation/rules/${ruleId}`,
    { method: "DELETE" },
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
