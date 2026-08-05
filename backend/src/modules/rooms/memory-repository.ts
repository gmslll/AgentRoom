import { AppError } from "../../lib/errors.js";
import { createId } from "../../lib/secrets.js";
import type {
  AddMemberRecord,
  AppendMessageRecord,
  CreateAgentTaskRecord,
  CreateAgentTaskResult,
  CreateRoomRecord,
  ListMessagesQuery,
  ReplyToDeliveryRecord,
  RoomRepository,
  UpdateDeliveryRecord,
} from "./repository.js";
import type {
  AccountRoomMembership,
  AgentDelivery,
  ModerationRule,
  PendingAgentDelivery,
  Room,
  RoomMember,
  RoomMessage,
} from "./types.js";

interface StoredRoom {
  room: Room;
  inviteCodeHash: string;
  nextSequence: number;
}

export class InMemoryRoomRepository implements RoomRepository {
  readonly #rooms = new Map<string, StoredRoom>();
  readonly #members = new Map<string, RoomMember>();
  readonly #tokenIndex = new Map<string, string>();
  readonly #userIndex = new Map<string, string>();
  readonly #messages = new Map<string, RoomMessage[]>();
  readonly #idempotencyIndex = new Map<string, string>();
  readonly #deliveries = new Map<string, AgentDelivery>();
  readonly #removedMembers = new Set<string>();
  readonly #moderationRules = new Map<string, ModerationRule>();

  async createRoom(record: CreateRoomRecord): Promise<void> {
    this.#rooms.set(record.room.id, {
      room: record.room,
      inviteCodeHash: record.inviteCodeHash,
      nextSequence: 1,
    });
    this.#members.set(record.owner.id, record.owner);
    this.#tokenIndex.set(
      this.#tokenKey(record.room.id, record.ownerTokenHash),
      record.owner.id,
    );
    if (record.ownerUserId) {
      this.#userIndex.set(
        this.#userKey(record.room.id, record.ownerUserId),
        record.owner.id,
      );
    }
    this.#messages.set(record.room.id, []);
  }

  async findRoom(roomId: string): Promise<Room | undefined> {
    return this.#rooms.get(roomId)?.room;
  }

  async inviteCodeMatches(
    roomId: string,
    inviteCodeHash: string,
  ): Promise<boolean> {
    return this.#rooms.get(roomId)?.inviteCodeHash === inviteCodeHash;
  }

  async updateInviteCode(
    roomId: string,
    inviteCodeHash: string,
  ): Promise<void> {
    const storedRoom = this.#rooms.get(roomId);
    if (!storedRoom) {
      throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
    }
    storedRoom.inviteCodeHash = inviteCodeHash;
  }

  async addMember(record: AddMemberRecord): Promise<void> {
    if (
      record.userId &&
      this.#userIndex.has(this.#userKey(record.member.roomId, record.userId))
    ) {
      throw new AppError(
        409,
        "ACCOUNT_ALREADY_MEMBER",
        "This account is already a member of the room",
      );
    }
    this.#members.set(record.member.id, record.member);
    this.#tokenIndex.set(
      this.#tokenKey(record.member.roomId, record.tokenHash),
      record.member.id,
    );
    if (record.userId) {
      this.#userIndex.set(
        this.#userKey(record.member.roomId, record.userId),
        record.member.id,
      );
    }
  }

  async listRoomsForUser(userId: string): Promise<AccountRoomMembership[]> {
    const memberships: AccountRoomMembership[] = [];
    for (const [key, memberId] of this.#userIndex) {
      if (!key.endsWith(`:${userId}`)) {
        continue;
      }
      const member = this.#members.get(memberId);
      const room = member ? this.#rooms.get(member.roomId)?.room : undefined;
      if (member && room && !this.#removedMembers.has(member.id)) {
        memberships.push({ room, member });
      }
    }
    return memberships.sort((left, right) =>
      right.room.createdAt.localeCompare(left.room.createdAt),
    );
  }

  async listMembers(roomId: string): Promise<RoomMember[]> {
    return [...this.#members.values()]
      .filter(
        (member) =>
          member.roomId === roomId && !this.#removedMembers.has(member.id),
      )
      .sort((left, right) => left.joinedAt.localeCompare(right.joinedAt));
  }

  async findMember(
    roomId: string,
    memberId: string,
  ): Promise<RoomMember | undefined> {
    const member = this.#members.get(memberId);
    return member?.roomId === roomId ? member : undefined;
  }

  async isActiveMember(roomId: string, memberId: string): Promise<boolean> {
    const member = this.#members.get(memberId);
    return (
      !!member &&
      member.roomId === roomId &&
      !this.#removedMembers.has(memberId)
    );
  }

  async findMemberByTokenHash(
    roomId: string,
    tokenHash: string,
  ): Promise<RoomMember | undefined> {
    const memberId = this.#tokenIndex.get(this.#tokenKey(roomId, tokenHash));
    const member = memberId ? this.#members.get(memberId) : undefined;
    return member && !this.#removedMembers.has(member.id) ? member : undefined;
  }

  async findMemberByUserId(
    roomId: string,
    userId: string,
  ): Promise<RoomMember | undefined> {
    const memberId = this.#userIndex.get(this.#userKey(roomId, userId));
    const member = memberId ? this.#members.get(memberId) : undefined;
    return member && !this.#removedMembers.has(member.id) ? member : undefined;
  }

  async appendMessage(record: AppendMessageRecord): Promise<RoomMessage> {
    return this.#appendMessage(record);
  }

  async findMessage(
    roomId: string,
    messageId: string,
  ): Promise<RoomMessage | undefined> {
    return this.#messages
      .get(roomId)
      ?.find((message) => message.id === messageId);
  }

  async listMessages(query: ListMessagesQuery): Promise<RoomMessage[]> {
    return (this.#messages.get(query.roomId) ?? [])
      .filter((message) => message.sequence > query.afterSequence)
      .slice(0, query.limit);
  }

  async createAgentTask(
    record: CreateAgentTaskRecord,
  ): Promise<CreateAgentTaskResult> {
    const idempotencyKey = record.message.idempotencyKey;
    if (!idempotencyKey) {
      throw new AppError(
        500,
        "IDEMPOTENCY_KEY_REQUIRED",
        "Agent task repository records require an idempotency key",
      );
    }
    const indexKey = this.#idempotencyKey(
      record.message.roomId,
      record.message.member.id,
      idempotencyKey,
    );
    const existingId = this.#idempotencyIndex.get(indexKey);
    if (existingId) {
      const existing = this.#findMessage(record.message.roomId, existingId);
      if (!existing) {
        throw new AppError(
          500,
          "IDEMPOTENCY_INDEX_CORRUPT",
          "The idempotency index references a missing message",
        );
      }
      if (
        existing.text !== record.message.text ||
        !sameStrings(existing.targetMemberIds, record.targetMemberIds)
      ) {
        throw new AppError(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "The idempotency key was already used with a different task payload",
        );
      }
      return {
        message: existing,
        deliveries: this.#listDeliveriesForTask(
          record.message.roomId,
          existing.id,
        ),
        created: false,
      };
    }

    const message = this.#appendMessage(record.message);
    const deliveries = this.#createDeliveries(
      message,
      record.targetMemberIds,
      message.createdAt,
    );
    return { message, deliveries, created: true };
  }

  #appendMessage(record: AppendMessageRecord): RoomMessage {
    const storedRoom = this.#rooms.get(record.roomId);
    if (!storedRoom) {
      throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
    }

    const message: RoomMessage = {
      id: record.id,
      roomId: record.roomId,
      sequence: storedRoom.nextSequence,
      kind: record.kind,
      text: record.text,
      attachmentIds: record.attachmentIds,
      targetMemberIds: record.targetMemberIds,
      inReplyToMessageId: record.inReplyToMessageId,
      idempotencyKey: record.idempotencyKey,
      author: {
        memberId: record.member.id,
        displayName: record.member.displayName,
        actorType: record.member.actorType,
        agentProvider: record.member.agentProvider,
      },
      createdAt: record.createdAt,
      ...(record.moderation ? { moderation: record.moderation } : {}),
    };

    storedRoom.nextSequence += 1;
    this.#messages.get(record.roomId)?.push(message);
    if (record.idempotencyKey) {
      this.#idempotencyIndex.set(
        this.#idempotencyKey(
          record.roomId,
          record.member.id,
          record.idempotencyKey,
        ),
        message.id,
      );
    }
    return message;
  }

  #createDeliveries(
    task: RoomMessage,
    targetMemberIds: string[],
    createdAt: string,
  ): AgentDelivery[] {
    const deliveries = targetMemberIds.map<AgentDelivery>((targetMemberId) => ({
      id: createId("del"),
      roomId: task.roomId,
      taskMessageId: task.id,
      targetMemberId,
      status: "queued",
      error: null,
      createdAt,
      updatedAt: createdAt,
    }));
    for (const delivery of deliveries) {
      this.#deliveries.set(delivery.id, delivery);
    }
    return deliveries;
  }

  async findDelivery(
    roomId: string,
    deliveryId: string,
  ): Promise<AgentDelivery | undefined> {
    const delivery = this.#deliveries.get(deliveryId);
    return delivery?.roomId === roomId ? delivery : undefined;
  }

  async listPendingDeliveries(
    roomId: string,
    targetMemberId: string,
  ): Promise<PendingAgentDelivery[]> {
    const result: PendingAgentDelivery[] = [];
    for (const delivery of this.#deliveries.values()) {
      if (
        delivery.roomId !== roomId ||
        delivery.targetMemberId !== targetMemberId ||
        delivery.status === "replied" ||
        delivery.status === "failed"
      ) {
        continue;
      }
      const task = await this.findMessage(roomId, delivery.taskMessageId);
      if (task) {
        result.push({ delivery, task });
      }
    }
    return result.sort(
      (left, right) => left.task.sequence - right.task.sequence,
    );
  }

  async listDeliveriesForTask(
    roomId: string,
    taskMessageId: string,
  ): Promise<AgentDelivery[]> {
    return this.#listDeliveriesForTask(roomId, taskMessageId);
  }

  #listDeliveriesForTask(
    roomId: string,
    taskMessageId: string,
  ): AgentDelivery[] {
    return [...this.#deliveries.values()].filter(
      (delivery) =>
        delivery.roomId === roomId &&
        delivery.taskMessageId === taskMessageId,
    );
  }

  async updateDelivery(record: UpdateDeliveryRecord): Promise<AgentDelivery> {
    const delivery = this.#deliveries.get(record.deliveryId);
    if (
      !delivery ||
      delivery.roomId !== record.roomId ||
      delivery.targetMemberId !== record.targetMemberId
    ) {
      throw new AppError(404, "DELIVERY_NOT_FOUND", "Delivery not found");
    }
    if (!record.allowedFrom.includes(delivery.status)) {
      throw new AppError(
        409,
        "INVALID_DELIVERY_TRANSITION",
        `Delivery cannot transition from ${delivery.status} to ${record.status}`,
      );
    }
    const updated: AgentDelivery = {
      ...delivery,
      status: record.status,
      error: record.error,
      updatedAt: record.updatedAt,
    };
    this.#deliveries.set(updated.id, updated);
    return updated;
  }

  async replyToDelivery(
    record: ReplyToDeliveryRecord,
  ): Promise<{ delivery: AgentDelivery; message: RoomMessage }> {
    const current = this.#deliveries.get(record.deliveryId);
    if (
      !current ||
      current.roomId !== record.roomId ||
      current.targetMemberId !== record.targetMemberId
    ) {
      throw new AppError(404, "DELIVERY_NOT_FOUND", "Delivery not found");
    }
    if (!["queued", "received", "running"].includes(current.status)) {
      throw new AppError(
        409,
        "INVALID_DELIVERY_TRANSITION",
        `Delivery cannot transition from ${current.status} to replied`,
      );
    }

    const message = this.#appendMessage({
      ...record.message,
      inReplyToMessageId: current.taskMessageId,
    });
    const delivery: AgentDelivery = {
      ...current,
      status: "replied",
      error: null,
      updatedAt: record.updatedAt,
    };
    this.#deliveries.set(delivery.id, delivery);
    return { delivery, message };
  }

  async removeMember(
    roomId: string,
    memberId: string,
    at: string,
  ): Promise<boolean> {
    const member = this.#members.get(memberId);
    if (!member || member.roomId !== roomId || member.role === "owner") {
      return false;
    }
    this.#removedMembers.add(memberId);
    for (const [key, id] of this.#tokenIndex) {
      if (id === memberId) {
        this.#tokenIndex.delete(key);
      }
    }
    for (const [key, id] of this.#userIndex) {
      if (id === memberId) {
        this.#userIndex.delete(key);
      }
    }
    void at;
    return true;
  }

  async listModerationRules(roomId: string): Promise<ModerationRule[]> {
    return [...this.#moderationRules.values()]
      .filter((rule) => rule.roomId === roomId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async createModerationRule(
    rule: ModerationRule,
    _createdByMemberId: string,
  ): Promise<ModerationRule> {
    this.#moderationRules.set(rule.id, rule);
    return rule;
  }

  async deleteModerationRule(
    roomId: string,
    ruleId: string,
  ): Promise<boolean> {
    const rule = this.#moderationRules.get(ruleId);
    if (!rule || rule.roomId !== roomId) {
      return false;
    }
    this.#moderationRules.delete(ruleId);
    return true;
  }

  #tokenKey(roomId: string, tokenHash: string): string {
    return `${roomId}:${tokenHash}`;
  }

  #userKey(roomId: string, userId: string): string {
    return `${roomId}:${userId}`;
  }

  #idempotencyKey(
    roomId: string,
    authorMemberId: string,
    idempotencyKey: string,
  ): string {
    return `${roomId}:${authorMemberId}:${idempotencyKey}`;
  }

  #findMessage(roomId: string, messageId: string): RoomMessage | undefined {
    return this.#messages
      .get(roomId)
      ?.find((message) => message.id === messageId);
  }
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
