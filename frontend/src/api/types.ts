/**
 * API and realtime types.
 *
 * Source of truth: ../shared/contracts/http/openapi.yaml and
 * ../shared/contracts/realtime/event.schema.json. Do not import backend
 * runtime code.
 */

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export type ActorType = "human" | "agent" | "terminal";
export type AgentProvider = "claude" | "codex" | "other" | null;
export type MemberRole = "owner" | "member";
export type RoomVisibility = "private" | "public";
export type MessageKind = "text" | "agent.task" | "agent.reply";
export type DeliveryStatus =
  | "queued"
  | "received"
  | "running"
  | "replied"
  | "failed";

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export interface Account {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface AccountAccess {
  user: Account;
  accessToken: string;
  expiresAt: string;
}

export interface RegisterInput {
  email: string;
  displayName: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Rooms and members
// ---------------------------------------------------------------------------

export interface Room {
  id: string;
  name: string;
  visibility: RoomVisibility;
  createdAt: string;
}

export interface Member {
  id: string;
  roomId: string;
  displayName: string;
  actorType: ActorType;
  agentProvider: AgentProvider;
  role: MemberRole;
  joinedAt: string;
}

export interface MemberPresence {
  memberId: string;
  online: boolean;
  lastSeenAt: string | null;
}

export interface AccountRoomMembership {
  room: Room;
  member: Member;
}

export interface RoomAccess {
  room: Room;
  member: Member;
  accessToken: string;
}

export interface CreatedRoomAccess extends RoomAccess {
  inviteCode: string;
  connectorCommand: string;
  connector: RoomConnectorInfo;
}

export interface JoinRoomInput {
  inviteCode?: string;
  displayName: string;
  actorType: ActorType;
}

export interface UpdateRoomInput {
  name?: string;
  visibility?: RoomVisibility;
}

export interface RoomConnectorInfo {
  command: string;
  attachCommand: string;
  distribution: "direct-download";
  installers: {
    manifestUrl: string;
    macosLinuxUrl: string;
    windowsUrl: string;
  };
  packageName: "@agentroom/bridge";
  nodeVersion: ">=22";
  supportedProviders: ["claude", "codex"];
}

export interface ConnectorResponse {
  connectorCommand: string;
  connector: RoomConnectorInfo;
}

export interface RotateInviteResponse extends ConnectorResponse {
  inviteCode: string;
}

// ---------------------------------------------------------------------------
// Messages and deliveries
// ---------------------------------------------------------------------------

export interface MessageAuthor {
  memberId: string;
  displayName: string;
  actorType: ActorType;
  agentProvider: AgentProvider;
}

export interface MessageModeration {
  state: "clean" | "flagged";
  reason?: string;
}

export interface Message {
  id: string;
  roomId: string;
  sequence: number;
  kind: MessageKind;
  text: string;
  attachmentIds: string[];
  targetMemberIds: string[];
  inReplyToMessageId: string | null;
  idempotencyKey: string | null;
  author: MessageAuthor;
  createdAt: string;
  moderation?: MessageModeration | null;
}

export interface TextMessageInput {
  kind: "text";
  text: string;
}

export interface AgentTaskInput {
  kind: "agent.task";
  text: string;
  targetMemberIds: string[];
  idempotencyKey: string;
}

export type MessageInput = TextMessageInput | AgentTaskInput;

export interface AgentDelivery {
  id: string;
  roomId: string;
  taskMessageId: string;
  targetMemberId: string;
  status: DeliveryStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SendMessageResult {
  message: Message;
  deliveries: AgentDelivery[];
}

export interface MessageListResult {
  items: Message[];
  nextAfterSequence: number;
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

export interface RealtimeTicket {
  ticket: string;
  expiresAt: string;
}

export interface RealtimeEnvelope<T = unknown> {
  version: 1;
  eventId: string;
  type: string;
  roomId: string;
  occurredAt: string;
  data?: T;
}

export interface SessionReadyEvent {
  type: "session.ready";
  data: Record<string, never>;
}

export interface MemberJoinedEvent {
  type: "member.joined";
  data: { member: Member };
}

export interface MemberRemovedEvent {
  type: "member.removed";
  data: { memberId: string };
}

export interface MemberPresenceEvent {
  type: "member.presence";
  data: MemberPresence;
}

export interface RoomUpdatedEvent {
  type: "room.updated";
  data: { room: Room };
}

export interface RoomDissolvedEvent {
  type: "room.dissolved";
  data: { dissolvedByMemberId: string };
}

export interface MessageCreatedEvent {
  type: "message.created";
  data: { message: Message };
}

export interface DeliveryQueuedEvent {
  type: "delivery.queued";
  data: { delivery: AgentDelivery };
}

export interface DeliveryUpdatedEvent {
  type: "delivery.updated";
  data: { delivery: AgentDelivery };
}

export type RealtimeEvent =
  | SessionReadyEvent
  | MemberJoinedEvent
  | MemberRemovedEvent
  | MemberPresenceEvent
  | RoomUpdatedEvent
  | RoomDissolvedEvent
  | MessageCreatedEvent
  | DeliveryQueuedEvent
  | DeliveryUpdatedEvent;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}
