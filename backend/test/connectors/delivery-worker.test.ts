import { describe, expect, it, vi } from "vitest";
import { DeliveryWorker } from "../../src/connectors/delivery-worker.js";
import type { PendingAgentDelivery } from "../../src/protocol/rooms.js";

function pending(status: PendingAgentDelivery["delivery"]["status"] = "queued") {
  return {
    delivery: {
      id: "del_12345678",
      roomId: "room_12345678",
      taskMessageId: "msg_12345678",
      targetMemberId: "mem_agent123",
      status,
      error: null,
      createdAt: "2026-08-05T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    },
    task: {
      id: "msg_12345678",
      roomId: "room_12345678",
      sequence: 1,
      kind: "agent.task",
      text: "Run tests",
      attachmentIds: [],
      targetMemberIds: ["mem_agent123"],
      inReplyToMessageId: null,
      idempotencyKey: "request-0001",
      author: {
        memberId: "mem_owner123",
        displayName: "Owner",
        actorType: "human",
        agentProvider: null,
      },
      createdAt: "2026-08-05T00:00:00.000Z",
    },
  } satisfies PendingAgentDelivery;
}

describe("DeliveryWorker", () => {
  it("acknowledges, runs, and replies exactly once", async () => {
    const api = {
      updateDelivery: vi.fn(async () => ({})),
      replyToDelivery: vi.fn(async () => ({})),
    };
    const runner = { run: vi.fn(async () => "Done") };
    const worker = new DeliveryWorker(api, runner);
    const task = pending();

    worker.enqueue(task);
    worker.enqueue(task);
    await worker.idle();

    expect(api.updateDelivery.mock.calls).toEqual([
      [task.delivery.id, "received"],
      [task.delivery.id, "running"],
    ]);
    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(api.replyToDelivery).toHaveBeenCalledWith(task.delivery.id, "Done");
  });

  it("resumes a running delivery without moving its state backwards", async () => {
    const api = {
      updateDelivery: vi.fn(async () => ({})),
      replyToDelivery: vi.fn(async () => ({})),
    };
    const runner = { run: vi.fn(async () => "Recovered") };
    const worker = new DeliveryWorker(api, runner);
    const task = pending("running");

    worker.enqueue(task);
    await worker.idle();

    expect(api.updateDelivery).not.toHaveBeenCalled();
    expect(api.replyToDelivery).toHaveBeenCalledWith(
      task.delivery.id,
      "Recovered",
    );
  });

  it("bounds replies and failure details to the HTTP contract limits", async () => {
    const replyApi = {
      updateDelivery: vi.fn(
        async (_id: string, _status: string, _error?: string) => ({}),
      ),
      replyToDelivery: vi.fn(async (_id: string, _text: string) => ({})),
    };
    const replyWorker = new DeliveryWorker(replyApi, {
      run: vi.fn(async () => "R".repeat(9_000)),
    });
    replyWorker.enqueue(pending());
    await replyWorker.idle();

    expect(replyApi.replyToDelivery.mock.calls[0]?.[1]).toHaveLength(8_000);

    const failureApi = {
      updateDelivery: vi.fn(
        async (_id: string, _status: string, _error?: string) => ({}),
      ),
      replyToDelivery: vi.fn(async (_id: string, _text: string) => ({})),
    };
    const failureWorker = new DeliveryWorker(failureApi, {
      run: vi.fn(async () => {
        throw new Error("E".repeat(2_500));
      }),
    });
    failureWorker.enqueue(pending());
    await failureWorker.idle();

    const failedUpdate = failureApi.updateDelivery.mock.calls.at(-1);
    expect(failedUpdate?.slice(0, 2)).toEqual([
      "del_12345678",
      "failed",
    ]);
    expect(failedUpdate?.[2]).toHaveLength(2_000);
  });
});
