import { Pool, type QueryResultRow } from "pg";
import type {
  Attachment,
  AttachmentStorageRecord,
} from "./types.js";
import type { FileRepository } from "./repository.js";

interface AttachmentRow extends QueryResultRow {
  id: string;
  room_id: string;
  uploader_member_id: string;
  name: string;
  media_type: string;
  size: string;
  sha256: string;
  storage_key: string;
  scan_state: string;
  created_at: Date;
}

export class PostgresFileRepository implements FileRepository {
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
      console.error("Unexpected idle PostgreSQL files client error:", error);
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async healthCheck(): Promise<void> {
    const result = await this.#pool.query<{ table: string | null }>(
      "SELECT to_regclass('public.attachments')::text AS table",
    );
    if (!result.rows[0]?.table) {
      throw new Error("PostgreSQL file migrations have not been applied");
    }
  }

  async createAttachment(
    record: AttachmentStorageRecord,
  ): Promise<AttachmentStorageRecord> {
    await this.#pool.query(
      `INSERT INTO attachments
         (id, room_id, uploader_member_id, name, media_type, size, sha256,
          storage_key, scan_state, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        record.id,
        record.roomId,
        record.uploaderMemberId,
        record.name,
        record.mediaType,
        record.size,
        record.sha256,
        record.storageKey,
        record.scanState,
        record.createdAt,
      ],
    );
    return record;
  }

  async createAttachmentWithinQuota(
    record: AttachmentStorageRecord,
    quotaBytes: number,
  ): Promise<AttachmentStorageRecord | undefined> {
    const result = await this.#pool.query<{ id: string }>(
      `INSERT INTO attachments
       (id, room_id, uploader_member_id, name, media_type, size, sha256,
          storage_key, scan_state, created_at)
       SELECT $1, $2, $3, $4, $5, $6::bigint, $7, $8, $9, $10
       WHERE (SELECT COALESCE(SUM(size), 0) FROM attachments WHERE room_id = $2)
             + $6::bigint <= $11::numeric
       RETURNING id`,
      [
        record.id,
        record.roomId,
        record.uploaderMemberId,
        record.name,
        record.mediaType,
        record.size,
        record.sha256,
        record.storageKey,
        record.scanState,
        record.createdAt,
        quotaBytes,
      ],
    );
    return result.rowCount === 1 ? record : undefined;
  }

  async findAttachment(
    roomId: string,
    attachmentId: string,
  ): Promise<AttachmentStorageRecord | undefined> {
    const result = await this.#pool.query<AttachmentRow>(
      `SELECT id, room_id, uploader_member_id, name, media_type, size, sha256,
              storage_key, scan_state, created_at
       FROM attachments
       WHERE id = $1 AND room_id = $2`,
      [attachmentId, roomId],
    );
    return result.rows[0] ? mapAttachment(result.rows[0]) : undefined;
  }

  async listAttachments(roomId: string): Promise<Attachment[]> {
    const result = await this.#pool.query<AttachmentRow>(
      `SELECT id, room_id, uploader_member_id, name, media_type, size, sha256,
              storage_key, scan_state, created_at
       FROM attachments
       WHERE room_id = $1
       ORDER BY created_at DESC`,
      [roomId],
    );
    return result.rows.map((row) => {
      const { storageKey: _storageKey, ...attachment } = mapAttachment(row);
      return attachment;
    });
  }

  async sumRoomBytes(roomId: string): Promise<number> {
    const result = await this.#pool.query<{ total: string | null }>(
      "SELECT COALESCE(SUM(size), 0)::text AS total FROM attachments WHERE room_id = $1",
      [roomId],
    );
    return Number(result.rows[0]?.total ?? 0);
  }

  async updateScanState(
    roomId: string,
    attachmentId: string,
    scanState: Attachment["scanState"],
  ): Promise<AttachmentStorageRecord | undefined> {
    const result = await this.#pool.query<AttachmentRow>(
      `UPDATE attachments
       SET scan_state = $1
       WHERE id = $2 AND room_id = $3
       RETURNING id, room_id, uploader_member_id, name, media_type, size,
                 sha256, storage_key, scan_state, created_at`,
      [scanState, attachmentId, roomId],
    );
    return result.rows[0] ? mapAttachment(result.rows[0]) : undefined;
  }

  async deleteAttachment(roomId: string, attachmentId: string): Promise<boolean> {
    const result = await this.#pool.query(
      "DELETE FROM attachments WHERE id = $1 AND room_id = $2",
      [attachmentId, roomId],
    );
    return (result.rowCount ?? 0) === 1;
  }
}

function mapAttachment(row: AttachmentRow): AttachmentStorageRecord {
  return {
    id: row.id,
    roomId: row.room_id,
    uploaderMemberId: row.uploader_member_id,
    name: row.name,
    mediaType: row.media_type,
    size: Number(row.size),
    sha256: row.sha256,
    storageKey: row.storage_key,
    scanState: row.scan_state as Attachment["scanState"],
    createdAt: row.created_at.toISOString(),
  };
}
