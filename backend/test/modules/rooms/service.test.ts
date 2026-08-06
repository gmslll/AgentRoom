import { describe, expect, it } from "vitest";
import { AppError } from "../../../src/lib/errors.js";
import { hashSecret } from "../../../src/lib/secrets.js";
import { InMemoryEventBus } from "../../../src/modules/realtime/event-bus.js";
import { InMemoryRoomRepository } from "../../../src/modules/rooms/memory-repository.js";
import { RoomService } from "../../../src/modules/rooms/service.js";

async function setupRoom(
  validateAttachments?: (roomId: string, attachmentIds: string[]) => Promise<boolean>,
) {
  const repository = new InMemoryRoomRepository();
  const service = new RoomService(
    repository,
    new InMemoryEventBus(),
    undefined,
    undefined,
    undefined,
    { ...(validateAttachments ? { validateAttachments } : {}) },
  );
  const owner = await service.createRoom({
    name: "Concurrency room",
    displayName: "Owner",
    ownerUserId: "usr_owner",
  });
  const agent = await service.joinRoom({
    roomId: owner.room.id,
    inviteCode: owner.inviteCode,
    displayName: "Codex",
    actorType: "agent",
    agentProvider: "codex",
    userId: null,
  });
  await repository.claimAgent({
    roomId: owner.room.id,
    agentMemberId: agent.member.id,
    codeHash: hashSecret(agent.agentClaim!.code),
    ownerUserId: "usr_owner",
    claimedAt: new Date().toISOString(),
  });
  return { service, owner, agent };
}

describe("RoomService concurrency", () => {
  it("publishes room governance events and revokes the owner on dissolution", async () => {
    const repository = new InMemoryRoomRepository();
    const eventBus = new InMemoryEventBus();
    const service = new RoomService(repository, eventBus);
    const owner = await service.createRoom({
      name: "Governed room",
      displayName: "Owner",
      ownerUserId: null,
    });
    const events: string[] = [];
    eventBus.subscribe(owner.room.id, owner.member.id, (event) => {
      events.push(event.type);
    });

    const updated = await service.updateRoom({
      roomId: owner.room.id,
      accessToken: owner.accessToken,
      name: "Published room",
      visibility: "public",
    });
    expect(updated).toMatchObject({
      name: "Published room",
      visibility: "public",
    });

    await service.dissolveRoom({
      roomId: owner.room.id,
      accessToken: owner.accessToken,
    });
    expect(events).toEqual(["room.updated", "room.dissolved"]);
    await expect(
      service.authenticate(owner.room.id, owner.accessToken),
    ).rejects.toMatchObject({ code: "ROOM_NOT_FOUND" });
    await expect(repository.isActiveMember(owner.room.id, owner.member.id)).resolves.toBe(false);
  });

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

  it("delivers attachment references to an Agent and accepts them on its reply", async () => {
    const { service, owner, agent } = await setupRoom(async () => true);
    const taskAttachmentId = "att_task_12345678";
    const replyAttachmentId = "att_reply_12345678";
    const task = await service.sendMessage({
      kind: "agent.task",
      roomId: owner.room.id,
      accessToken: owner.accessToken,
      text: "Review the attached image",
      targetMemberIds: [agent.member.id],
      idempotencyKey: "attachment-task-0001",
      attachmentIds: [taskAttachmentId],
    });
    const pending = await service.listPendingDeliveries({
      roomId: owner.room.id,
      accessToken: agent.accessToken,
    });

    expect(task.message.attachmentIds).toEqual([taskAttachmentId]);
    expect(pending[0]?.task.attachmentIds).toEqual([taskAttachmentId]);

    await service.updateDeliveryStatus({
      roomId: owner.room.id,
      deliveryId: task.deliveries[0]!.id,
      accessToken: agent.accessToken,
      status: "running",
      error: null,
    });

    const reply = await service.replyToDelivery({
      roomId: owner.room.id,
      deliveryId: task.deliveries[0]!.id,
      accessToken: agent.accessToken,
      text: "Reviewed the image",
      attachmentIds: [replyAttachmentId],
    });
    expect(reply.message.attachmentIds).toEqual([replyAttachmentId]);
  });

  it("treats attachment references as part of task idempotency", async () => {
    const { service, owner, agent } = await setupRoom(async () => true);
    const common = {
      kind: "agent.task" as const,
      roomId: owner.room.id,
      accessToken: owner.accessToken,
      text: "Review attachment",
      targetMemberIds: [agent.member.id],
      idempotencyKey: "attachment-conflict-0001",
    };
    await service.sendMessage({
      ...common,
      attachmentIds: ["att_first_12345678"],
    });

    await expect(
      service.sendMessage({
        ...common,
        attachmentIds: ["att_second_12345678"],
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "IDEMPOTENCY_KEY_REUSED",
    });
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
