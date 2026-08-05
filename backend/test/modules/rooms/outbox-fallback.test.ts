import { describe, expect, it } from "vitest";
import { InMemoryEventBus } from "../../../src/modules/realtime/event-bus.js";
import { InMemoryRoomRepository } from "../../../src/modules/rooms/memory-repository.js";
import type { RoomRepository } from "../../../src/modules/rooms/repository.js";
import { RoomService } from "../../../src/modules/rooms/service.js";

type RepositoryWithOutbox = InMemoryRoomRepository & {
  enqueueOutbox?: (roomId: string, payload: unknown) => Promise<void>;
};

describe("RoomService outbox fallback", () => {
  it("falls back to direct fan-out when outbox enqueue fails", async () => {
    const repository = new InMemoryRoomRepository() as RepositoryWithOutbox;
    repository.enqueueOutbox = async () => {
      throw new Error("database unavailable");
    };
    const eventBus = new InMemoryEventBus();
    const service = new RoomService(
      repository as unknown as RoomRepository,
      eventBus,
    );

    const received: string[] = [];
    const created = await service.createRoom({
      name: "fallback",
      displayName: "Owner",
      ownerUserId: null,
    });
    eventBus.subscribe(created.room.id, created.member.id, (event) => {
      received.push(event.type);
    });

    await service.sendMessage({
      kind: "text",
      roomId: created.room.id,
      accessToken: created.accessToken,
      text: "hello",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(received).toContain("message.created");
  });

  it("does not double-deliver when the outbox enqueue succeeds", async () => {
    const repository = new InMemoryRoomRepository() as RepositoryWithOutbox;
    const enqueued: unknown[] = [];
    repository.enqueueOutbox = async (_roomId: string, payload: unknown) => {
      enqueued.push(payload);
    };
    const eventBus = new InMemoryEventBus();
    const service = new RoomService(
      repository as unknown as RoomRepository,
      eventBus,
    );

    const created = await service.createRoom({
      name: "outbox",
      displayName: "Owner",
      ownerUserId: null,
    });
    const received: string[] = [];
    eventBus.subscribe(created.room.id, created.member.id, (event) => {
      received.push(event.type);
    });

    await service.sendMessage({
      kind: "text",
      roomId: created.room.id,
      accessToken: created.accessToken,
      text: "hello",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Enqueued for the drainer, not published directly.
    expect(enqueued).toHaveLength(1);
    expect(received).not.toContain("message.created");
  });
});
