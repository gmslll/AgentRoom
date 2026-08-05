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
  PendingAgentDelivery,
  Room,
  RoomConnectorInfo,
  RoomMember,
  RoomMessage,
} from "./types.js";
import type { UserAccount } from "../auth/types.js";

export interface CreateRoomInput {
  name: string;
  displayName: string;
  ownerUserId: string | null;
}

export interface JoinRoomInput {
  roomId: string;
  inviteCode: string;
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

const allowedDeliverySources: Record<
  "received" | "running" | "failed",
  DeliveryStatus[]
> = {
  received: ["queued", "received"],
  running: ["queued", "received", "running"],
  failed: ["queued", "received", "running", "failed"],
};

export class RoomService {
  constructor(
    private readonly repository: RoomRepository,
    private readonly eventBus: EventBus,
    private readonly now: () => Date = () => new Date(),
    private readonly authenticateAccount?: (
      accessToken: string,
    ) => Promise<UserAccount>,
    private readonly publicBaseUrl = "http://127.0.0.1:8787",
  ) {}

  async createRoom(input: CreateRoomInput): Promise<CreatedRoomAccess> {
    const createdAt = this.now().toISOString();
    const room: Room = {
      id: createId("room"),
      name: input.name,
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
    const inviteMatches = await this.repository.inviteCodeMatches(
      input.roomId,
      hashSecret(input.inviteCode),
    );

    if (!inviteMatches) {
      throw new AppError(403, "INVALID_INVITE", "The invite code is invalid");
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

    this.eventBus.publish({
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

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const member = await this.authenticate(input.roomId, input.accessToken);

    if (input.kind === "agent.task") {
      return this.sendAgentTask(input, member);
    }

    const message = await this.appendMessage({
      roomId: input.roomId,
      member,
      kind: "text",
      text: input.text,
      targetMemberIds: [],
      idempotencyKey: null,
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
  }): Promise<{ delivery: AgentDelivery; message: RoomMessage }> {
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
      }),
      updatedAt: this.now().toISOString(),
    });

    this.publishMessage(message);
    this.publishDeliveryUpdated(delivery);
    return { delivery, message };
  }

  private async sendAgentTask(
    input: Extract<SendMessageInput, { kind: "agent.task" }>,
    member: RoomMember,
  ): Promise<SendMessageResult> {
    if (member.role !== "owner") {
      throw new AppError(
        403,
        "AGENT_TRIGGER_FORBIDDEN",
        "Only the room owner can trigger agents in the MVP",
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
      }),
      targetMemberIds,
    });
    if (!result.created) {
      return result;
    }

    this.publishMessage(result.message);
    for (const delivery of result.deliveries) {
      this.eventBus.publish(
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
  }): Promise<RoomMessage> {
    return this.repository.appendMessage(this.buildMessageRecord(input));
  }

  private buildMessageRecord(input: {
    roomId: string;
    member: RoomMember;
    kind: RoomMessage["kind"];
    text: string;
    targetMemberIds: string[];
    idempotencyKey: string | null;
  }): AppendMessageRecord {
    return {
      id: createId("msg"),
      ...input,
      inReplyToMessageId: null,
      attachmentIds: [],
      createdAt: this.now().toISOString(),
    };
  }

  private publishMessage(message: RoomMessage): void {
    this.eventBus.publish({
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
    this.eventBus.publish({
      version: 1,
      eventId: createId("evt"),
      type: "delivery.updated",
      roomId: delivery.roomId,
      occurredAt: delivery.updatedAt,
      data: { delivery },
    });
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
    return {
      command:
        `npx --yes @agentroom/bridge join ${roomId}` +
        ` --base-url ${JSON.stringify(this.publicBaseUrl)}`,
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
        "Only the room owner can manage room connection credentials",
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
