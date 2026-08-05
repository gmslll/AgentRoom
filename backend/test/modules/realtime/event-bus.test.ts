import { describe, expect, it, vi } from "vitest";
import { InMemoryEventBus } from "../../../src/modules/realtime/event-bus.js";

describe("InMemoryEventBus", () => {
  it("sends targeted delivery events only to the addressed member", () => {
    const bus = new InMemoryEventBus();
    const target = vi.fn();
    const bystander = vi.fn();
    bus.subscribe("room_12345678", "mem_target123", target);
    bus.subscribe("room_12345678", "mem_other1234", bystander);

    const event = {
      version: 1 as const,
      eventId: "evt_12345678",
      type: "delivery.updated" as const,
      roomId: "room_12345678",
      occurredAt: "2026-08-05T00:00:00.000Z",
      data: {
        delivery: {
          id: "del_12345678",
          roomId: "room_12345678",
          taskMessageId: "msg_12345678",
          targetMemberId: "mem_target123",
          status: "queued" as const,
          error: null,
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z",
        },
      },
    };

    bus.publish(event, ["mem_target123"]);

    expect(target).toHaveBeenCalledWith(event);
    expect(bystander).not.toHaveBeenCalled();
  });

  it("isolates a failing subscriber from the publisher and other subscribers", () => {
    const onError = vi.fn();
    const bus = new InMemoryEventBus(onError);
    const healthy = vi.fn();
    bus.subscribe("room_12345678", "mem_broken123", () => {
      throw new Error("socket write failed");
    });
    bus.subscribe("room_12345678", "mem_healthy12", healthy);
    const event = {
      version: 1 as const,
      eventId: "evt_healthy123",
      type: "member.joined" as const,
      roomId: "room_12345678",
      occurredAt: "2026-08-05T00:00:00.000Z",
      data: {
        member: {
          id: "mem_joined123",
          roomId: "room_12345678",
          displayName: "Claude",
          actorType: "agent" as const,
          agentProvider: "claude" as const,
          role: "member" as const,
          joinedAt: "2026-08-05T00:00:00.000Z",
        },
      },
    };

    expect(() => bus.publish(event)).not.toThrow();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), event);
    expect(healthy).toHaveBeenCalledWith(event);
  });
});
