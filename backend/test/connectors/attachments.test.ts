import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentRoomClient,
  type AgentRoomAttachment,
} from "../../src/connectors/agentroom-client.js";
import {
  downloadAttachmentToWorkspace,
  uploadWorkspaceFiles,
} from "../../src/connectors/attachment-files.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

function client(): AgentRoomClient {
  return new AgentRoomClient({
    baseUrl: "https://try-status.online/api",
    roomId: "room_12345678",
    accessToken: "art_secret",
    httpTimeoutMs: 100,
    socketConnectTimeoutMs: 100,
    recoveryIntervalMs: 100,
  });
}

function attachment(bytes: Uint8Array): AgentRoomAttachment {
  return {
    id: "att_12345678",
    roomId: "room_12345678",
    uploaderMemberId: "mem_12345678",
    name: "diagram.png",
    mediaType: "image/png",
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    scanState: "clean",
    createdAt: "2026-08-06T00:00:00.000Z",
  };
}

describe("lazy AgentRoom attachments", () => {
  it("uploads through intent, object storage PUT, and completion", async () => {
    const bytes = Buffer.from("image bytes");
    const metadata = attachment(bytes);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            fileId: metadata.id,
            presignedUrl: "https://objects.example/upload",
            expiresAt: "2026-08-06T00:05:00.000Z",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attachment: metadata,
            downloadUrl: "https://objects.example/download",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      client().uploadAttachment({
        name: metadata.name,
        mediaType: metadata.mediaType,
        bytes,
      }),
    ).resolves.toEqual(metadata);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/files/upload-intents");
    expect(fetchMock.mock.calls[1]?.[0]).toEqual(
      new URL("https://objects.example/upload"),
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "PUT" });
    expect(fetchMock.mock.calls[2]?.[0]).toContain(
      `/files/${metadata.id}/complete`,
    );
  });

  it("downloads and verifies one exact attachment only when requested", async () => {
    const bytes = Buffer.from("verified attachment");
    const metadata = attachment(bytes);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            attachment: metadata,
            downloadUrl: "https://objects.example/download",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(bytes, {
          status: 200,
          headers: { "content-length": String(bytes.byteLength) },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const downloaded = await client().downloadAttachment(metadata.id);

    expect(Buffer.from(downloaded.bytes)).toEqual(bytes);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      `/attachments/${metadata.id}`,
    );
    expect(fetchMock.mock.calls[1]?.[0]).toEqual(
      new URL("https://objects.example/download"),
    );
  });

  it("does not fetch attachment metadata or bytes with message history", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ id: "msg_12345678", attachmentIds: ["att_12345678"] }],
          nextAfterSequence: 1,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const history = await client().listMessages(0, 50);

    expect(history.items[0]?.attachmentIds).toEqual(["att_12345678"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toContain("/messages?");
  });

  it("limits uploads to real files inside the configured workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agentroom-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "agentroom-outside-"));
    temporaryDirectories.push(workspace, outside);
    await writeFile(join(outside, "secret.txt"), "secret");
    await symlink(join(outside, "secret.txt"), join(workspace, "escape.txt"));
    const uploadAttachment = vi.fn();
    const fakeClient = { uploadAttachment } as unknown as AgentRoomClient;

    await expect(
      uploadWorkspaceFiles(fakeClient, workspace, ["escape.txt"]),
    ).rejects.toThrow("inside the configured workspace");
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("stores an on-demand download privately and reuses identical bytes", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agentroom-workspace-"));
    temporaryDirectories.push(workspace);
    const bytes = Buffer.from("private attachment");
    const metadata = attachment(bytes);
    const fakeClient = {
      downloadAttachment: vi.fn().mockResolvedValue({
        attachment: metadata,
        bytes,
      }),
    } as unknown as AgentRoomClient;

    const first = await downloadAttachmentToWorkspace(
      fakeClient,
      workspace,
      metadata.roomId,
      metadata.id,
    );
    const second = await downloadAttachmentToWorkspace(
      fakeClient,
      workspace,
      metadata.roomId,
      metadata.id,
    );

    expect(second.path).toBe(first.path);
    expect(await readFile(first.path)).toEqual(bytes);
    expect((await stat(first.path)).mode & 0o777).toBe(0o600);
  });
});
