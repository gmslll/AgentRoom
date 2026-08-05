import { AppError } from "../../lib/errors.js";
import { ObjectNotFoundError, type ObjectStorage } from "../../lib/object-storage.js";
import { createId } from "../../lib/secrets.js";
import type { RoomMember } from "../rooms/types.js";
import type { FileRepository } from "./repository.js";
import type {
  Attachment,
  AttachmentScanState,
  AttachmentStorageRecord,
} from "./types.js";

export interface CreateUploadIntentInput {
  roomId: string;
  accessToken: string;
  name: string;
  mediaType: string;
  size: number;
  sha256?: string | undefined;
}

export interface FileServiceOptions {
  repository: FileRepository;
  storage: ObjectStorage;
  authenticateMember: (
    roomId: string,
    accessToken: string,
  ) => Promise<RoomMember>;
  maxSizeBytes: number;
  roomQuotaBytes: number;
  scanResult: AttachmentScanState;
  uploadUrlTtlSeconds: number;
  downloadUrlTtlSeconds?: number;
  now?: () => Date;
}

export class FileService {
  readonly #repository: FileRepository;
  readonly #storage: ObjectStorage;
  readonly #authenticateMember: (
    roomId: string,
    accessToken: string,
  ) => Promise<RoomMember>;
  readonly #maxSizeBytes: number;
  readonly #roomQuotaBytes: number;
  readonly #scanResult: AttachmentScanState;
  readonly #uploadUrlTtlSeconds: number;
  readonly #downloadUrlTtlSeconds: number;
  readonly #now: () => Date;

  constructor(options: FileServiceOptions) {
    this.#repository = options.repository;
    this.#storage = options.storage;
    this.#authenticateMember = options.authenticateMember;
    this.#maxSizeBytes = options.maxSizeBytes;
    this.#roomQuotaBytes = options.roomQuotaBytes;
    this.#scanResult = options.scanResult;
    this.#uploadUrlTtlSeconds = options.uploadUrlTtlSeconds;
    this.#downloadUrlTtlSeconds = options.downloadUrlTtlSeconds ?? 300;
    this.#now = options.now ?? (() => new Date());
  }

  async createUploadIntent(
    input: CreateUploadIntentInput,
  ): Promise<{ fileId: string; presignedUrl: string; expiresAt: string }> {
    const member = await this.#authenticateMember(
      input.roomId,
      input.accessToken,
    );

    if (input.size > this.#maxSizeBytes) {
      throw new AppError(
        413,
        "FILE_TOO_LARGE",
        `Files are limited to ${this.#maxSizeBytes} bytes`,
      );
    }

    const fileId = createId("att");
    const createdAt = this.#now().toISOString();
    const storageKey = storageKeyFor(input.roomId, fileId);

    await this.#storage.ensureBucket();
    const record: AttachmentStorageRecord = {
      id: fileId,
      roomId: input.roomId,
      uploaderMemberId: member.id,
      name: input.name,
      mediaType: input.mediaType,
      size: input.size,
      sha256: input.sha256 ?? "",
      storageKey,
      scanState: "pending",
      createdAt,
    };
    // Atomic check-and-insert where the repository supports it; otherwise the
    // quota is enforced against the pre-insert sum.
    const created = this.#repository.createAttachmentWithinQuota
      ? await this.#repository.createAttachmentWithinQuota(
          record,
          this.#roomQuotaBytes,
        )
      : (await this.#repository.sumRoomBytes(input.roomId)) + input.size <=
          this.#roomQuotaBytes
        ? await this.#repository.createAttachment(record)
        : undefined;
    if (!created) {
      throw new AppError(
        413,
        "ROOM_FILE_QUOTA_EXCEEDED",
        "The room file quota would be exceeded by this upload",
      );
    }

    const presignedUrl = await this.#storage.createPresignedUploadUrl(
      storageKey,
      {
        contentType: input.mediaType,
        size: input.size,
        sha256: input.sha256,
        ttlSeconds: this.#uploadUrlTtlSeconds,
      },
    );
    const expiresAt = new Date(
      this.#now().getTime() + this.#uploadUrlTtlSeconds * 1_000,
    ).toISOString();
    return { fileId, presignedUrl, expiresAt };
  }

  async completeUpload(input: {
    roomId: string;
    fileId: string;
    accessToken: string;
  }): Promise<{ attachment: Attachment; downloadUrl: string }> {
    const member = await this.#authenticateMember(input.roomId, input.accessToken);
    const record = await this.#repository.findAttachment(
      input.roomId,
      input.fileId,
    );
    if (!record) {
      throw new AppError(
        404,
        "ATTACHMENT_NOT_FOUND",
        "The attachment or upload intent does not exist",
      );
    }
    if (record.uploaderMemberId !== member.id) {
      throw new AppError(
        403,
        "UPLOADER_REQUIRED",
        "Only the uploader can complete this upload",
      );
    }

    let head;
    try {
      head = await this.#storage.headObject(record.storageKey);
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        throw new AppError(
          400,
          "FILE_NOT_UPLOADED",
          "The file has not been uploaded yet",
        );
      }
      throw error;
    }
    if (head.size !== record.size) {
      throw new AppError(
        409,
        "FILE_SIZE_MISMATCH",
        "The uploaded object size does not match the intent",
      );
    }
    // The presigned PUT signs x-amz-checksum-sha256 when the intent declares
    // one, so the object storage itself verifies content on upload. Head may
    // or may not echo the checksum back (MinIO does not); when it does, the
    // server re-verifies it.
    if (record.sha256 && head.sha256 && head.sha256 !== record.sha256) {
      throw new AppError(
        409,
        "FILE_CHECKSUM_MISMATCH",
        "The uploaded object checksum does not match the intent",
      );
    }

    const updated = await this.#repository.updateScanState(
      input.roomId,
      input.fileId,
      this.#scanResult,
    );
    const attachment = updated
      ? publicAttachment(updated)
      : publicAttachment(record);
    const downloadUrl = await this.#storage.createPresignedDownloadUrl(
      record.storageKey,
      this.#downloadUrlTtlSeconds,
    );
    return { attachment, downloadUrl };
  }

  async getAttachment(input: {
    roomId: string;
    attachmentId: string;
    accessToken: string;
  }): Promise<{ attachment: Attachment; downloadUrl: string }> {
    await this.#authenticateMember(input.roomId, input.accessToken);
    const record = await this.#repository.findAttachment(
      input.roomId,
      input.attachmentId,
    );
    if (!record) {
      throw new AppError(
        404,
        "ATTACHMENT_NOT_FOUND",
        "The attachment does not exist",
      );
    }
    if (record.scanState === "pending") {
      throw new AppError(
        409,
        "ATTACHMENT_NOT_READY",
        "The attachment upload has not been completed yet",
      );
    }
    if (record.scanState === "flagged") {
      throw new AppError(
        403,
        "ATTACHMENT_FLAGGED",
        "This attachment was flagged by the file scanner",
      );
    }
    const downloadUrl = await this.#storage.createPresignedDownloadUrl(
      record.storageKey,
      this.#downloadUrlTtlSeconds,
    );
    return { attachment: publicAttachment(record), downloadUrl };
  }

  async listAttachments(input: {
    roomId: string;
    accessToken: string;
  }): Promise<Attachment[]> {
    await this.#authenticateMember(input.roomId, input.accessToken);
    return this.#repository.listAttachments(input.roomId);
  }

  /**
   * Returns true when every id refers to a completed, non-flagged attachment
   * in the room. Used by the message pipeline to accept attachmentIds on
   * text messages.
   */
  async validateAttachments(
    roomId: string,
    attachmentIds: string[],
  ): Promise<boolean> {
    for (const attachmentId of attachmentIds) {
      const record = await this.#repository.findAttachment(roomId, attachmentId);
      if (!record || record.scanState === "pending") {
        return false;
      }
      if (record.scanState === "flagged") {
        return false;
      }
    }
    return true;
  }
}

function storageKeyFor(roomId: string, fileId: string): string {
  return `rooms/${roomId}/files/${fileId}`;
}

function publicAttachment(record: {
  id: string;
  roomId: string;
  uploaderMemberId: string;
  name: string;
  mediaType: string;
  size: number;
  sha256: string;
  scanState: AttachmentScanState;
  createdAt: string;
}): Attachment {
  return {
    id: record.id,
    roomId: record.roomId,
    uploaderMemberId: record.uploaderMemberId,
    name: record.name,
    mediaType: record.mediaType,
    size: record.size,
    sha256: record.sha256,
    scanState: record.scanState,
    createdAt: record.createdAt,
  };
}
