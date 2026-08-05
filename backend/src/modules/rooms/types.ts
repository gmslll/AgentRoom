export const actorTypes = ["human", "agent", "terminal"] as const;
export type ActorType = (typeof actorTypes)[number];
export const agentProviders = ["claude", "codex", "other"] as const;
export type AgentProvider = (typeof agentProviders)[number];

export type MemberRole = "owner" | "member";

export interface Room {
  id: string;
  name: string;
  createdAt: string;
}

export interface RoomMember {
  id: string;
  roomId: string;
  displayName: string;
  actorType: ActorType;
  agentProvider: AgentProvider | null;
  role: MemberRole;
  joinedAt: string;
}

export interface AccountRoomMembership {
  room: Room;
  member: RoomMember;
}

export interface RoomConnectorInfo {
  command: string;
  packageName: "@agentroom/bridge";
  nodeVersion: ">=22";
  supportedProviders: ["claude", "codex"];
}

export interface MessageAuthor {
  memberId: string;
  displayName: string;
  actorType: ActorType;
  agentProvider: AgentProvider | null;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  sequence: number;
  kind: "text" | "agent.task" | "agent.reply";
  text: string;
  attachmentIds: string[];
  targetMemberIds: string[];
  inReplyToMessageId: string | null;
  idempotencyKey: string | null;
  author: MessageAuthor;
  createdAt: string;
}

export interface RoomEvent {
  version: 1;
  eventId: string;
  type: "message.created";
  roomId: string;
  sequence: number;
  occurredAt: string;
  data: {
    message: RoomMessage;
  };
}

export const deliveryStatuses = [
  "queued",
  "received",
  "running",
  "replied",
  "failed",
] as const;
export type DeliveryStatus = (typeof deliveryStatuses)[number];

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

export interface PendingAgentDelivery {
  delivery: AgentDelivery;
  task: RoomMessage;
}

export interface DeliveryQueuedEvent {
  version: 1;
  eventId: string;
  type: "delivery.queued";
  roomId: string;
  occurredAt: string;
  data: PendingAgentDelivery;
}

export interface DeliveryUpdatedEvent {
  version: 1;
  eventId: string;
  type: "delivery.updated";
  roomId: string;
  occurredAt: string;
  data: {
    delivery: AgentDelivery;
  };
}

export interface SessionReadyEvent {
  version: 1;
  eventId: string;
  type: "session.ready";
  roomId: string;
  occurredAt: string;
  data: {
    member: RoomMember;
  };
}

export interface MemberJoinedEvent {
  version: 1;
  eventId: string;
  type: "member.joined";
  roomId: string;
  occurredAt: string;
  data: {
    member: RoomMember;
  };
}

export type RealtimeServerEvent =
  | SessionReadyEvent
  | MemberJoinedEvent
  | RoomEvent
  | DeliveryQueuedEvent
  | DeliveryUpdatedEvent;
