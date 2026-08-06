import { Pool, type PoolClient, type QueryResultRow } from "pg";
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
  OutboxEntry,
  ReplyToDeliveryRecord,
  RoomRepository,
  StoredAgentUserGrant,
  UpdateDeliveryRecord,
} from "./repository.js";
import type {
  AccountRoomMembership,
  ActorType,
  AgentCollaboration,
  AgentDelivery,
  AgentOwnership,
  AgentProvider,
  DeliveryStatus,
  ModerationAction,
  ModerationRule,
  PendingAgentDelivery,
  Room,
  RoomMember,
  RoomMessage,
} from "./types.js";

interface RoomRow extends QueryResultRow {
  id: string;
  name: string;
  visibility: Room["visibility"];
  created_at: Date;
}

interface MemberRow extends QueryResultRow {
  id: string;
  room_id: string;
  display_name: string;
  actor_type: ActorType;
  agent_provider: AgentProvider | null;
  role: RoomMember["role"];
  joined_at: Date;
}

interface AccountRoomRow extends QueryResultRow {
  room_id: string;
  room_name: string;
  room_visibility: Room["visibility"];
  room_created_at: Date;
  member_id: string;
  member_display_name: string;
  member_actor_type: ActorType;
  member_agent_provider: AgentProvider | null;
  member_role: RoomMember["role"];
  member_joined_at: Date;
}

interface MessageRow extends QueryResultRow {
  id: string;
  room_id: string;
  sequence: string | number;
  kind: RoomMessage["kind"];
  text: string;
  attachment_ids: string[];
  target_member_ids: string[];
  in_reply_to_message_id: string | null;
  idempotency_key: string | null;
  author_member_id: string;
  author_display_name: string;
  author_actor_type: ActorType;
  author_agent_provider: AgentProvider | null;
  created_at: Date;
  moderation_state: string | null;
  moderation_reason: string | null;
}

interface DeliveryRow extends QueryResultRow {
  id: string;
  room_id: string;
  task_message_id: string;
  target_member_id: string;
  status: DeliveryStatus;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

interface ModerationRuleRow extends QueryResultRow {
  id: string;
  room_id: string;
  pattern: string;
  action: string;
  created_at: Date;
}

interface AgentOwnershipRow extends QueryResultRow {
  room_id: string;
  agent_member_id: string;
  owner_user_id: string;
  claimed_at: Date;
}

interface AgentUserGrantRow extends QueryResultRow {
  id: string;
  room_id: string;
  agent_member_id: string;
  grantee_user_id: string;
  created_at: Date;
}

interface AgentCollaborationRow extends QueryResultRow {
  id: string;
  room_id: string;
  requester_agent_member_id: string;
  target_agent_member_id: string;
  status: AgentCollaboration["status"];
  created_at: Date;
  updated_at: Date;
}

interface PendingRow extends QueryResultRow {
  delivery_id: string;
  delivery_room_id: string;
  delivery_task_message_id: string;
  delivery_target_member_id: string;
  delivery_status: DeliveryStatus;
  delivery_error: string | null;
  delivery_created_at: Date;
  delivery_updated_at: Date;
  message_id: string;
  message_room_id: string;
  message_sequence: string | number;
  message_kind: RoomMessage["kind"];
  message_text: string;
  message_attachment_ids: string[];
  message_target_member_ids: string[];
  message_in_reply_to_message_id: string | null;
  message_idempotency_key: string | null;
  message_author_member_id: string;
  message_author_display_name: string;
  message_author_actor_type: ActorType;
  message_author_agent_provider: AgentProvider | null;
  message_created_at: Date;
  message_moderation_state: string | null;
  message_moderation_reason: string | null;
}

export class PostgresRoomRepository implements RoomRepository {
  readonly #pool: Pool;

  constructor(connectionString: string) {
    this.#pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
      query_timeout: 20_000,
    });
    this.#pool.on("error", (error) => {
      console.error("Unexpected idle PostgreSQL client error:", error);
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async healthCheck(): Promise<void> {
    const result = await this.#pool.query<{ rooms_table: string | null }>(
      "SELECT to_regclass('public.rooms')::text AS rooms_table",
    );
    if (!result.rows[0]?.rooms_table) {
      throw new Error("PostgreSQL migrations have not been applied");
    }
  }

  async createRoom(record: CreateRoomRecord): Promise<void> {
    await this.#transaction(async (client) => {
      await client.query(
        `INSERT INTO rooms
           (id, name, visibility, owner_user_id, invite_code_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          record.room.id,
          record.room.name,
          record.room.visibility,
          record.ownerUserId,
          record.inviteCodeHash,
          record.room.createdAt,
        ],
      );
      await this.#insertMember(client, {
        member: record.owner,
        userId: record.ownerUserId,
        tokenHash: record.ownerTokenHash,
      });
    });
  }

  async findRoom(roomId: string): Promise<Room | undefined> {
    const result = await this.#pool.query<RoomRow>(
      `SELECT id, name, visibility, created_at
       FROM rooms WHERE id = $1 AND dissolved_at IS NULL`,
      [roomId],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : undefined;
  }

  async listPublicRooms(limit: number): Promise<Room[]> {
    const result = await this.#pool.query<RoomRow>(
      `SELECT id, name, visibility, created_at
       FROM rooms
       WHERE visibility = 'public' AND dissolved_at IS NULL
       ORDER BY created_at DESC, id
       LIMIT $1`,
      [limit],
    );
    return result.rows.map(mapRoom);
  }

  async updateRoom(
    roomId: string,
    patch: { name?: string; visibility?: Room["visibility"] },
  ): Promise<Room | undefined> {
    const result = await this.#pool.query<RoomRow>(
      `UPDATE rooms
       SET name = COALESCE($2, name),
           visibility = COALESCE($3, visibility)
       WHERE id = $1 AND dissolved_at IS NULL
       RETURNING id, name, visibility, created_at`,
      [roomId, patch.name ?? null, patch.visibility ?? null],
    );
    return result.rows[0] ? mapRoom(result.rows[0]) : undefined;
  }

  async dissolveRoom(roomId: string, at: string): Promise<boolean> {
    return this.#transaction(async (client) => {
      const room = await client.query(
        `UPDATE rooms SET dissolved_at = $2
         WHERE id = $1 AND dissolved_at IS NULL`,
        [roomId, at],
      );
      if (room.rowCount !== 1) {
        return false;
      }
      await client.query(
        `UPDATE room_members
         SET token_revoked_at = $2, removed_at = $2
         WHERE room_id = $1 AND removed_at IS NULL`,
        [roomId, at],
      );
      await client.query("DELETE FROM agent_claim_codes WHERE room_id = $1", [
        roomId,
      ]);
      await client.query("DELETE FROM agent_user_grants WHERE room_id = $1", [
        roomId,
      ]);
      await client.query(
        "DELETE FROM agent_collaborations WHERE room_id = $1",
        [roomId],
      );
      await client.query("DELETE FROM agent_ownerships WHERE room_id = $1", [
        roomId,
      ]);
      return true;
    });
  }

  async inviteCodeMatches(
    roomId: string,
    inviteCodeHash: string,
  ): Promise<boolean> {
    const result = await this.#pool.query(
      `SELECT 1 FROM rooms
       WHERE id = $1 AND invite_code_hash = $2 AND dissolved_at IS NULL`,
      [roomId, inviteCodeHash],
    );
    return result.rowCount === 1;
  }

  async updateInviteCode(
    roomId: string,
    inviteCodeHash: string,
  ): Promise<void> {
    const result = await this.#pool.query(
      `UPDATE rooms SET invite_code_hash = $1
       WHERE id = $2 AND dissolved_at IS NULL`,
      [inviteCodeHash, roomId],
    );
    if (result.rowCount !== 1) {
      throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
    }
  }

  async addMember(record: AddMemberRecord): Promise<void> {
    try {
      await this.#transaction((client) => this.#insertMember(client, record));
    } catch (error) {
      if (
        record.userId &&
        isUniqueViolation(error, "room_members_room_user_idx")
      ) {
        throw new AppError(
          409,
          "ACCOUNT_ALREADY_MEMBER",
          "This account is already a member of the room",
        );
      }
      throw error;
    }
  }

  async listRoomsForUser(userId: string): Promise<AccountRoomMembership[]> {
    const result = await this.#pool.query<AccountRoomRow>(
      `SELECT
         r.id AS room_id,
         r.name AS room_name,
         r.visibility AS room_visibility,
         r.created_at AS room_created_at,
         m.id AS member_id,
         m.display_name AS member_display_name,
         m.actor_type AS member_actor_type,
         m.agent_provider AS member_agent_provider,
         m.role AS member_role,
         m.joined_at AS member_joined_at
       FROM room_members m
       JOIN rooms r ON r.id = m.room_id
       WHERE m.user_id = $1
         AND m.removed_at IS NULL
         AND r.dissolved_at IS NULL
       ORDER BY r.created_at DESC, r.id`,
      [userId],
    );
    return result.rows.map((row) => ({
      room: {
        id: row.room_id,
        name: row.room_name,
        visibility: row.room_visibility,
        createdAt: row.room_created_at.toISOString(),
      },
      member: {
        id: row.member_id,
        roomId: row.room_id,
        displayName: row.member_display_name,
        actorType: row.member_actor_type,
        agentProvider: row.member_agent_provider,
        role: row.member_role,
        joinedAt: row.member_joined_at.toISOString(),
      },
    }));
  }

  async listMembers(roomId: string): Promise<RoomMember[]> {
    const result = await this.#pool.query<MemberRow>(
      `${memberSelect} WHERE room_id = $1 AND removed_at IS NULL ORDER BY joined_at, id`,
      [roomId],
    );
    return result.rows.map(mapMember);
  }

  async findMember(
    roomId: string,
    memberId: string,
  ): Promise<RoomMember | undefined> {
    const result = await this.#pool.query<MemberRow>(
      `${memberSelect} WHERE room_id = $1 AND id = $2 AND removed_at IS NULL`,
      [roomId, memberId],
    );
    return result.rows[0] ? mapMember(result.rows[0]) : undefined;
  }

  async isActiveMember(roomId: string, memberId: string): Promise<boolean> {
    const result = await this.#pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM room_members m
         JOIN rooms r ON r.id = m.room_id
         WHERE m.room_id = $1 AND m.id = $2 AND m.removed_at IS NULL
           AND r.dissolved_at IS NULL
       ) AS exists`,
      [roomId, memberId],
    );
    return result.rows[0]?.exists ?? false;
  }

  async findMemberByTokenHash(
    roomId: string,
    tokenHash: string,
  ): Promise<RoomMember | undefined> {
    const result = await this.#pool.query<MemberRow>(
      `${memberSelect}
       WHERE room_id = $1 AND token_hash = $2
         AND token_revoked_at IS NULL AND removed_at IS NULL`,
      [roomId, tokenHash],
    );
    return result.rows[0] ? mapMember(result.rows[0]) : undefined;
  }

  async findMemberByUserId(
    roomId: string,
    userId: string,
  ): Promise<RoomMember | undefined> {
    const result = await this.#pool.query<MemberRow>(
      `${memberSelect} WHERE room_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [roomId, userId],
    );
    return result.rows[0] ? mapMember(result.rows[0]) : undefined;
  }

  async findUserIdByMemberId(
    roomId: string,
    memberId: string,
  ): Promise<string | undefined> {
    const result = await this.#pool.query<{ user_id: string | null }>(
      `SELECT user_id FROM room_members
       WHERE room_id = $1 AND id = $2 AND removed_at IS NULL`,
      [roomId, memberId],
    );
    return result.rows[0]?.user_id ?? undefined;
  }

  async issueAgentClaim(record: AgentClaimRecord): Promise<void> {
    await this.#transaction(async (client) => {
      const member = await client.query(
        `SELECT 1 FROM room_members m
         LEFT JOIN agent_ownerships o ON o.agent_member_id = m.id
         WHERE m.room_id = $1 AND m.id = $2 AND m.actor_type = 'agent'
           AND m.removed_at IS NULL AND o.agent_member_id IS NULL
         FOR UPDATE OF m`,
        [record.roomId, record.agentMemberId],
      );
      if (member.rowCount !== 1) {
        const owned = await client.query(
          "SELECT 1 FROM agent_ownerships WHERE room_id = $1 AND agent_member_id = $2",
          [record.roomId, record.agentMemberId],
        );
        if (owned.rowCount === 1) {
          throw new AppError(
            409,
            "AGENT_ALREADY_OWNED",
            "The agent already has an owner",
          );
        }
        throw new AppError(404, "AGENT_NOT_FOUND", "Agent member not found");
      }
      await client.query(
        `UPDATE agent_claim_codes SET consumed_at = $3
         WHERE room_id = $1 AND agent_member_id = $2 AND consumed_at IS NULL`,
        [record.roomId, record.agentMemberId, record.createdAt],
      );
      await insertAgentClaim(client, record);
    });
  }

  async claimAgent(record: ClaimAgentRecord): Promise<AgentOwnership> {
    return this.#transaction(async (client) => {
      const existing = await client.query(
        "SELECT 1 FROM agent_ownerships WHERE room_id = $1 AND agent_member_id = $2",
        [record.roomId, record.agentMemberId],
      );
      if (existing.rowCount === 1) {
        throw new AppError(
          409,
          "AGENT_ALREADY_OWNED",
          "The agent already has an owner",
        );
      }
      const claim = await client.query<{ id: string }>(
        `SELECT c.id
         FROM agent_claim_codes c
         JOIN room_members m ON m.id = c.agent_member_id
         WHERE c.room_id = $1 AND c.agent_member_id = $2
           AND c.code_hash = $3 AND c.consumed_at IS NULL
           AND c.expires_at > $4 AND m.actor_type = 'agent'
           AND m.removed_at IS NULL
         FOR UPDATE OF c`,
        [
          record.roomId,
          record.agentMemberId,
          record.codeHash,
          record.claimedAt,
        ],
      );
      if (!claim.rows[0]) {
        throw new AppError(
          400,
          "INVALID_AGENT_CLAIM",
          "The agent claim code is invalid or expired",
        );
      }
      const result = await client.query<AgentOwnershipRow>(
        `INSERT INTO agent_ownerships
           (room_id, agent_member_id, owner_user_id, claimed_at)
         VALUES ($1, $2, $3, $4)
         RETURNING room_id, agent_member_id, owner_user_id, claimed_at`,
        [
          record.roomId,
          record.agentMemberId,
          record.ownerUserId,
          record.claimedAt,
        ],
      );
      await client.query(
        "UPDATE agent_claim_codes SET consumed_at = $1 WHERE id = $2",
        [record.claimedAt, claim.rows[0].id],
      );
      return mapAgentOwnership(result.rows[0]!);
    });
  }

  async findAgentOwnership(
    roomId: string,
    agentMemberId: string,
  ): Promise<AgentOwnership | undefined> {
    const result = await this.#pool.query<AgentOwnershipRow>(
      `${agentOwnershipSelect} WHERE room_id = $1 AND agent_member_id = $2`,
      [roomId, agentMemberId],
    );
    return result.rows[0] ? mapAgentOwnership(result.rows[0]) : undefined;
  }

  async listAgentOwnerships(roomId: string): Promise<AgentOwnership[]> {
    const result = await this.#pool.query<AgentOwnershipRow>(
      `${agentOwnershipSelect} WHERE room_id = $1 ORDER BY claimed_at, agent_member_id`,
      [roomId],
    );
    return result.rows.map(mapAgentOwnership);
  }

  async hasAgentUserGrant(
    roomId: string,
    agentMemberId: string,
    granteeUserId: string,
  ): Promise<boolean> {
    const result = await this.#pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM agent_user_grants
         WHERE room_id = $1 AND agent_member_id = $2 AND grantee_user_id = $3
       ) AS exists`,
      [roomId, agentMemberId, granteeUserId],
    );
    return result.rows[0]?.exists ?? false;
  }

  async createAgentUserGrant(
    record: StoredAgentUserGrant,
  ): Promise<StoredAgentUserGrant> {
    try {
      const result = await this.#pool.query<AgentUserGrantRow>(
        `INSERT INTO agent_user_grants
           (id, room_id, agent_member_id, grantee_user_id, created_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, room_id, agent_member_id, grantee_user_id, created_at`,
        [
          record.id,
          record.roomId,
          record.agentMemberId,
          record.granteeUserId,
          record.createdAt,
        ],
      );
      return mapAgentUserGrant(result.rows[0]!);
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "23505"
      ) {
        throw new AppError(
          409,
          "AGENT_GRANT_EXISTS",
          "This user can already dispatch the agent",
        );
      }
      throw error;
    }
  }

  async listAgentUserGrants(roomId: string): Promise<StoredAgentUserGrant[]> {
    const result = await this.#pool.query<AgentUserGrantRow>(
      `${agentUserGrantSelect} WHERE room_id = $1 ORDER BY created_at, id`,
      [roomId],
    );
    return result.rows.map(mapAgentUserGrant);
  }

  async deleteAgentUserGrant(
    roomId: string,
    grantId: string,
    agentMemberId: string,
  ): Promise<boolean> {
    const result = await this.#pool.query(
      `DELETE FROM agent_user_grants
       WHERE room_id = $1 AND id = $2 AND agent_member_id = $3`,
      [roomId, grantId, agentMemberId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async createAgentCollaboration(
    collaboration: AgentCollaboration,
  ): Promise<AgentCollaboration> {
    const [agentA, agentB] = [
      collaboration.requesterAgentMemberId,
      collaboration.targetAgentMemberId,
    ].sort();
    try {
      const result = await this.#pool.query<AgentCollaborationRow>(
        `INSERT INTO agent_collaborations
           (id, room_id, requester_agent_member_id, target_agent_member_id,
            pair_agent_a_member_id, pair_agent_b_member_id, status,
            created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, room_id, requester_agent_member_id,
                   target_agent_member_id, status, created_at, updated_at`,
        [
          collaboration.id,
          collaboration.roomId,
          collaboration.requesterAgentMemberId,
          collaboration.targetAgentMemberId,
          agentA,
          agentB,
          collaboration.status,
          collaboration.createdAt,
          collaboration.updatedAt,
        ],
      );
      return mapAgentCollaboration(result.rows[0]!);
    } catch (error) {
      if (isUniqueViolation(error, "agent_collaborations_open_pair_idx")) {
        throw new AppError(
          409,
          "AGENT_COLLABORATION_EXISTS",
          "These agents already have an open collaboration",
        );
      }
      throw error;
    }
  }

  async listAgentCollaborations(roomId: string): Promise<AgentCollaboration[]> {
    const result = await this.#pool.query<AgentCollaborationRow>(
      `${agentCollaborationSelect} WHERE room_id = $1 ORDER BY updated_at DESC, id`,
      [roomId],
    );
    return result.rows.map(mapAgentCollaboration);
  }

  async updateAgentCollaboration(
    roomId: string,
    collaborationId: string,
    allowedFrom: AgentCollaboration["status"][],
    status: AgentCollaboration["status"],
    updatedAt: string,
  ): Promise<AgentCollaboration> {
    const result = await this.#pool.query<AgentCollaborationRow>(
      `UPDATE agent_collaborations SET status = $1, updated_at = $2
       WHERE room_id = $3 AND id = $4 AND status = ANY($5::text[])
       RETURNING id, room_id, requester_agent_member_id,
                 target_agent_member_id, status, created_at, updated_at`,
      [status, updatedAt, roomId, collaborationId, allowedFrom],
    );
    if (result.rows[0]) {
      return mapAgentCollaboration(result.rows[0]);
    }
    const existing = await this.#pool.query<AgentCollaborationRow>(
      `${agentCollaborationSelect} WHERE room_id = $1 AND id = $2`,
      [roomId, collaborationId],
    );
    if (!existing.rows[0]) {
      throw new AppError(
        404,
        "AGENT_COLLABORATION_NOT_FOUND",
        "Agent collaboration not found",
      );
    }
    throw new AppError(
      409,
      "INVALID_COLLABORATION_TRANSITION",
      `Collaboration cannot transition from ${existing.rows[0].status} to ${status}`,
    );
  }

  async hasActiveAgentCollaboration(
    roomId: string,
    firstAgentMemberId: string,
    secondAgentMemberId: string,
  ): Promise<boolean> {
    const [agentA, agentB] = [firstAgentMemberId, secondAgentMemberId].sort();
    const result = await this.#pool.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM agent_collaborations
         WHERE room_id = $1 AND pair_agent_a_member_id = $2
           AND pair_agent_b_member_id = $3 AND status = 'active'
       ) AS exists`,
      [roomId, agentA, agentB],
    );
    return result.rows[0]?.exists ?? false;
  }

  async appendMessage(record: AppendMessageRecord): Promise<RoomMessage> {
    return this.#transaction((client) => this.#appendMessage(client, record));
  }

  async findMessage(
    roomId: string,
    messageId: string,
  ): Promise<RoomMessage | undefined> {
    const result = await this.#pool.query<MessageRow>(
      `${messageSelect} WHERE room_id = $1 AND id = $2`,
      [roomId, messageId],
    );
    return result.rows[0] ? mapMessage(result.rows[0]) : undefined;
  }

  async listMessages(query: ListMessagesQuery): Promise<RoomMessage[]> {
    const result = await this.#pool.query<MessageRow>(
      `${messageSelect}
       WHERE room_id = $1 AND sequence > $2
       ORDER BY sequence
       LIMIT $3`,
      [query.roomId, query.afterSequence, query.limit],
    );
    return result.rows.map(mapMessage);
  }

  async createAgentTask(
    record: CreateAgentTaskRecord,
  ): Promise<CreateAgentTaskResult> {
    return this.#transaction(async (client) => {
      const roomLock = await client.query(
        `SELECT 1 FROM rooms
         WHERE id = $1 AND dissolved_at IS NULL
         FOR UPDATE`,
        [record.message.roomId],
      );
      if (roomLock.rowCount !== 1) {
        throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
      }
      const existingResult = await client.query<MessageRow>(
        `${messageSelect}
         WHERE room_id = $1 AND author_member_id = $2 AND idempotency_key = $3`,
        [
          record.message.roomId,
          record.message.member.id,
          record.message.idempotencyKey,
        ],
      );
      const existingRow = existingResult.rows[0];
      if (existingRow) {
        const existing = mapMessage(existingRow);
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
          deliveries: await this.#listDeliveriesForTask(
            client,
            record.message.roomId,
            existing.id,
          ),
          created: false,
        };
      }

      const message = await this.#appendMessage(client, record.message);
      const deliveries: AgentDelivery[] = [];
      for (const targetMemberId of record.targetMemberIds) {
        const delivery: AgentDelivery = {
          id: createId("del"),
          roomId: message.roomId,
          taskMessageId: message.id,
          targetMemberId,
          status: "queued",
          error: null,
          createdAt: message.createdAt,
          updatedAt: message.createdAt,
        };
        await client.query(
          `INSERT INTO agent_deliveries
             (id, room_id, task_message_id, target_member_id, status, error,
              created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            delivery.id,
            delivery.roomId,
            delivery.taskMessageId,
            delivery.targetMemberId,
            delivery.status,
            delivery.error,
            delivery.createdAt,
            delivery.updatedAt,
          ],
        );
        deliveries.push(delivery);
      }
      return { message, deliveries, created: true };
    });
  }

  async findDelivery(
    roomId: string,
    deliveryId: string,
  ): Promise<AgentDelivery | undefined> {
    const result = await this.#pool.query<DeliveryRow>(
      `${deliverySelect} WHERE room_id = $1 AND id = $2`,
      [roomId, deliveryId],
    );
    return result.rows[0] ? mapDelivery(result.rows[0]) : undefined;
  }

  async listPendingDeliveries(
    roomId: string,
    targetMemberId: string,
  ): Promise<PendingAgentDelivery[]> {
    const result = await this.#pool.query<PendingRow>(
      `${pendingSelect}
       WHERE d.room_id = $1
         AND d.target_member_id = $2
         AND d.status IN ('queued', 'received', 'running')
       ORDER BY m.sequence`,
      [roomId, targetMemberId],
    );
    return result.rows.map(mapPending);
  }

  async listDeliveriesForTask(
    roomId: string,
    taskMessageId: string,
  ): Promise<AgentDelivery[]> {
    return this.#listDeliveriesForTask(
      this.#pool,
      roomId,
      taskMessageId,
    );
  }

  async updateDelivery(record: UpdateDeliveryRecord): Promise<AgentDelivery> {
    return this.#transaction(async (client) => {
      const current = await this.#lockDelivery(
        client,
        record.roomId,
        record.deliveryId,
        record.targetMemberId,
      );
      if (!record.allowedFrom.includes(current.status)) {
        throw invalidTransition(current.status, record.status);
      }
      const result = await client.query<DeliveryRow>(
        `UPDATE agent_deliveries
         SET status = $1, error = $2, updated_at = $3
         WHERE id = $4
         RETURNING id, room_id, task_message_id, target_member_id, status,
                   error, created_at, updated_at`,
        [record.status, record.error, record.updatedAt, record.deliveryId],
      );
      return mapDelivery(result.rows[0]!);
    });
  }

  async replyToDelivery(
    record: ReplyToDeliveryRecord,
  ): Promise<{ delivery: AgentDelivery; message: RoomMessage }> {
    return this.#transaction(async (client) => {
      const current = await this.#lockDelivery(
        client,
        record.roomId,
        record.deliveryId,
        record.targetMemberId,
      );
      if (!["queued", "received", "running"].includes(current.status)) {
        throw invalidTransition(current.status, "replied");
      }
      const message = await this.#appendMessage(client, {
        ...record.message,
        inReplyToMessageId: current.taskMessageId,
      });
      const result = await client.query<DeliveryRow>(
        `UPDATE agent_deliveries
         SET status = 'replied', error = NULL, updated_at = $1
         WHERE id = $2
         RETURNING id, room_id, task_message_id, target_member_id, status,
                   error, created_at, updated_at`,
        [record.updatedAt, record.deliveryId],
      );
      return { delivery: mapDelivery(result.rows[0]!), message };
    });
  }

  async removeMember(
    roomId: string,
    memberId: string,
    at: string,
  ): Promise<boolean> {
    return this.#transaction(async (client) => {
      const result = await client.query<{
        actor_type: RoomMember["actorType"];
        user_id: string | null;
      }>(
        `UPDATE room_members
         SET token_revoked_at = $1, removed_at = $1
         WHERE room_id = $2 AND id = $3 AND role <> 'owner' AND removed_at IS NULL
         RETURNING actor_type, user_id`,
        [at, roomId, memberId],
      );
      const removed = result.rows[0];
      if (!removed) {
        return false;
      }
      if (removed.user_id) {
        await client.query(
          `DELETE FROM agent_user_grants
           WHERE room_id = $1 AND grantee_user_id = $2`,
          [roomId, removed.user_id],
        );
      }
      if (removed.actor_type === "agent") {
        await client.query(
          `DELETE FROM agent_claim_codes
           WHERE room_id = $1 AND agent_member_id = $2`,
          [roomId, memberId],
        );
        await client.query(
          `DELETE FROM agent_user_grants
           WHERE room_id = $1 AND agent_member_id = $2`,
          [roomId, memberId],
        );
        await client.query(
          `DELETE FROM agent_collaborations
           WHERE room_id = $1
             AND (requester_agent_member_id = $2 OR target_agent_member_id = $2)`,
          [roomId, memberId],
        );
        await client.query(
          `DELETE FROM agent_ownerships
           WHERE room_id = $1 AND agent_member_id = $2`,
          [roomId, memberId],
        );
      }
      return true;
    });
  }

  async listModerationRules(roomId: string): Promise<ModerationRule[]> {
    const result = await this.#pool.query<ModerationRuleRow>(
      `SELECT id, room_id, pattern, action, created_at
       FROM moderation_rules
       WHERE room_id = $1
       ORDER BY created_at, id`,
      [roomId],
    );
    return result.rows.map(mapModerationRule);
  }

  async createModerationRule(
    rule: ModerationRule,
    createdByMemberId: string,
  ): Promise<ModerationRule> {
    await this.#pool.query(
      `INSERT INTO moderation_rules
         (id, room_id, pattern, action, created_by_member_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [rule.id, rule.roomId, rule.pattern, rule.action, createdByMemberId, rule.createdAt],
    );
    return rule;
  }

  async deleteModerationRule(
    roomId: string,
    ruleId: string,
  ): Promise<boolean> {
    const result = await this.#pool.query(
      "DELETE FROM moderation_rules WHERE id = $1 AND room_id = $2",
      [ruleId, roomId],
    );
    return (result.rowCount ?? 0) === 1;
  }

  async enqueueOutbox(roomId: string, payload: unknown): Promise<void> {
    await this.#pool.query(
      `INSERT INTO outbox (room_id, payload, created_at)
       VALUES ($1, $2::jsonb, now())`,
      [roomId, JSON.stringify(payload)],
    );
  }

  async listPendingOutbox(limit: number): Promise<OutboxEntry[]> {
    // Atomically claims and marks a batch of un-published events. FOR UPDATE
    // SKIP LOCKED lets multiple API instances drain without double-delivery:
    // rows locked by another instance are skipped this round.
    const result = await this.#pool.query<{
      id: string;
      room_id: string;
      payload: unknown;
    }>(
      `WITH batch AS (
         SELECT id, room_id, payload
         FROM outbox
         WHERE published_at IS NULL
         ORDER BY id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       ), marked AS (
         UPDATE outbox
         SET published_at = now()
         WHERE id IN (SELECT id FROM batch)
         RETURNING id
       )
       SELECT id, room_id, payload FROM batch`,
      [limit],
    );
    return result.rows.map((row) => ({
      id: Number(row.id),
      roomId: row.room_id,
      payload: row.payload,
    }));
  }

  async markOutboxPublished(ids: number[], publishedAt: string): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.#pool.query(
      `UPDATE outbox
       SET published_at = $1
       WHERE id = ANY($2::bigint[]) AND published_at IS NULL`,
      [publishedAt, ids],
    );
  }

  async releaseOutbox(ids: number[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.#pool.query(
      `UPDATE outbox
       SET published_at = NULL
       WHERE id = ANY($1::bigint[])`,
      [ids],
    );
  }

  async purgeOutbox(olderThan: string): Promise<number> {
    const result = await this.#pool.query(
      `DELETE FROM outbox
       WHERE published_at IS NOT NULL AND published_at < $1`,
      [olderThan],
    );
    return result.rowCount ?? 0;
  }

  async #insertMember(
    client: Pick<Pool, "query"> | Pick<PoolClient, "query">,
    record: AddMemberRecord,
  ): Promise<void> {
    const room = await client.query(
      `SELECT 1 FROM rooms
       WHERE id = $1 AND dissolved_at IS NULL
       FOR UPDATE`,
      [record.member.roomId],
    );
    if (room.rowCount !== 1) {
      throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
    }
    await client.query(
      `INSERT INTO room_members
         (id, room_id, display_name, actor_type, agent_provider, role,
          user_id, token_hash, joined_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        record.member.id,
        record.member.roomId,
        record.member.displayName,
        record.member.actorType,
        record.member.agentProvider,
        record.member.role,
        record.userId,
        record.tokenHash,
        record.member.joinedAt,
      ],
    );
    if (record.agentClaim) {
      await insertAgentClaim(client, record.agentClaim);
    }
  }

  async #appendMessage(
    client: PoolClient,
    record: AppendMessageRecord,
  ): Promise<RoomMessage> {
    const sequenceResult = await client.query<{ sequence: string | number }>(
      `UPDATE rooms
       SET next_sequence = next_sequence + 1
       WHERE id = $1 AND dissolved_at IS NULL
       RETURNING next_sequence - 1 AS sequence`,
      [record.roomId],
    );
    const sequenceRow = sequenceResult.rows[0];
    if (!sequenceRow) {
      throw new AppError(404, "ROOM_NOT_FOUND", "Room not found");
    }
    const sequence = safeNumber(sequenceRow.sequence, "message sequence");
    await client.query(
      `INSERT INTO room_messages
         (id, room_id, sequence, kind, text, attachment_ids,
          target_member_ids, in_reply_to_message_id, idempotency_key,
          author_member_id, author_display_name, author_actor_type,
          author_agent_provider, created_at, moderation_state,
          moderation_reason)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        record.id,
        record.roomId,
        sequence,
        record.kind,
        record.text,
        record.attachmentIds,
        record.targetMemberIds,
        record.inReplyToMessageId,
        record.idempotencyKey,
        record.member.id,
        record.member.displayName,
        record.member.actorType,
        record.member.agentProvider,
        record.createdAt,
        record.moderation?.state ?? null,
        record.moderation?.reason ?? null,
      ],
    );
    return {
      id: record.id,
      roomId: record.roomId,
      sequence,
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
  }

  async #lockDelivery(
    client: PoolClient,
    roomId: string,
    deliveryId: string,
    targetMemberId: string,
  ): Promise<AgentDelivery> {
    const result = await client.query<DeliveryRow>(
      `${deliverySelect}
       WHERE room_id = $1 AND id = $2 AND target_member_id = $3
       FOR UPDATE`,
      [roomId, deliveryId, targetMemberId],
    );
    if (!result.rows[0]) {
      throw new AppError(404, "DELIVERY_NOT_FOUND", "Delivery not found");
    }
    return mapDelivery(result.rows[0]);
  }

  async #listDeliveriesForTask(
    client: Pick<Pool, "query"> | Pick<PoolClient, "query">,
    roomId: string,
    taskMessageId: string,
  ): Promise<AgentDelivery[]> {
    const result = await client.query<DeliveryRow>(
      `${deliverySelect}
       WHERE room_id = $1 AND task_message_id = $2
       ORDER BY created_at, id`,
      [roomId, taskMessageId],
    );
    return result.rows.map(mapDelivery);
  }

  async #transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

const memberSelect = `
  SELECT id, room_id, display_name, actor_type, agent_provider, role, joined_at
  FROM room_members`;

const messageSelect = `
  SELECT id, room_id, sequence, kind, text, attachment_ids,
         target_member_ids, in_reply_to_message_id, idempotency_key,
         author_member_id, author_display_name, author_actor_type,
         author_agent_provider, created_at, moderation_state,
         moderation_reason
  FROM room_messages`;

const deliverySelect = `
  SELECT id, room_id, task_message_id, target_member_id, status, error,
         created_at, updated_at
  FROM agent_deliveries`;

const agentOwnershipSelect = `
  SELECT room_id, agent_member_id, owner_user_id, claimed_at
  FROM agent_ownerships`;

const agentUserGrantSelect = `
  SELECT id, room_id, agent_member_id, grantee_user_id, created_at
  FROM agent_user_grants`;

const agentCollaborationSelect = `
  SELECT id, room_id, requester_agent_member_id, target_agent_member_id,
         status, created_at, updated_at
  FROM agent_collaborations`;

const pendingSelect = `
  SELECT
    d.id AS delivery_id,
    d.room_id AS delivery_room_id,
    d.task_message_id AS delivery_task_message_id,
    d.target_member_id AS delivery_target_member_id,
    d.status AS delivery_status,
    d.error AS delivery_error,
    d.created_at AS delivery_created_at,
    d.updated_at AS delivery_updated_at,
    m.id AS message_id,
    m.room_id AS message_room_id,
    m.sequence AS message_sequence,
    m.kind AS message_kind,
    m.text AS message_text,
    m.attachment_ids AS message_attachment_ids,
    m.target_member_ids AS message_target_member_ids,
    m.in_reply_to_message_id AS message_in_reply_to_message_id,
    m.idempotency_key AS message_idempotency_key,
    m.author_member_id AS message_author_member_id,
    m.author_display_name AS message_author_display_name,
    m.author_actor_type AS message_author_actor_type,
    m.author_agent_provider AS message_author_agent_provider,
    m.created_at AS message_created_at,
    m.moderation_state AS message_moderation_state,
    m.moderation_reason AS message_moderation_reason
  FROM agent_deliveries d
  JOIN room_messages m ON m.id = d.task_message_id`;

function mapRoom(row: RoomRow): Room {
  return {
    id: row.id,
    name: row.name,
    visibility: row.visibility,
    createdAt: iso(row.created_at),
  };
}

function mapMember(row: MemberRow): RoomMember {
  return {
    id: row.id,
    roomId: row.room_id,
    displayName: row.display_name,
    actorType: row.actor_type,
    agentProvider: row.agent_provider,
    role: row.role,
    joinedAt: iso(row.joined_at),
  };
}

function mapMessage(row: MessageRow): RoomMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    sequence: safeNumber(row.sequence, "message sequence"),
    kind: row.kind,
    text: row.text,
    attachmentIds: row.attachment_ids,
    targetMemberIds: row.target_member_ids,
    inReplyToMessageId: row.in_reply_to_message_id,
    idempotencyKey: row.idempotency_key,
    author: {
      memberId: row.author_member_id,
      displayName: row.author_display_name,
      actorType: row.author_actor_type,
      agentProvider: row.author_agent_provider,
    },
    createdAt: iso(row.created_at),
    ...(row.moderation_state
      ? {
          moderation: {
            state: row.moderation_state as "clean" | "flagged",
            ...(row.moderation_reason ? { reason: row.moderation_reason } : {}),
          },
        }
      : {}),
  };
}

function mapDelivery(row: DeliveryRow): AgentDelivery {
  return {
    id: row.id,
    roomId: row.room_id,
    taskMessageId: row.task_message_id,
    targetMemberId: row.target_member_id,
    status: row.status,
    error: row.error,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapModerationRule(row: ModerationRuleRow): ModerationRule {
  return {
    id: row.id,
    roomId: row.room_id,
    pattern: row.pattern,
    action: row.action as ModerationAction,
    createdAt: iso(row.created_at),
  };
}

function mapAgentOwnership(row: AgentOwnershipRow): AgentOwnership {
  return {
    roomId: row.room_id,
    agentMemberId: row.agent_member_id,
    ownerUserId: row.owner_user_id,
    claimedAt: iso(row.claimed_at),
  };
}

function mapAgentUserGrant(row: AgentUserGrantRow): StoredAgentUserGrant {
  return {
    id: row.id,
    roomId: row.room_id,
    agentMemberId: row.agent_member_id,
    granteeUserId: row.grantee_user_id,
    createdAt: iso(row.created_at),
  };
}

function mapAgentCollaboration(
  row: AgentCollaborationRow,
): AgentCollaboration {
  return {
    id: row.id,
    roomId: row.room_id,
    requesterAgentMemberId: row.requester_agent_member_id,
    targetAgentMemberId: row.target_agent_member_id,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function mapPending(row: PendingRow): PendingAgentDelivery {
  return {
    delivery: mapDelivery({
      id: row.delivery_id,
      room_id: row.delivery_room_id,
      task_message_id: row.delivery_task_message_id,
      target_member_id: row.delivery_target_member_id,
      status: row.delivery_status,
      error: row.delivery_error,
      created_at: row.delivery_created_at,
      updated_at: row.delivery_updated_at,
    }),
    task: mapMessage({
      id: row.message_id,
      room_id: row.message_room_id,
      sequence: row.message_sequence,
      kind: row.message_kind,
      text: row.message_text,
      attachment_ids: row.message_attachment_ids,
      target_member_ids: row.message_target_member_ids,
      in_reply_to_message_id: row.message_in_reply_to_message_id,
      idempotency_key: row.message_idempotency_key,
      author_member_id: row.message_author_member_id,
      author_display_name: row.message_author_display_name,
      author_actor_type: row.message_author_actor_type,
      author_agent_provider: row.message_author_agent_provider,
      created_at: row.message_created_at,
      moderation_state: row.message_moderation_state,
      moderation_reason: row.message_moderation_reason,
    }),
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safeNumber(value: string | number, label: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new Error(`${label} exceeded the JavaScript safe integer range`);
  }
  return result;
}

function sameStrings(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === constraint
  );
}

async function insertAgentClaim(
  client: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  record: AgentClaimRecord,
): Promise<void> {
  await client.query(
    `INSERT INTO agent_claim_codes
       (id, room_id, agent_member_id, code_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      record.id,
      record.roomId,
      record.agentMemberId,
      record.codeHash,
      record.expiresAt,
      record.createdAt,
    ],
  );
}

function invalidTransition(
  current: DeliveryStatus,
  next: DeliveryStatus,
): AppError {
  return new AppError(
    409,
    "INVALID_DELIVERY_TRANSITION",
    `Delivery cannot transition from ${current} to ${next}`,
  );
}
