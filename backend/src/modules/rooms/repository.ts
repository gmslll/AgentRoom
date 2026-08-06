import type {
  AccountRoomMembership,
  AgentCollaboration,
  AgentDelivery,
  AgentOwnership,
  DeliveryStatus,
  ModerationRule,
  PendingAgentDelivery,
  Room,
  RoomMember,
  RoomMessage,
} from "./types.js";

export interface CreateRoomRecord {
  room: Room;
  owner: RoomMember;
  ownerUserId: string | null;
  ownerTokenHash: string;
  inviteCodeHash: string;
}

export interface AddMemberRecord {
  member: RoomMember;
  userId: string | null;
  tokenHash: string;
  agentClaim?: AgentClaimRecord;
}

export interface AgentClaimRecord {
  id: string;
  roomId: string;
  agentMemberId: string;
  codeHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface ClaimAgentRecord {
  roomId: string;
  agentMemberId: string;
  codeHash: string;
  ownerUserId: string;
  claimedAt: string;
}

export interface StoredAgentUserGrant {
  id: string;
  roomId: string;
  agentMemberId: string;
  granteeUserId: string;
  createdAt: string;
}

export interface AppendMessageRecord {
  id: string;
  roomId: string;
  member: RoomMember;
  text: string;
  attachmentIds: string[];
  kind: RoomMessage["kind"];
  targetMemberIds: string[];
  inReplyToMessageId: string | null;
  idempotencyKey: string | null;
  createdAt: string;
  moderation?: RoomMessage["moderation"];
}

export interface UpdateDeliveryRecord {
  roomId: string;
  deliveryId: string;
  targetMemberId: string;
  status: DeliveryStatus;
  allowedFrom: DeliveryStatus[];
  error: string | null;
  updatedAt: string;
}

export interface CreateAgentTaskRecord {
  message: AppendMessageRecord;
  targetMemberIds: string[];
}

export interface CreateAgentTaskResult {
  message: RoomMessage;
  deliveries: AgentDelivery[];
  created: boolean;
}

export interface ReplyToDeliveryRecord {
  roomId: string;
  deliveryId: string;
  targetMemberId: string;
  message: Omit<AppendMessageRecord, "inReplyToMessageId">;
  updatedAt: string;
}

export interface ListMessagesQuery {
  roomId: string;
  afterSequence: number;
  limit: number;
}

export interface OutboxEntry {
  id: number;
  roomId: string;
  payload: unknown;
}

export interface RoomRepository {
  close?(): Promise<void>;
  healthCheck?(): Promise<void>;
  createRoom(record: CreateRoomRecord): Promise<void>;
  findRoom(roomId: string): Promise<Room | undefined>;
  listPublicRooms(limit: number): Promise<Room[]>;
  updateRoom(
    roomId: string,
    patch: { name?: string; visibility?: Room["visibility"] },
  ): Promise<Room | undefined>;
  /** Soft-deletes a room and revokes every membership token. */
  dissolveRoom(roomId: string, at: string): Promise<boolean>;
  inviteCodeMatches(roomId: string, inviteCodeHash: string): Promise<boolean>;
  updateInviteCode(roomId: string, inviteCodeHash: string): Promise<void>;
  addMember(record: AddMemberRecord): Promise<void>;
  listRoomsForUser(userId: string): Promise<AccountRoomMembership[]>;
  listMembers(roomId: string): Promise<RoomMember[]>;
  findMember(roomId: string, memberId: string): Promise<RoomMember | undefined>;
  /**
   * True when the member exists, belongs to the room, and has not been
   * removed (kicked). Used to reject stale realtime tickets.
   */
  isActiveMember(roomId: string, memberId: string): Promise<boolean>;
  findMemberByTokenHash(
    roomId: string,
    tokenHash: string,
  ): Promise<RoomMember | undefined>;
  findMemberByUserId(
    roomId: string,
    userId: string,
  ): Promise<RoomMember | undefined>;
  findUserIdByMemberId(
    roomId: string,
    memberId: string,
  ): Promise<string | undefined>;
  issueAgentClaim(record: AgentClaimRecord): Promise<void>;
  claimAgent(record: ClaimAgentRecord): Promise<AgentOwnership>;
  findAgentOwnership(
    roomId: string,
    agentMemberId: string,
  ): Promise<AgentOwnership | undefined>;
  listAgentOwnerships(roomId: string): Promise<AgentOwnership[]>;
  hasAgentUserGrant(
    roomId: string,
    agentMemberId: string,
    granteeUserId: string,
  ): Promise<boolean>;
  createAgentUserGrant(
    record: StoredAgentUserGrant,
  ): Promise<StoredAgentUserGrant>;
  listAgentUserGrants(roomId: string): Promise<StoredAgentUserGrant[]>;
  deleteAgentUserGrant(
    roomId: string,
    grantId: string,
    agentMemberId: string,
  ): Promise<boolean>;
  createAgentCollaboration(
    collaboration: AgentCollaboration,
  ): Promise<AgentCollaboration>;
  listAgentCollaborations(roomId: string): Promise<AgentCollaboration[]>;
  updateAgentCollaboration(
    roomId: string,
    collaborationId: string,
    allowedFrom: AgentCollaboration["status"][],
    status: AgentCollaboration["status"],
    updatedAt: string,
  ): Promise<AgentCollaboration>;
  hasActiveAgentCollaboration(
    roomId: string,
    firstAgentMemberId: string,
    secondAgentMemberId: string,
  ): Promise<boolean>;
  appendMessage(record: AppendMessageRecord): Promise<RoomMessage>;
  findMessage(roomId: string, messageId: string): Promise<RoomMessage | undefined>;
  listMessages(query: ListMessagesQuery): Promise<RoomMessage[]>;
  createAgentTask(record: CreateAgentTaskRecord): Promise<CreateAgentTaskResult>;
  findDelivery(
    roomId: string,
    deliveryId: string,
  ): Promise<AgentDelivery | undefined>;
  listPendingDeliveries(
    roomId: string,
    targetMemberId: string,
  ): Promise<PendingAgentDelivery[]>;
  listDeliveriesForTask(
    roomId: string,
    taskMessageId: string,
  ): Promise<AgentDelivery[]>;
  updateDelivery(record: UpdateDeliveryRecord): Promise<AgentDelivery>;
  replyToDelivery(
    record: ReplyToDeliveryRecord,
  ): Promise<{ delivery: AgentDelivery; message: RoomMessage }>;
  /** Marks a member as removed and revokes their token. Returns false when missing or the owner. */
  removeMember(roomId: string, memberId: string, at: string): Promise<boolean>;
  listModerationRules(roomId: string): Promise<ModerationRule[]>;
  createModerationRule(
    rule: ModerationRule,
    createdByMemberId: string,
  ): Promise<ModerationRule>;
  deleteModerationRule(roomId: string, ruleId: string): Promise<boolean>;
  /**
   * Persists a realtime event for reliable fan-out. Implemented by the
   * PostgreSQL repository (transactional outbox table); the in-memory adapter
   * leaves it undefined and the service publishes directly.
   */
  enqueueOutbox?(roomId: string, payload: unknown): Promise<void>;
  listPendingOutbox?(
    limit: number,
  ): Promise<OutboxEntry[]>;
  markOutboxPublished?(ids: number[], publishedAt: string): Promise<void>;
  /** Re-queues entries whose fan-out failed so they are retried next drain. */
  releaseOutbox?(ids: number[]): Promise<void>;
  /** Deletes published entries older than the given ISO timestamp; returns the number removed. */
  purgeOutbox?(olderThan: string): Promise<number>;
}
