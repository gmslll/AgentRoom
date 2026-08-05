import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentRoomClient } from "../src/bridge/agentroom-client.js";
import { CodexTaskRunner } from "../src/bridge/codex-runner.js";
import { CodexAppServerClient } from "../src/bridge/codex/app-server-client.js";
import { saveCodexState } from "../src/bridge/codex/state.js";
import type { PendingAgentDelivery } from "../src/modules/rooms/types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("bridge lifecycle", () => {
  it("treats an aborted realtime listener as a clean shutdown", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new AgentRoomClient({
      baseUrl: "http://127.0.0.1:8787",
      roomId: "room_12345678",
      accessToken: "art_12345678",
      httpTimeoutMs: 100,
      socketConnectTimeoutMs: 100,
      recoveryIntervalMs: 100,
    });

    await expect(client.listen(() => undefined, controller.signal)).resolves.toBe(
      undefined,
    );
  });

  it("rejects a missing Codex executable without crashing the process", async () => {
    const client = new CodexAppServerClient(
      "definitely-missing-agentroom-codex",
      process.cwd(),
      100,
      100,
    );

    await expect(client.start()).rejects.toMatchObject({ code: "ENOENT" });
    expect(client.isRunning()).toBe(false);
  });

  it("restarts Codex and resumes the thread after app-server exits", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "agentroom-state-"));
    temporaryDirectories.push(stateDirectory);
    let running = false;
    const appServer = {
      isRunning: vi.fn(() => running),
      start: vi.fn(async () => {
        running = true;
      }),
      startOrResumeThread: vi.fn(async (threadId?: string) => threadId ?? "thread_1"),
      runTurn: vi.fn(async () => "Done"),
      close: vi.fn(),
    } as unknown as CodexAppServerClient;
    const runner = new CodexTaskRunner(
      appServer,
      join(stateDirectory, "state.json"),
    );
    const delivery = pendingDelivery();

    await runner.run(delivery);
    running = false;
    await runner.run(delivery);

    expect(appServer.start).toHaveBeenCalledTimes(2);
    expect(appServer.startOrResumeThread).toHaveBeenNthCalledWith(1, undefined);
    expect(appServer.startOrResumeThread).toHaveBeenNthCalledWith(2, "thread_1");
    expect(appServer.runTurn).toHaveBeenCalledTimes(2);
  });

  it("never falls back to a new thread for an attached Codex session", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "agentroom-attached-"));
    temporaryDirectories.push(stateDirectory);
    const stateFile = join(stateDirectory, "state.json");
    await saveCodexState(stateFile, {
      threadId: "thread_existing",
      resumeRequired: true,
    });
    const appServer = {
      isRunning: vi.fn(() => false),
      start: vi.fn(async () => undefined),
      resumeThread: vi.fn(async () => {
        throw new Error("thread is unavailable");
      }),
      startOrResumeThread: vi.fn(async () => "thread_new"),
      runTurn: vi.fn(async () => "Done"),
      close: vi.fn(),
    } as unknown as CodexAppServerClient;
    const runner = new CodexTaskRunner(appServer, stateFile);

    await expect(runner.run(pendingDelivery())).rejects.toThrow(
      "thread is unavailable",
    );
    expect(appServer.resumeThread).toHaveBeenCalledWith("thread_existing");
    expect(appServer.startOrResumeThread).not.toHaveBeenCalled();
  });
});

function pendingDelivery(): PendingAgentDelivery {
  const createdAt = "2026-08-05T00:00:00.000Z";
  return {
    delivery: {
      id: "del_12345678",
      roomId: "room_12345678",
      taskMessageId: "msg_12345678",
      targetMemberId: "mem_agent123",
      status: "running",
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
      createdAt,
    },
  };
}
