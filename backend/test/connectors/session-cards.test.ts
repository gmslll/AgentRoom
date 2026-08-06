import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionCardStore } from "../../src/connectors/session-cards.js";
import type { PendingAgentDelivery } from "../../src/protocol/rooms.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("SessionCardStore", () => {
  it("publishes an idempotent private card and monotonic evidence files", async () => {
    const root = await temporaryRoot();
    const store = new SessionCardStore(
      root,
      "claude",
      "room_12345678",
    );
    const delivery = pending();

    const cardPath = await store.persist(delivery);
    await store.persist({
      ...delivery,
      delivery: {
        ...delivery.delivery,
        status: "received",
        updatedAt: "2026-08-05T00:01:00.000Z",
      },
    });
    await store.mark(delivery.delivery.id, "server_received");
    await store.mark(delivery.delivery.id, "server_received");
    await store.mark(delivery.delivery.id, "host_delivered");

    const card = JSON.parse(await readFile(cardPath, "utf8"));
    expect(card).toMatchObject({
      schemaVersion: 1,
      provider: "claude",
      delivery: {
        id: delivery.delivery.id,
        roomId: delivery.delivery.roomId,
      },
      task: { text: "Run tests" },
    });
    expect(card.delivery).not.toHaveProperty("status");
    expect(
      JSON.parse(
        await readFile(
          store.evidencePath(delivery.delivery.id, "host_delivered"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      deliveryId: delivery.delivery.id,
      status: "host_delivered",
    });

    if (process.platform !== "win32") {
      expect((await stat(cardPath)).mode & 0o777).toBe(0o600);
      expect((await stat(join(cardPath, ".."))).mode & 0o777).toBe(0o700);
    }
  });

  it("fails closed when an existing delivery ID contains different work", async () => {
    const root = await temporaryRoot();
    const store = new SessionCardStore(root, "codex", "room_12345678");
    const delivery = pending();
    await store.persist(delivery);

    await expect(
      store.persist({
        ...delivery,
        task: { ...delivery.task, text: "Different task" },
      }),
    ).rejects.toThrow("conflicts with the stored task");
  });

  it("rejects unsafe identifiers before constructing a card path", async () => {
    const root = await temporaryRoot();
    const store = new SessionCardStore(root, "codex", "room_12345678");
    const delivery = pending();

    await expect(
      store.persist({
        ...delivery,
        delivery: { ...delivery.delivery, id: "../../escape" },
      }),
    ).rejects.toThrow("delivery ID is not a safe AgentRoom identifier");
  });

  it.skipIf(process.platform === "win32")(
    "refuses a delivery directory redirected through a symbolic link",
    async () => {
      const root = await temporaryRoot();
      const outside = await temporaryRoot();
      const delivery = pending();
      const roomRoot = join(root, "codex", delivery.delivery.roomId);
      await mkdir(roomRoot, { recursive: true });
      await symlink(outside, join(roomRoot, delivery.delivery.id), "dir");
      const store = new SessionCardStore(root, "codex", delivery.delivery.roomId);

      await expect(store.persist(delivery)).rejects.toThrow(
        "Session card path is not a private directory",
      );
      await expect(readFile(join(outside, "card.json"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
  );
});

async function temporaryRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentroom-cards-"));
  temporaryDirectories.push(directory);
  await chmod(directory, 0o700);
  return directory;
}

function pending(): PendingAgentDelivery {
  const createdAt = "2026-08-05T00:00:00.000Z";
  return {
    delivery: {
      id: "del_12345678",
      roomId: "room_12345678",
      taskMessageId: "msg_12345678",
      targetMemberId: "mem_agent123",
      status: "queued",
      error: null,
      createdAt,
      updatedAt: createdAt,
    },
    task: {
      id: "msg_12345678",
      roomId: "room_12345678",
      sequence: 1,
      kind: "agent.task",
      text: "Run tests",
      attachmentIds: ["att_12345678"],
      targetMemberIds: ["mem_agent123"],
      inReplyToMessageId: null,
      idempotencyKey: "request-0001",
      author: {
        memberId: "mem_owner123",
        displayName: "Owner",
        actorType: "human",
        agentProvider: null,
      },
      createdAt,
    },
  };
}
