import type { Attachment, AttachmentStorageRecord } from "./types.js";

export interface FileRepository {
  close?(): Promise<void>;
  healthCheck?(): Promise<void>;
  createAttachment(
    record: AttachmentStorageRecord,
  ): Promise<AttachmentStorageRecord>;
  /**
   * Atomically creates an attachment only when the room quota allows it.
   * Returns undefined when the quota would be exceeded. Fallback for
   * repositories without atomic quotas; prefer over createAttachment.
   */
  createAttachmentWithinQuota?(
    record: AttachmentStorageRecord,
    quotaBytes: number,
  ): Promise<AttachmentStorageRecord | undefined>;
  findAttachment(
    roomId: string,
    attachmentId: string,
  ): Promise<AttachmentStorageRecord | undefined>;
  listAttachments(roomId: string): Promise<Attachment[]>;
  /** Total bytes of attachments currently consuming the room quota. */
  sumRoomBytes(roomId: string): Promise<number>;
  updateScanState(
    roomId: string,
    attachmentId: string,
    scanState: Attachment["scanState"],
  ): Promise<AttachmentStorageRecord | undefined>;
  deleteAttachment(roomId: string, attachmentId: string): Promise<boolean>;
}
