import { describe, expect, it } from "vitest";
import { InMemoryEventBus } from "../../../src/modules/realtime/event-bus.js";
import { OutboxPublisher } from "../../../src/modules/realtime/outbox-publisher.js";
import type {
  OutboxEntry,
  RoomRepository,
} from "../../../src/modules/rooms/repository.js";
import type { RealtimeServerEvent } from "../../../src/modules/rooms/types.js";

class FakeOutboxRepository {
  readonly published: number[] = [];
  readonly entries: OutboxEntry[] = [];
  readonly #snapshot = new Map<number, OutboxEntry>();
  nextId = 1;
  releaseOutbox?: (ids: number[]) => Promise<void>;

  enqueueOutbox(_roomId: string, payload: unknown): Promise<void> {
    const entry = { id: this.nextId++, roomId: "room_1", payload };
    this.entries.push(entry);
    this.#snapshot.set(entry.id, entry);
    return Promise.resolve();
  }

  // Mirrors the PostgreSQL implementation: claiming a batch atomically marks
  // it as published (no separate mark step is needed).
  listPendingOutbox(limit: number): Promise<OutboxEntry[]> {
    const batch = this.entries.splice(0, limit);
    for (const entry of batch) {
      this.published.push(entry.id);
    }
    return Promise.resolve(batch);
  }

  defaultReleaseOutbox(ids: number[]): Promise<void> {
    for (const id of ids) {
      const entry = this.#snapshot.get(id);
      if (entry) {
        this.entries.unshift(entry);
      }
    }
    return Promise.resolve();
  }
}

function makeEvent(sequence: number): RealtimeServerEvent {
  return {
    version: 1,
    eventId: `evt_${sequence}`,
    type: "message.created",
    roomId: "room_1",
    sequence,
    occurredAt: "2026-08-05T00:00:00.000Z",
    data: {
      message: {
        id: `msg_${sequence}`,
        roomId: "room_1",
        sequence,
        kind: "text",
        text: "hi",
        attachmentIds: [],
        targetMemberIds: [],
        inReplyToMessageId: null,
        idempotencyKey: null,
        author: {
          memberId: "mem_1",
          displayName: "Owner",
          actorType: "human",
          agentProvider: null,
        },
        createdAt: "2026-08-05T00:00:00.000Z",
      },
    },
  };
}

describe("OutboxPublisher", () => {
  it("publishes and acknowledges pending outbox events", async () => {
    const repository = new FakeOutboxRepository();
    const eventBus = new InMemoryEventBus();
    const received: RealtimeServerEvent[] = [];
    eventBus.subscribe("room_1", "mem_1", (event) => received.push(event));

    await repository.enqueueOutbox("room_1", makeEvent(1));
    await repository.enqueueOutbox("room_1", makeEvent(2));

    const publisher = new OutboxPublisher(
      repository as unknown as RoomRepository,
      eventBus,
      10_000, 100,
    );
    await publisher.drain();

    expect(
      received
        .filter((event) => event.type === "message.created")
        .map((event) => event.sequence),
    ).toEqual([1, 2]);
    expect(repository.published).toEqual([1, 2]);
    expect(repository.entries).toHaveLength(0);
  });

  it("does nothing when the repository has no outbox support", async () => {
    const repository = {} as RoomRepository;
    const eventBus = new InMemoryEventBus();
    const publisher = new OutboxPublisher(
      repository,
      eventBus,
      10_000, 100,
    );
    await publisher.drain();
    // No throw is the assertion: unsupported repositories are skipped.
    expect(true).toBe(true);
  });

  it("re-queues entries whose fan-out failed", async () => {
    const repository = new FakeOutboxRepository();
    repository.releaseOutbox = (ids: number[]) =>
      repository.defaultReleaseOutbox(ids);
    await repository.enqueueOutbox("room_1", makeEvent(1));

    let shouldFail = true;
    const failingBus = new InMemoryEventBus();
    const busWithReport = Object.assign(failingBus, {
      publishAndReport: async (
        event: RealtimeServerEvent,
        audienceMemberIds?: string[],
      ) => {
        if (shouldFail) {
          return false;
        }
        failingBus.publish(event, audienceMemberIds);
        return true;
      },
    });

    const publisher = new OutboxPublisher(
      repository as unknown as RoomRepository,
      busWithReport,
      10_000, 100,
    );
    await publisher.drain();
    expect(repository.published).toEqual([1]);
    expect(repository.entries).toHaveLength(1);

    // A second drain with the bus healthy delivers and keeps the entry gone.
    shouldFail = false;
    const received: RealtimeServerEvent[] = [];
    failingBus.subscribe("room_1", "mem_1", (event) => received.push(event));
    await publisher.drain();
    expect(received).toHaveLength(1);
    expect(repository.entries).toHaveLength(0);
  });
});
