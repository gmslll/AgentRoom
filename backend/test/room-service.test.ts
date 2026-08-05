import { describe, expect, it } from "vitest";
import { AppError } from "../src/lib/errors.js";
import { InMemoryEventBus } from "../src/modules/realtime/event-bus.js";
import { InMemoryRoomRepository } from "../src/modules/rooms/memory-repository.js";
import { RoomService } from "../src/modules/rooms/service.js";

async function setupRoom() {
  const service = new RoomService(
    new InMemoryRoomRepository(),
    new InMemoryEventBus(),
  );
  const owner = await service.createRoom({
    name: "Concurrency room",
    displayName: "Owner",
    ownerUserId: null,
  });
  const agent = await service.joinRoom({
    roomId: owner.room.id,
    inviteCode: owner.inviteCode,
    displayName: "Codex",
    actorType: "agent",
    agentProvider: "codex",
    userId: null,
  });
  return { service, owner, agent };
}

describe("RoomService concurrency", () => {
  it("creates one task and delivery under concurrent idempotent requests", async () => {
    const { service, owner, agent } = await setupRoom();
    const request = () =>
      service.sendMessage({
        kind: "agent.task",
        roomId: owner.room.id,
        accessToken: owner.accessToken,
        text: "Run the same task once",
        targetMemberIds: [agent.member.id],
        idempotencyKey: "concurrent-request-0001",
      });

    const results = await Promise.all(Array.from({ length: 20 }, request));
    const pending = await service.listPendingDeliveries({
      roomId: owner.room.id,
      accessToken: agent.accessToken,
    });

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.message.id)).size).toBe(1);
    expect(pending).toHaveLength(1);
  });

  it("rejects reuse of an idempotency key with a different payload", async () => {
    const { service, owner, agent } = await setupRoom();
    const common = {
      kind: "agent.task" as const,
      roomId: owner.room.id,
      accessToken: owner.accessToken,
      targetMemberIds: [agent.member.id],
      idempotencyKey: "payload-conflict-0001",
    };
    await service.sendMessage({ ...common, text: "First payload" });

    await expect(
      service.sendMessage({ ...common, text: "Different payload" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    } satisfies Partial<AppError>);
  });

  it("commits at most one reply under concurrent delivery replies", async () => {
    const { service, owner, agent } = await setupRoom();
    const task = await service.sendMessage({
      kind: "agent.task",
      roomId: owner.room.id,
      accessToken: owner.accessToken,
      text: "Reply once",
      targetMemberIds: [agent.member.id],
      idempotencyKey: "concurrent-reply-0001",
    });
    const deliveryId = task.deliveries[0]!.id;
    await service.updateDeliveryStatus({
      roomId: owner.room.id,
      deliveryId,
      accessToken: agent.accessToken,
      status: "running",
      error: null,
    });

    const results = await Promise.allSettled([
      service.replyToDelivery({
        roomId: owner.room.id,
        deliveryId,
        accessToken: agent.accessToken,
        text: "Reply A",
      }),
      service.replyToDelivery({
        roomId: owner.room.id,
        deliveryId,
        accessToken: agent.accessToken,
        text: "Reply B",
      }),
    ]);
    const messages = await service.listMessages({
      roomId: owner.room.id,
      accessToken: owner.accessToken,
      afterSequence: 0,
      limit: 50,
    });

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(
      1,
    );
    expect(messages.filter((message) => message.kind === "agent.reply")).toHaveLength(
      1,
    );
  });
});
