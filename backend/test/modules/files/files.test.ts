import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { AppError } from "../../../src/lib/errors.js";
import { MemoryObjectStorage } from "../../../src/lib/object-storage.js";
import { InMemoryFileRepository } from "../../../src/modules/files/memory-repository.js";
import { FileService } from "../../../src/modules/files/service.js";
import type { RoomMember } from "../../../src/modules/rooms/types.js";

function member(overrides: Partial<RoomMember> = {}): RoomMember {
  return {
    id: "mem_0000000000000000",
    roomId: "room_0000000000000000",
    displayName: "Owner",
    actorType: "human",
    agentProvider: null,
    role: "owner",
    joinedAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}

function makeService(overrides: Partial<ConstructorParameters<typeof FileService>[0]> = {}) {
  const repository = new InMemoryFileRepository();
  const storage = new MemoryObjectStorage();
  const owner = member();
  const service = new FileService({
    repository,
    storage,
    authenticateMember: async (roomId, _token) => {
      void roomId;
      return owner;
    },
    maxSizeBytes: 1_000,
    roomQuotaBytes: 5_000,
    scanResult: "clean",
    uploadUrlTtlSeconds: 300,
    ...overrides,
  });
  return { repository, storage, service, owner };
}

describe("FileService", () => {
  it("creates an upload intent and completes it when the object matches", async () => {
    const { repository, storage, service } = makeService();
    const bytes = Buffer.from("hello world\n", "utf8");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const intent = await service.createUploadIntent({
      roomId: "room_0000000000000000",
      accessToken: "art_test",
      name: "report.txt",
      mediaType: "text/plain",
      size: bytes.length,
      sha256,
    });
    expect(intent.fileId).toMatch(/^att_/);
    expect(intent.presignedUrl).toBeTruthy();
    expect(new Date(intent.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const record = await repository.findAttachment(
      "room_0000000000000000",
      intent.fileId,
    );
    expect(record?.scanState).toBe("pending");

    storage.stageObject(record!.storageKey, bytes);
    const completed = await service.completeUpload({
      roomId: "room_0000000000000000",
      fileId: intent.fileId,
      accessToken: "art_test",
    });
    expect(completed.attachment.scanState).toBe("clean");
    expect(completed.attachment.sha256).toBe(sha256);
    expect(completed.attachment.mediaType).toBe("text/plain");

    const listed = await service.listAttachments({
      roomId: "room_0000000000000000",
      accessToken: "art_test",
    });
    expect(listed).toHaveLength(1);
  });

  it("rejects sizes above the limit", async () => {
    const { service } = makeService();
    await expect(
      service.createUploadIntent({
        roomId: "room_0000000000000000",
        accessToken: "art_test",
        name: "big.bin",
        mediaType: "application/octet-stream",
        size: 2_000,
      }),
    ).rejects.toMatchObject({ statusCode: 413, code: "FILE_TOO_LARGE" });
  });

  it("rejects uploads that would exceed the room quota", async () => {
    const { service } = makeService({ maxSizeBytes: 5_000 });
    await service.createUploadIntent({
      roomId: "room_0000000000000000",
      accessToken: "art_test",
      name: "a.bin",
      mediaType: "application/octet-stream",
      size: 4_000,
    });
    await expect(
      service.createUploadIntent({
        roomId: "room_0000000000000000",
        accessToken: "art_test",
        name: "b.bin",
        mediaType: "application/octet-stream",
        size: 2_000,
      }),
    ).rejects.toMatchObject({
      statusCode: 413,
      code: "ROOM_FILE_QUOTA_EXCEEDED",
    });
  });

  it("fails completion when the object was never uploaded", async () => {
    const { service } = makeService();
    const intent = await service.createUploadIntent({
      roomId: "room_0000000000000000",
      accessToken: "art_test",
      name: "ghost.txt",
      mediaType: "text/plain",
      size: 5,
    });
    await expect(
      service.completeUpload({
        roomId: "room_0000000000000000",
        fileId: intent.fileId,
        accessToken: "art_test",
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "FILE_NOT_UPLOADED" });
  });

  it("detects a checksum mismatch on completion", async () => {
    const { repository, storage, service } = makeService();
    const bytes = Buffer.from("wrong\n", "utf8");
    const intent = await service.createUploadIntent({
      roomId: "room_0000000000000000",
      accessToken: "art_test",
      name: "signed.txt",
      mediaType: "text/plain",
      size: bytes.length,
      sha256: "ab".repeat(32),
    });
    const record = await repository.findAttachment(
      "room_0000000000000000",
      intent.fileId,
    );
    storage.stageObject(record!.storageKey, bytes);
    await expect(
      service.completeUpload({
        roomId: "room_0000000000000000",
        fileId: intent.fileId,
        accessToken: "art_test",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "FILE_CHECKSUM_MISMATCH",
    });
  });

  it("refuses downloads while the attachment is pending", async () => {
    const { service } = makeService();
    const intent = await service.createUploadIntent({
      roomId: "room_0000000000000000",
      accessToken: "art_test",
      name: "pending.txt",
      mediaType: "text/plain",
      size: 5,
    });
    await expect(
      service.getAttachment({
        roomId: "room_0000000000000000",
        attachmentId: intent.fileId,
        accessToken: "art_test",
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "ATTACHMENT_NOT_READY" });
  });

  it("validates that attachments exist and are completed", async () => {
    const { storage, service } = makeService();
    const intent = await service.createUploadIntent({
      roomId: "room_0000000000000000",
      accessToken: "art_test",
      name: "ok.txt",
      mediaType: "text/plain",
      size: 4,
    });
    expect(
      await service.validateAttachments("room_0000000000000000", [
        intent.fileId,
      ]),
    ).toBe(false);

    const { repository } = makeService();
    const record = await repository.findAttachment(
      "room_0000000000000000",
      intent.fileId,
    );
    void record;
    void storage;

    await expect(
      service.validateAttachments("room_0000000000000000", ["att_missing"]),
    ).resolves.toBe(false);
  });

  it("returns AppError for unknown attachments", async () => {
    const { service } = makeService();
    await expect(
      service.getAttachment({
        roomId: "room_0000000000000000",
        attachmentId: "att_0000000000000000",
        accessToken: "art_test",
      }),
    ).rejects.toBeInstanceOf(AppError);
  });
});
