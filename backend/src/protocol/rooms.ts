export const actorTypes = ["human", "agent", "terminal"] as const;
export type ActorType = (typeof actorTypes)[number];
export const agentProviders = ["claude", "codex", "other"] as const;
export type AgentProvider = (typeof agentProviders)[number];

export type MemberRole = "owner" | "member";
export type RoomVisibility = "private" | "public";

export interface Room {
  id: string;
  name: string;
  visibility: RoomVisibility;
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
  attachCommand: string;
  distribution: "direct-download";
  installers: {
    manifestUrl: string;
    macosLinuxUrl: string;
    windowsUrl: string;
  };
  /** Retained for clients built before direct downloads replaced npm. */
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
  moderation?: {
    state: "clean" | "flagged";
    reason?: string;
  };
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

export type ModerationAction = "flag" | "reject";

export interface ModerationRule {
  id: string;
  roomId: string;
  pattern: string;
  action: ModerationAction;
  createdAt: string;
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

export interface MemberRemovedEvent {
  version: 1;
  eventId: string;
  type: "member.removed";
  roomId: string;
  occurredAt: string;
  data: {
    memberId: string;
  };
}

export interface MemberPresenceEvent {
  version: 1;
  eventId: string;
  type: "member.presence";
  roomId: string;
  occurredAt: string;
  data: {
    memberId: string;
    online: boolean;
    lastSeenAt: string | null;
  };
}

export interface RoomUpdatedEvent {
  version: 1;
  eventId: string;
  type: "room.updated";
  roomId: string;
  occurredAt: string;
  data: {
    room: Room;
  };
}

export interface RoomDissolvedEvent {
  version: 1;
  eventId: string;
  type: "room.dissolved";
  roomId: string;
  occurredAt: string;
  data: {
    dissolvedByMemberId: string;
  };
}

export interface MemberPresenceSnapshot {
  memberId: string;
  online: boolean;
  lastSeenAt: string | null;
}

export type RealtimeServerEvent =
  | SessionReadyEvent
  | MemberJoinedEvent
  | MemberRemovedEvent
  | MemberPresenceEvent
  | RoomUpdatedEvent
  | RoomDissolvedEvent
  | RoomEvent
  | DeliveryQueuedEvent
  | DeliveryUpdatedEvent;
