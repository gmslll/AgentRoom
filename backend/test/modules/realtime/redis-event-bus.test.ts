import { describe, expect, it } from "vitest";
import { MemoryKeyValueStore } from "../../../src/lib/redis.js";
import { RedisEventBus } from "../../../src/modules/realtime/event-bus.js";
import type { RealtimeServerEvent } from "../../../src/modules/rooms/types.js";

function makeEvent(roomId: string, sequence: number): RealtimeServerEvent {
  return {
    version: 1,
    eventId: `evt_${sequence}`,
    type: "message.created",
    roomId,
    sequence,
    occurredAt: "2026-08-05T00:00:00.000Z",
    data: {
      message: {
        id: `msg_${sequence}`,
        roomId,
        sequence,
        kind: "text",
        text: "hello",
        attachmentIds: [],
        targetMemberIds: [],
        inReplyToMessageId: null,
        idempotencyKey: null,
        author: {
          memberId: "mem_0000000000000000",
          displayName: "Owner",
          actorType: "human",
          agentProvider: null,
        },
        createdAt: "2026-08-05T00:00:00.000Z",
      },
    },
  };
}

describe("RedisEventBus", () => {
  it("delivers events to local subscribers and filters by audience", async () => {
    const store = new MemoryKeyValueStore();
    const bus = new RedisEventBus(store);

    const received: RealtimeServerEvent[] = [];
    const unsubscribe = bus.subscribe("room_1", "mem_a", (event) => {
      received.push(event);
    });
    // Let the async channel subscription settle.
    await new Promise((resolve) => setTimeout(resolve, 10));

    bus.publish(makeEvent("room_1", 1), ["mem_a"]);
    bus.publish(makeEvent("room_1", 2), ["mem_b"]);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(
      received
        .filter((event) => event.type === "message.created")
        .map((event) => event.sequence),
    ).toEqual([1]);

    unsubscribe();
    bus.publish(makeEvent("room_1", 3));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(received).toHaveLength(1);
  });

  it("fans out events across bus instances sharing a store", async () => {
    const store = new MemoryKeyValueStore();
    const busA = new RedisEventBus(store);
    const busB = new RedisEventBus(store);

    const receivedA: number[] = [];
    const receivedB: number[] = [];
    const sequenceOf = (event: RealtimeServerEvent) =>
      event.type === "message.created" ? event.sequence : -1;
    busA.subscribe("room_1", "mem_a", (event) =>
      receivedA.push(sequenceOf(event)),
    );
    busB.subscribe("room_1", "mem_b", (event) =>
      receivedB.push(sequenceOf(event)),
    );
    await new Promise((resolve) => setTimeout(resolve, 10));

    busA.publish(makeEvent("room_1", 1));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(receivedA).toEqual([1]);
    expect(receivedB).toEqual([1]);
  });

  it("does not echo remote events back to the originating instance", async () => {
    const store = new MemoryKeyValueStore();
    const busA = new RedisEventBus(store);
    const busB = new RedisEventBus(store);

    const receivedA: number[] = [];
    busA.subscribe("room_1", "mem_a", (event) => {
      if (event.type === "message.created") {
        receivedA.push(event.sequence);
      }
    });
    busB.subscribe("room_1", "mem_b", () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));

    busA.publish(makeEvent("room_1", 1));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // A published locally once and must not receive its own event again.
    expect(receivedA).toEqual([1]);
  });
});

describe("KeyValueStore limits", () => {
  it("increments with expiry and deletes", async () => {
    const store = new MemoryKeyValueStore();
    expect(await store.increment("k", 10_000)).toBe(1);
    expect(await store.increment("k", 10_000)).toBe(2);
    await store.del("k");
    expect(await store.increment("k", 10_000)).toBe(1);
  });
});

class FlakySubscribeStore extends MemoryKeyValueStore {
  subscribeCalls = 0;
  failNextSubscribe = true;

  override async subscribe(
    channel: string,
    onMessage: (message: string) => void,
  ): Promise<() => Promise<void>> {
    this.subscribeCalls += 1;
    if (this.failNextSubscribe) {
      this.failNextSubscribe = false;
      throw new Error("redis unavailable");
    }
    return super.subscribe(channel, onMessage);
  }
}

describe("RedisEventBus subscription recovery", () => {
  it("retries a failed channel subscription with backoff", async () => {
    const store = new FlakySubscribeStore();
    const busA = new RedisEventBus(store);
    const busB = new RedisEventBus(store);

    const receivedB: number[] = [];
    busB.subscribe("room_1", "mem_b", (event) => {
      if (event.type === "message.created") {
        receivedB.push(event.sequence);
      }
    });
    // First subscribe attempt fails; backoff retry (500ms) must land.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(store.subscribeCalls).toBeGreaterThanOrEqual(2);

    busA.publish(makeEvent("room_1", 7));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(receivedB).toEqual([7]);
  });

  it("keeps delivering after a retry succeeds", async () => {
    const store = new FlakySubscribeStore();
    const busA = new RedisEventBus(store);
    const busB = new RedisEventBus(store);

    const receivedB: number[] = [];
    busB.subscribe("room_1", "mem_b", (event) => {
      if (event.type === "message.created") {
        receivedB.push(event.sequence);
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 700));

    busA.publish(makeEvent("room_1", 1));
    busA.publish(makeEvent("room_1", 2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(receivedB).toEqual([1, 2]);
  });
});
