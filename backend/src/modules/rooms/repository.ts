import type {
  AccountRoomMembership,
  AgentDelivery,
  DeliveryStatus,
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

export interface RoomRepository {
  close?(): Promise<void>;
  healthCheck?(): Promise<void>;
  createRoom(record: CreateRoomRecord): Promise<void>;
  findRoom(roomId: string): Promise<Room | undefined>;
  inviteCodeMatches(roomId: string, inviteCodeHash: string): Promise<boolean>;
  updateInviteCode(roomId: string, inviteCodeHash: string): Promise<void>;
  addMember(record: AddMemberRecord): Promise<void>;
  listRoomsForUser(userId: string): Promise<AccountRoomMembership[]>;
  listMembers(roomId: string): Promise<RoomMember[]>;
  findMember(roomId: string, memberId: string): Promise<RoomMember | undefined>;
  findMemberByTokenHash(
    roomId: string,
    tokenHash: string,
  ): Promise<RoomMember | undefined>;
  findMemberByUserId(
    roomId: string,
    userId: string,
  ): Promise<RoomMember | undefined>;
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
}
