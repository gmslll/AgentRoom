import type {
  Attachment,
  AttachmentStorageRecord,
} from "./types.js";
import type { FileRepository } from "./repository.js";

export class InMemoryFileRepository implements FileRepository {
  readonly #attachments = new Map<string, AttachmentStorageRecord>();

  async createAttachment(
    record: AttachmentStorageRecord,
  ): Promise<AttachmentStorageRecord> {
    this.#attachments.set(record.id, record);
    return record;
  }

  async createAttachmentWithinQuota(
    record: AttachmentStorageRecord,
    quotaBytes: number,
  ): Promise<AttachmentStorageRecord | undefined> {
    if ((await this.sumRoomBytes(record.roomId)) + record.size > quotaBytes) {
      return undefined;
    }
    return this.createAttachment(record);
  }

  async findAttachment(
    roomId: string,
    attachmentId: string,
  ): Promise<AttachmentStorageRecord | undefined> {
    const record = this.#attachments.get(attachmentId);
    return record && record.roomId === roomId ? record : undefined;
  }

  async listAttachments(roomId: string): Promise<Attachment[]> {
    return [...this.#attachments.values()]
      .filter((record) => record.roomId === roomId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(({ storageKey: _storageKey, ...attachment }) => attachment);
  }

  async sumRoomBytes(roomId: string): Promise<number> {
    return [...this.#attachments.values()]
      .filter((record) => record.roomId === roomId)
      .reduce((total, record) => total + record.size, 0);
  }

  async updateScanState(
    roomId: string,
    attachmentId: string,
    scanState: Attachment["scanState"],
  ): Promise<AttachmentStorageRecord | undefined> {
    const record = await this.findAttachment(roomId, attachmentId);
    if (!record) {
      return undefined;
    }
    record.scanState = scanState;
    return record;
  }

  async deleteAttachment(roomId: string, attachmentId: string): Promise<boolean> {
    const record = await this.findAttachment(roomId, attachmentId);
    if (!record) {
      return false;
    }
    this.#attachments.delete(record.id);
    return true;
  }
}
