import { AppError } from "../../lib/errors.js";
import { createId } from "../../lib/secrets.js";
import type {
  AddMemberRecord,
  AgentClaimRecord,
  AppendMessageRecord,
  ClaimAgentRecord,
  CreateAgentTaskRecord,
  CreateAgentTaskResult,
  CreateRoomRecord,
  ListMessagesQuery,
  ReplyToDeliveryRecord,
  RoomRepository,
  StoredAgentUserGrant,
  UpdateDeliveryRecord,
} from "./repository.js";
import type {
  AccountRoomMembership,
  AgentCollaboration,
  AgentDelivery,
  AgentOwnership,
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
  dissolvedAt?: string;
}

export class InMemoryRoomRepository implements RoomRepository {
  readonly #rooms = new Map<string, StoredRoom>();
  readonly #members = new Map<string, RoomMember>();
  readonly #tokenIndex = new Map<string, string>();
  readonly #userIndex = new Map<string, string>();
  readonly #memberUserIds = new Map<string, string>();
  readonly #messages = new Map<string, RoomMessage[]>();
  readonly #idempotencyIndex = new Map<string, string>();
  readonly #deliveries = new Map<string, AgentDelivery>();
  readonly #removedMembers = new Set<string>();
  readonly #moderationRules = new Map<string, ModerationRule>();
  readonly #agentClaims = new Map<string, AgentClaimRecord>();
  readonly #agentOwnerships = new Map<string, AgentOwnership>();
  readonly #agentUserGrants = new Map<string, StoredAgentUserGrant>();
  readonly #agentCollaborations = new Map<string, AgentCollaboration>();

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
      this.#memberUserIds.set(record.owner.id, record.ownerUserId);
    }
    this.#messages.set(record.room.id, []);
  }

  async findRoom(roomId: string): Promise<Room | undefined> {
    const stored = this.#rooms.get(roomId);
    return stored && !stored.dissolvedAt ? stored.room : undefined;
  }

  async listPublicRooms(limit: number): Promise<Room[]> {
    return [...this.#rooms.values()]
      .filter(
        (stored) =>
          !stored.dissolvedAt && stored.room.visibility === "public",
      )
      .map((stored) => stored.room)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async updateRoom(
    roomId: string,
    patch: { name?: string; visibility?: Room["visibility"] },
  ): Promise<Room | undefined> {
    const stored = this.#rooms.get(roomId);
    if (!stored || stored.dissolvedAt) {
      return undefined;
    }
    stored.room = { ...stored.room, ...patch };
    return stored.room;
  }

  async dissolveRoom(roomId: string, at: string): Promise<boolean> {
    const stored = this.#rooms.get(roomId);
    if (!stored || stored.dissolvedAt) {
      return false;
    }
    stored.dissolvedAt = at;
    for (const member of this.#members.values()) {
      if (member.roomId === roomId) {
        this.#removedMembers.add(member.id);
      }
    }
    for (const key of this.#tokenIndex.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        this.#tokenIndex.delete(key);
      }
    }
    for (const key of this.#userIndex.keys()) {
      if (key.startsWith(`${roomId}:`)) {
        this.#userIndex.delete(key);
      }
    }
    for (const [agentId, ownership] of this.#agentOwnerships) {
      if (ownership.roomId === roomId) {
        this.#agentOwnerships.delete(agentId);
      }
    }
    for (const [agentId, claim] of this.#agentClaims) {
      if (claim.roomId === roomId) {
        this.#agentClaims.delete(agentId);
      }
    }
    for (const [grantId, grant] of this.#agentUserGrants) {
      if (grant.roomId === roomId) {
        this.#agentUserGrants.delete(grantId);
      }
    }
    for (const [collaborationId, collaboration] of this.#agentCollaborations) {
      if (collaboration.roomId === roomId) {
        this.#agentCollaborations.delete(collaborationId);
      }
    }
    return true;
  }

  async inviteCodeMatches(
    roomId: string,
    inviteCodeHash: string,
  ): Promise<boolean> {
    const stored = this.#rooms.get(roomId);
    return Boolean(
      stored &&
        !stored.dissolvedAt &&
        stored.inviteCodeHash === inviteCodeHash,
    );
  }

  async updateInviteCode(
    roomId: string,
    inviteCodeHash: string,
  ): Promise<void> {
    const storedRoom = this.#rooms.get(roomId);
    if (!storedRoom || storedRoom.dissolvedAt) {
      throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
    }
    storedRoom.inviteCodeHash = inviteCodeHash;
  }

  async addMember(record: AddMemberRecord): Promise<void> {
    const storedRoom = this.#rooms.get(record.member.roomId);
    if (!storedRoom || storedRoom.dissolvedAt) {
      throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
    }
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
      this.#memberUserIds.set(record.member.id, record.userId);
    }
    if (record.agentClaim) {
      this.#agentClaims.set(record.member.id, record.agentClaim);
    }
  }

  async listRoomsForUser(userId: string): Promise<AccountRoomMembership[]> {
    const memberships: AccountRoomMembership[] = [];
    for (const [key, memberId] of this.#userIndex) {
      if (!key.endsWith(`:${userId}`)) {
        continue;
      }
      const member = this.#members.get(memberId);
      const storedRoom = member ? this.#rooms.get(member.roomId) : undefined;
      const room = storedRoom?.room;
      if (
        member &&
        room &&
        !storedRoom?.dissolvedAt &&
        !this.#removedMembers.has(member.id)
      ) {
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
    return member?.roomId === roomId && !this.#removedMembers.has(memberId)
      ? member
      : undefined;
  }

  async isActiveMember(roomId: string, memberId: string): Promise<boolean> {
    const member = this.#members.get(memberId);
    return (
      !!member &&
      member.roomId === roomId &&
      !this.#rooms.get(roomId)?.dissolvedAt &&
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

  async findUserIdByMemberId(
    roomId: string,
    memberId: string,
  ): Promise<string | undefined> {
    const member = await this.findMember(roomId, memberId);
    return member ? this.#memberUserIds.get(memberId) : undefined;
  }

  async issueAgentClaim(record: AgentClaimRecord): Promise<void> {
    const member = await this.findMember(record.roomId, record.agentMemberId);
    if (!member || member.actorType !== "agent") {
      throw new AppError(404, "AGENT_NOT_FOUND", "Agent member not found");
    }
    if (this.#agentOwnerships.has(record.agentMemberId)) {
      throw new AppError(
        409,
        "AGENT_ALREADY_OWNED",
        "The agent already has an owner",
      );
    }
    this.#agentClaims.set(record.agentMemberId, record);
  }

  async claimAgent(record: ClaimAgentRecord): Promise<AgentOwnership> {
    const member = await this.findMember(record.roomId, record.agentMemberId);
    const claim = this.#agentClaims.get(record.agentMemberId);
    if (!member || member.actorType !== "agent") {
      throw new AppError(404, "AGENT_NOT_FOUND", "Agent member not found");
    }
    if (this.#agentOwnerships.has(record.agentMemberId)) {
      throw new AppError(
        409,
        "AGENT_ALREADY_OWNED",
        "The agent already has an owner",
      );
    }
    if (
      !claim ||
      claim.roomId !== record.roomId ||
      claim.codeHash !== record.codeHash ||
      claim.expiresAt <= record.claimedAt
    ) {
      throw new AppError(
        400,
        "INVALID_AGENT_CLAIM",
        "The agent claim code is invalid or expired",
      );
    }
    const ownership: AgentOwnership = {
      roomId: record.roomId,
      agentMemberId: record.agentMemberId,
      ownerUserId: record.ownerUserId,
      claimedAt: record.claimedAt,
    };
    this.#agentOwnerships.set(record.agentMemberId, ownership);
    this.#agentClaims.delete(record.agentMemberId);
    return ownership;
  }

  async findAgentOwnership(
    roomId: string,
    agentMemberId: string,
  ): Promise<AgentOwnership | undefined> {
    const ownership = this.#agentOwnerships.get(agentMemberId);
    return ownership?.roomId === roomId ? ownership : undefined;
  }

  async listAgentOwnerships(roomId: string): Promise<AgentOwnership[]> {
    return [...this.#agentOwnerships.values()].filter(
      (ownership) => ownership.roomId === roomId,
    );
  }

  async hasAgentUserGrant(
    roomId: string,
    agentMemberId: string,
    granteeUserId: string,
  ): Promise<boolean> {
    return [...this.#agentUserGrants.values()].some(
      (grant) =>
        grant.roomId === roomId &&
        grant.agentMemberId === agentMemberId &&
        grant.granteeUserId === granteeUserId,
    );
  }

  async createAgentUserGrant(
    record: StoredAgentUserGrant,
  ): Promise<StoredAgentUserGrant> {
    if (await this.hasAgentUserGrant(
      record.roomId,
      record.agentMemberId,
      record.granteeUserId,
    )) {
      throw new AppError(
        409,
        "AGENT_GRANT_EXISTS",
        "This user can already dispatch the agent",
      );
    }
    this.#agentUserGrants.set(record.id, record);
    return record;
  }

  async listAgentUserGrants(roomId: string): Promise<StoredAgentUserGrant[]> {
    return [...this.#agentUserGrants.values()].filter(
      (grant) => grant.roomId === roomId,
    );
  }

  async deleteAgentUserGrant(
    roomId: string,
    grantId: string,
    agentMemberId: string,
  ): Promise<boolean> {
    const grant = this.#agentUserGrants.get(grantId);
    if (
      !grant ||
      grant.roomId !== roomId ||
      grant.agentMemberId !== agentMemberId
    ) {
      return false;
    }
    return this.#agentUserGrants.delete(grantId);
  }

  async createAgentCollaboration(
    collaboration: AgentCollaboration,
  ): Promise<AgentCollaboration> {
    if (
      [...this.#agentCollaborations.values()].some(
        (existing) =>
          existing.roomId === collaboration.roomId &&
          ["pending", "active"].includes(existing.status) &&
          sameAgentPair(existing, collaboration),
      )
    ) {
      throw new AppError(
        409,
        "AGENT_COLLABORATION_EXISTS",
        "These agents already have an open collaboration",
      );
    }
    this.#agentCollaborations.set(collaboration.id, collaboration);
    return collaboration;
  }

  async listAgentCollaborations(roomId: string): Promise<AgentCollaboration[]> {
    return [...this.#agentCollaborations.values()]
      .filter((collaboration) => collaboration.roomId === roomId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async updateAgentCollaboration(
    roomId: string,
    collaborationId: string,
    allowedFrom: AgentCollaboration["status"][],
    status: AgentCollaboration["status"],
    updatedAt: string,
  ): Promise<AgentCollaboration> {
    const collaboration = this.#agentCollaborations.get(collaborationId);
    if (!collaboration || collaboration.roomId !== roomId) {
      throw new AppError(
        404,
        "AGENT_COLLABORATION_NOT_FOUND",
        "Agent collaboration not found",
      );
    }
    if (!allowedFrom.includes(collaboration.status)) {
      throw new AppError(
        409,
        "INVALID_COLLABORATION_TRANSITION",
        `Collaboration cannot transition from ${collaboration.status} to ${status}`,
      );
    }
    const updated = { ...collaboration, status, updatedAt };
    this.#agentCollaborations.set(collaboration.id, updated);
    return updated;
  }

  async hasActiveAgentCollaboration(
    roomId: string,
    firstAgentMemberId: string,
    secondAgentMemberId: string,
  ): Promise<boolean> {
    return [...this.#agentCollaborations.values()].some(
      (collaboration) =>
        collaboration.roomId === roomId &&
        collaboration.status === "active" &&
        sameAgentPair(collaboration, {
          requesterAgentMemberId: firstAgentMemberId,
          targetAgentMemberId: secondAgentMemberId,
        }),
    );
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
    if (!storedRoom || storedRoom.dissolvedAt) {
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
    const removedUserId = this.#memberUserIds.get(memberId);
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
    this.#memberUserIds.delete(memberId);
    this.#agentClaims.delete(memberId);
    this.#agentOwnerships.delete(memberId);
    for (const [grantId, grant] of this.#agentUserGrants) {
      if (
        grant.agentMemberId === memberId ||
        (removedUserId !== undefined && grant.granteeUserId === removedUserId)
      ) {
        this.#agentUserGrants.delete(grantId);
      }
    }
    for (const [collaborationId, collaboration] of this.#agentCollaborations) {
      if (
        collaboration.requesterAgentMemberId === memberId ||
        collaboration.targetAgentMemberId === memberId
      ) {
        this.#agentCollaborations.delete(collaborationId);
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

function sameAgentPair(
  left: Pick<
    AgentCollaboration,
    "requesterAgentMemberId" | "targetAgentMemberId"
  >,
  right: Pick<
    AgentCollaboration,
    "requesterAgentMemberId" | "targetAgentMemberId"
  >,
): boolean {
  return (
    (left.requesterAgentMemberId === right.requesterAgentMemberId &&
      left.targetAgentMemberId === right.targetAgentMemberId) ||
    (left.requesterAgentMemberId === right.targetAgentMemberId &&
      left.targetAgentMemberId === right.requesterAgentMemberId)
  );
}
