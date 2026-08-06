import { AppError } from "../../lib/errors.js";
import { createId, createSecret, hashSecret } from "../../lib/secrets.js";
import type { EventBus } from "../realtime/event-bus.js";
import type { AppendMessageRecord, RoomRepository } from "./repository.js";
import type {
  AccountRoomMembership,
  AgentDelivery,
  AgentProvider,
  ActorType,
  DeliveryStatus,
  ModerationRule,
  PendingAgentDelivery,
  RealtimeServerEvent,
  Room,
  RoomConnectorInfo,
  RoomMember,
  RoomMessage,
  RoomVisibility,
} from "./types.js";
import type { UserAccount } from "../auth/types.js";

export interface CreateRoomInput {
  name: string;
  displayName: string;
  ownerUserId: string | null;
  visibility?: RoomVisibility;
}

export interface JoinRoomInput {
  roomId: string;
  inviteCode?: string;
  displayName: string;
  actorType: ActorType;
  agentProvider: AgentProvider | null;
  userId: string | null;
}

export interface RoomAccess {
  room: Room;
  member: RoomMember;
  accessToken: string;
}

export interface CreatedRoomAccess extends RoomAccess {
  inviteCode: string;
  connectorCommand: string;
  connector: RoomConnectorInfo;
}

export type SendMessageInput =
  | {
      kind: "text";
      roomId: string;
      accessToken: string;
      text: string;
      attachmentIds?: string[];
    }
  | {
      kind: "agent.task";
      roomId: string;
      accessToken: string;
      text: string;
      targetMemberIds: string[];
      idempotencyKey: string;
    };

export interface SendMessageResult {
  message: RoomMessage;
  deliveries: AgentDelivery[];
  created: boolean;
}

export interface RelayResult {
  message: RoomMessage;
  deliveries: AgentDelivery[];
  created: boolean;
}

export interface ReplyResult {
  delivery: AgentDelivery;
  message: RoomMessage;
  relay?: RelayResult;
}

const allowedDeliverySources: Record<
  "received" | "running" | "failed",
  DeliveryStatus[]
> = {
  received: ["queued", "received"],
  running: ["queued", "received", "running"],
  failed: ["queued", "received", "running", "failed"],
};

export interface RoomServiceOptions {
  validateAttachments?: (
    roomId: string,
    attachmentIds: string[],
  ) => Promise<boolean>;
  moderationEnabled?: boolean;
}

export class RoomService {
  readonly #attachmentValidator:
    | ((roomId: string, attachmentIds: string[]) => Promise<boolean>)
    | undefined;
  readonly #moderationEnabled: boolean;

  constructor(
    private readonly repository: RoomRepository,
    private readonly eventBus: EventBus,
    private readonly now: () => Date = () => new Date(),
    private readonly authenticateAccount?: (
      accessToken: string,
    ) => Promise<UserAccount>,
    private readonly publicBaseUrl = "http://127.0.0.1:8787",
    options: RoomServiceOptions = {},
  ) {
    this.#attachmentValidator = options.validateAttachments;
    this.#moderationEnabled = options.moderationEnabled ?? false;
  }

  async createRoom(input: CreateRoomInput): Promise<CreatedRoomAccess> {
    const createdAt = this.now().toISOString();
    const room: Room = {
      id: createId("room"),
      name: input.name,
      visibility: input.visibility ?? "private",
      createdAt,
    };
    const owner: RoomMember = {
      id: createId("mem"),
      roomId: room.id,
      displayName: input.displayName,
      actorType: "human",
      agentProvider: null,
      role: "owner",
      joinedAt: createdAt,
    };
    const accessToken = createSecret("art");
    const inviteCode = createSecret("ari", 12);

    await this.repository.createRoom({
      room,
      owner,
      ownerUserId: input.ownerUserId,
      ownerTokenHash: hashSecret(accessToken),
      inviteCodeHash: hashSecret(inviteCode),
    });

    const connector = this.connectorInfo(room.id);
    return {
      room,
      member: owner,
      accessToken,
      inviteCode,
      connectorCommand: connector.command,
      connector,
    };
  }

  async joinRoom(input: JoinRoomInput): Promise<RoomAccess> {
    const room = await this.requireRoom(input.roomId);
    this.validateAgentProvider(input.actorType, input.agentProvider);
    if (room.visibility === "private") {
      const inviteMatches = input.inviteCode
        ? await this.repository.inviteCodeMatches(
            input.roomId,
            hashSecret(input.inviteCode),
          )
        : false;
      if (!inviteMatches) {
        throw new AppError(
          403,
          "INVALID_INVITE",
          "A valid invite code is required for this private room",
        );
      }
    }

    const member: RoomMember = {
      id: createId("mem"),
      roomId: room.id,
      displayName: input.displayName,
      actorType: input.actorType,
      agentProvider: input.agentProvider,
      role: "member",
      joinedAt: this.now().toISOString(),
    };
    const accessToken = createSecret("art");

    await this.repository.addMember({
      member,
      userId: input.userId,
      tokenHash: hashSecret(accessToken),
    });

    this.#publish({
      version: 1,
      eventId: createId("evt"),
      type: "member.joined",
      roomId: room.id,
      occurredAt: member.joinedAt,
      data: { member },
    });

    return { room, member, accessToken };
  }

  async authenticate(roomId: string, accessToken: string): Promise<RoomMember> {
    await this.requireRoom(roomId);
    const member = accessToken.startsWith("ars_")
      ? await this.findAccountMember(roomId, accessToken)
      : await this.repository.findMemberByTokenHash(
          roomId,
          hashSecret(accessToken),
        );

    if (!member) {
      throw new AppError(401, "INVALID_TOKEN", "The access token is invalid");
    }

    return member;
  }

  async listRoomsForUser(userId: string): Promise<AccountRoomMembership[]> {
    return this.repository.listRoomsForUser(userId);
  }

  async listPublicRooms(limit: number): Promise<Room[]> {
    return this.repository.listPublicRooms(limit);
  }

  async updateRoom(input: {
    roomId: string;
    accessToken: string;
    name?: string;
    visibility?: RoomVisibility;
  }): Promise<Room> {
    await this.requireOwner(input.roomId, input.accessToken);
    if (input.name === undefined && input.visibility === undefined) {
      throw new AppError(
        400,
        "EMPTY_ROOM_UPDATE",
        "At least one room setting must be provided",
      );
    }
    const room = await this.repository.updateRoom(input.roomId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.visibility !== undefined
        ? { visibility: input.visibility }
        : {}),
    });
    if (!room) {
      throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
    }
    this.#publish({
      version: 1,
      eventId: createId("evt"),
      type: "room.updated",
      roomId: room.id,
      occurredAt: this.now().toISOString(),
      data: { room },
    });
    return room;
  }

  async dissolveRoom(input: {
    roomId: string;
    accessToken: string;
  }): Promise<void> {
    const owner = await this.requireOwner(input.roomId, input.accessToken);
    const occurredAt = this.now().toISOString();
    const dissolved = await this.repository.dissolveRoom(
      input.roomId,
      occurredAt,
    );
    if (!dissolved) {
      throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
    }
    this.#publish({
      version: 1,
      eventId: createId("evt"),
      type: "room.dissolved",
      roomId: input.roomId,
      occurredAt,
      data: { dissolvedByMemberId: owner.id },
    });
  }

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const member = await this.authenticate(input.roomId, input.accessToken);

    if (input.kind === "agent.task") {
      return this.sendAgentTask(input, member, false);
    }

    const message = await this.appendMessage({
      roomId: input.roomId,
      member,
      kind: "text",
      text: input.text,
      targetMemberIds: [],
      idempotencyKey: null,
      attachmentIds: input.attachmentIds ?? [],
      moderation: await this.#moderationOutcome(input.roomId, input.text),
    });
    this.publishMessage(message);
    return { message, deliveries: [], created: true };
  }

  async listMessages(input: {
    roomId: string;
    accessToken: string;
    afterSequence: number;
    limit: number;
  }): Promise<RoomMessage[]> {
    await this.authenticate(input.roomId, input.accessToken);
    return this.repository.listMessages(input);
  }

  async listMembers(input: {
    roomId: string;
    accessToken: string;
  }): Promise<RoomMember[]> {
    await this.authenticate(input.roomId, input.accessToken);
    return this.repository.listMembers(input.roomId);
  }

  /** True when the member still belongs to the room and was not removed. */
  async isActiveMember(roomId: string, memberId: string): Promise<boolean> {
    return this.repository.isActiveMember(roomId, memberId);
  }

  async removeMember(input: {
    roomId: string;
    accessToken: string;
    memberId: string;
  }): Promise<void> {
    const owner = await this.requireOwner(input.roomId, input.accessToken);
    if (owner.id === input.memberId) {
      throw new AppError(
        400,
        "CANNOT_REMOVE_OWNER",
        "The room owner cannot be removed",
      );
    }
    const removed = await this.repository.removeMember(
      input.roomId,
      input.memberId,
      this.now().toISOString(),
    );
    if (!removed) {
      throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found");
    }
    this.#publish({
      version: 1,
      eventId: createId("evt"),
      type: "member.removed",
      roomId: input.roomId,
      occurredAt: this.now().toISOString(),
      data: { memberId: input.memberId },
    });
  }

  async rotateInviteCode(input: {
    roomId: string;
    accessToken: string;
  }): Promise<{
    inviteCode: string;
    connectorCommand: string;
    connector: RoomConnectorInfo;
  }> {
    await this.requireOwner(input.roomId, input.accessToken);
    const inviteCode = createSecret("ari", 12);
    await this.repository.updateInviteCode(
      input.roomId,
      hashSecret(inviteCode),
    );
    const connector = this.connectorInfo(input.roomId);
    return {
      inviteCode,
      connectorCommand: connector.command,
      connector,
    };
  }

  async getConnectorInfo(input: {
    roomId: string;
    accessToken: string;
  }): Promise<{ connectorCommand: string; connector: RoomConnectorInfo }> {
    await this.requireOwner(input.roomId, input.accessToken);
    const connector = this.connectorInfo(input.roomId);
    return { connectorCommand: connector.command, connector };
  }

  async listPendingDeliveries(input: {
    roomId: string;
    accessToken: string;
  }): Promise<PendingAgentDelivery[]> {
    const member = await this.authenticate(input.roomId, input.accessToken);
    if (member.actorType !== "agent") {
      throw new AppError(
        403,
        "AGENT_MEMBERSHIP_REQUIRED",
        "Only agent members have task deliveries",
      );
    }
    return this.repository.listPendingDeliveries(input.roomId, member.id);
  }

  async updateDeliveryStatus(input: {
    roomId: string;
    deliveryId: string;
    accessToken: string;
    status: "received" | "running" | "failed";
    error: string | null;
  }): Promise<AgentDelivery> {
    const member = await this.authenticate(input.roomId, input.accessToken);
    const delivery = await this.repository.updateDelivery({
      roomId: input.roomId,
      deliveryId: input.deliveryId,
      targetMemberId: member.id,
      status: input.status,
      allowedFrom: allowedDeliverySources[input.status],
      error: input.status === "failed" ? input.error : null,
      updatedAt: this.now().toISOString(),
    });
    this.publishDeliveryUpdated(delivery);
    return delivery;
  }

  async replyToDelivery(input: {
    roomId: string;
    deliveryId: string;
    accessToken: string;
    text: string;
    relay?: { targetMemberIds: string[]; idempotencyKey: string };
  }): Promise<ReplyResult> {
    const member = await this.authenticate(input.roomId, input.accessToken);
    const { delivery, message } = await this.repository.replyToDelivery({
      roomId: input.roomId,
      deliveryId: input.deliveryId,
      targetMemberId: member.id,
      message: this.buildMessageRecord({
        roomId: input.roomId,
        member,
        kind: "agent.reply",
        text: input.text,
        targetMemberIds: [],
        idempotencyKey: null,
        attachmentIds: [],
        moderation: await this.#moderationOutcome(input.roomId, input.text),
      }),
      updatedAt: this.now().toISOString(),
    });

    this.publishMessage(message);
    this.publishDeliveryUpdated(delivery);

    let relay: RelayResult | undefined;
    if (input.relay) {
      relay = await this.sendAgentTask(
        {
          kind: "agent.task",
          roomId: input.roomId,
          accessToken: input.accessToken,
          text: message.text,
          targetMemberIds: input.relay.targetMemberIds,
          idempotencyKey: input.relay.idempotencyKey,
        },
        member,
        true,
      );
    }

    return relay ? { delivery, message, relay } : { delivery, message };
  }

  async listModerationRules(input: {
    roomId: string;
    accessToken: string;
  }): Promise<ModerationRule[]> {
    await this.requireOwner(input.roomId, input.accessToken);
    return this.repository.listModerationRules(input.roomId);
  }

  async createModerationRule(input: {
    roomId: string;
    accessToken: string;
    pattern: string;
    action: ModerationRule["action"];
  }): Promise<ModerationRule> {
    const owner = await this.requireOwner(input.roomId, input.accessToken);
    const rule: ModerationRule = {
      id: createId("mod"),
      roomId: input.roomId,
      pattern: input.pattern,
      action: input.action,
      createdAt: this.now().toISOString(),
    };
    return this.repository.createModerationRule(rule, owner.id);
  }

  async deleteModerationRule(input: {
    roomId: string;
    accessToken: string;
    ruleId: string;
  }): Promise<void> {
    await this.requireOwner(input.roomId, input.accessToken);
    const deleted = await this.repository.deleteModerationRule(
      input.roomId,
      input.ruleId,
    );
    if (!deleted) {
      throw new AppError(404, "RULE_NOT_FOUND", "Moderation rule not found");
    }
  }

  private async sendAgentTask(
    input: Extract<SendMessageInput, { kind: "agent.task" }>,
    member: RoomMember,
    allowAgentRelay: boolean,
  ): Promise<SendMessageResult> {
    // Any room member (human, terminal, or owner) may trigger agents.
    // Agent members must go through the explicit relay path so replies do
    // not self-trigger new tasks; the UI never exposes dispatch to agents.
    const allowed =
      member.actorType === "agent" ? allowAgentRelay : true;
    if (!allowed) {
      throw new AppError(
        403,
        "AGENT_TRIGGER_FORBIDDEN",
        "Agent members can only trigger via explicit relay",
      );
    }

    const targetMemberIds = [...new Set(input.targetMemberIds)].sort();
    if (targetMemberIds.length === 0 || targetMemberIds.length > 10) {
      throw new AppError(
        400,
        "INVALID_AGENT_TARGETS",
        "Agent tasks require between 1 and 10 unique targets",
      );
    }

    for (const targetMemberId of targetMemberIds) {
      const target = await this.repository.findMember(
        input.roomId,
        targetMemberId,
      );
      if (!target || target.actorType !== "agent") {
        throw new AppError(
          400,
          "INVALID_AGENT_TARGET",
          `Target ${targetMemberId} is not an agent in this room`,
        );
      }
    }

    const result = await this.repository.createAgentTask({
      message: this.buildMessageRecord({
        roomId: input.roomId,
        member,
        kind: "agent.task",
        text: input.text,
        targetMemberIds,
        idempotencyKey: input.idempotencyKey,
        attachmentIds: [],
        moderation: await this.#moderationOutcome(input.roomId, input.text),
      }),
      targetMemberIds,
    });
    if (!result.created) {
      return result;
    }

    this.publishMessage(result.message);
    for (const delivery of result.deliveries) {
      this.#publish(
        {
          version: 1,
          eventId: createId("evt"),
          type: "delivery.queued",
          roomId: result.message.roomId,
          occurredAt: delivery.createdAt,
          data: { delivery, task: result.message },
        },
        [delivery.targetMemberId],
      );
    }

    return result;
  }

  private async appendMessage(input: {
    roomId: string;
    member: RoomMember;
    kind: RoomMessage["kind"];
    text: string;
    targetMemberIds: string[];
    idempotencyKey: string | null;
    attachmentIds: string[];
    moderation?: RoomMessage["moderation"];
  }): Promise<RoomMessage> {
    await this.#validateAttachments(input.roomId, input.attachmentIds);
    return this.repository.appendMessage(this.buildMessageRecord(input));
  }

  private buildMessageRecord(input: {
    roomId: string;
    member: RoomMember;
    kind: RoomMessage["kind"];
    text: string;
    targetMemberIds: string[];
    idempotencyKey: string | null;
    attachmentIds: string[];
    moderation?: RoomMessage["moderation"];
  }): AppendMessageRecord {
    return {
      id: createId("msg"),
      ...input,
      inReplyToMessageId: null,
      createdAt: this.now().toISOString(),
      ...(input.moderation ? { moderation: input.moderation } : {}),
    };
  }

  /**
   * Applies room moderation rules. Returns "reject" when a rule forbids the
   * text (callers throw), otherwise the moderation outcome to attach to the
   * message. Returns undefined when moderation is disabled.
   */
  /**
   * Applies room moderation and rejects forbidden text with 403 when a rule
   * demands rejection. Returns the moderation outcome, or undefined when
   * moderation is disabled.
   */
  async #moderationOutcome(
    roomId: string,
    text: string,
  ): Promise<RoomMessage["moderation"] | undefined> {
    const outcome = await this.#moderate(roomId, text);
    if (outcome === "reject") {
      throw new AppError(
        403,
        "MODERATION_REJECTED",
        "This message was rejected by a room moderation rule",
      );
    }
    return outcome;
  }

  async #moderate(
    roomId: string,
    text: string,
  ): Promise<RoomMessage["moderation"] | "reject" | undefined> {
    if (!this.#moderationEnabled) {
      return undefined;
    }
    const rules = await this.repository.listModerationRules(roomId);
    const normalized = text.toLowerCase();
    for (const rule of rules) {
      if (normalized.includes(rule.pattern.toLowerCase())) {
        if (rule.action === "reject") {
          return "reject";
        }
        return { state: "flagged", reason: rule.pattern };
      }
    }
    return { state: "clean" };
  }

  async #validateAttachments(
    roomId: string,
    attachmentIds: string[],
  ): Promise<void> {
    if (attachmentIds.length === 0) {
      return;
    }
    if (!this.#attachmentValidator) {
      throw new AppError(
        400,
        "ATTACHMENTS_UNSUPPORTED",
        "File attachments are not enabled on this server",
      );
    }
    const valid = await this.#attachmentValidator(roomId, attachmentIds);
    if (!valid) {
      throw new AppError(
        400,
        "INVALID_ATTACHMENT",
        "One or more attachments do not exist in this room",
      );
    }
  }

  private publishMessage(message: RoomMessage): void {
    this.#publish({
      version: 1,
      eventId: createId("evt"),
      type: "message.created",
      roomId: message.roomId,
      sequence: message.sequence,
      occurredAt: message.createdAt,
      data: { message },
    });
  }

  private publishDeliveryUpdated(delivery: AgentDelivery): void {
    this.#publish({
      version: 1,
      eventId: createId("evt"),
      type: "delivery.updated",
      roomId: delivery.roomId,
      occurredAt: delivery.updatedAt,
      data: { delivery },
    });
  }

  /**
   * Publishes a realtime event. With a transactional outbox (PostgreSQL mode)
   * the event is enqueued with its audience and the outbox drainer delivers
   * it; enqueue failures degrade to direct fan-out. Without an outbox the
   * event is published immediately.
   */
  #publish(event: RealtimeServerEvent, audienceMemberIds?: string[]): void {
    if (this.repository.enqueueOutbox) {
      void this.repository
        .enqueueOutbox(event.roomId, { event, audienceMemberIds })
        .catch((error) => {
          console.error(
            `AgentRoom outbox enqueue failed for ${event.eventId}; falling back to direct fan-out:`,
            error,
          );
          this.eventBus.publish(event, audienceMemberIds);
        });
      return;
    }
    this.eventBus.publish(event, audienceMemberIds);
  }

  private validateAgentProvider(
    actorType: ActorType,
    agentProvider: AgentProvider | null,
  ): void {
    if (actorType === "agent" && !agentProvider) {
      throw new AppError(
        400,
        "AGENT_PROVIDER_REQUIRED",
        "Agent members must declare their provider",
      );
    }
    if (actorType !== "agent" && agentProvider) {
      throw new AppError(
        400,
        "AGENT_PROVIDER_NOT_ALLOWED",
        "Only agent members can declare an agent provider",
      );
    }
  }

  private async findAccountMember(
    roomId: string,
    accessToken: string,
  ): Promise<RoomMember | undefined> {
    if (!this.authenticateAccount) {
      return undefined;
    }
    const user = await this.authenticateAccount(accessToken);
    return this.repository.findMemberByUserId(roomId, user.id);
  }

  private connectorInfo(roomId: string): RoomConnectorInfo {
    const commandSuffix =
      ` ${roomId}` + ` --base-url ${JSON.stringify(this.publicBaseUrl)}`;
    const downloadBase = `${this.publicBaseUrl}/downloads/cli`;
    return {
      command: `agentroom join${commandSuffix}`,
      attachCommand: `agentroom attach${commandSuffix}`,
      distribution: "direct-download",
      installers: {
        manifestUrl: `${downloadBase}/manifest.json`,
        macosLinuxUrl: `${downloadBase}/install.sh`,
        windowsUrl: `${downloadBase}/install.ps1`,
      },
      packageName: "@agentroom/bridge",
      nodeVersion: ">=22",
      supportedProviders: ["claude", "codex"],
    };
  }

  private async requireOwner(
    roomId: string,
    accessToken: string,
  ): Promise<RoomMember> {
    const member = await this.authenticate(roomId, accessToken);
    if (member.role !== "owner") {
      throw new AppError(
        403,
        "OWNER_REQUIRED",
        "Only the room owner can manage this room",
      );
    }
    return member;
  }

  private async requireRoom(roomId: string): Promise<Room> {
    const room = await this.repository.findRoom(roomId);
    if (!room) {
      throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
    }
    return room;
  }
}
