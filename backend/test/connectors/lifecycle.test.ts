import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentRoomClient,
  agentRoomRequestHeaders,
  realtimeWebSocketUrl,
} from "../../src/connectors/agentroom-client.js";
import { CodexAppServerClient } from "../../src/connectors/codex/app-server-client.js";
import { CodexTaskRunner } from "../../src/connectors/codex/runner.js";
import { saveCodexState } from "../../src/connectors/codex/state.js";
import type { PendingAgentDelivery } from "../../src/protocol/rooms.js";

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

describe("bridge lifecycle", () => {
  it("does not declare an empty realtime-ticket request as JSON", () => {
    const emptyPost = agentRoomRequestHeaders("art_member");
    expect(emptyPost.get("authorization")).toBe("Bearer art_member");
    expect(emptyPost.has("content-type")).toBe(false);

    const jsonPost = agentRoomRequestHeaders("art_member", {
      body: JSON.stringify({ status: "running" }),
    });
    expect(jsonPost.get("content-type")).toBe("application/json");
  });

  it("preserves the public API path prefix in realtime WebSocket URLs", () => {
    expect(
      realtimeWebSocketUrl(
        "https://try-status.online/api",
        "ticket/with spaces",
      ).toString(),
    ).toBe(
      "wss://try-status.online/api/v1/realtime?ticket=ticket%2Fwith+spaces",
    );
    expect(
      realtimeWebSocketUrl("http://127.0.0.1:8787", "ticket_1").toString(),
    ).toBe("ws://127.0.0.1:8787/v1/realtime?ticket=ticket_1");
  });

  it("posts ordinary room text without exposing the member token", async () => {
    const message = {
      id: "msg_1",
      roomId: "room_12345678",
      sequence: 1,
      kind: "text" as const,
      text: "你好，AgentRoom！",
      attachmentIds: [],
      targetMemberIds: [],
      inReplyToMessageId: null,
      idempotencyKey: null,
      author: {
        memberId: "mem_1",
        displayName: "Codex",
        actorType: "agent" as const,
        agentProvider: "codex" as const,
      },
      createdAt: "2026-08-06T00:00:00.000Z",
    };
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ message }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new AgentRoomClient({
      baseUrl: "https://try-status.online/api",
      roomId: "room_12345678",
      accessToken: "art_secret",
      httpTimeoutMs: 100,
      socketConnectTimeoutMs: 100,
      recoveryIntervalMs: 100,
    });

    await expect(client.sendTextMessage(message.text)).resolves.toEqual(message);
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://try-status.online/api/v1/rooms/room_12345678/messages",
    );
    expect(request).toMatchObject({
      method: "POST",
      body: JSON.stringify({ kind: "text", text: message.text }),
    });
    expect(new Headers(request?.headers).get("authorization")).toBe(
      "Bearer art_secret",
    );
  });

  it("posts structured Agent tasks with targets and idempotency", async () => {
    const message = {
      id: "msg_task",
      roomId: "room_12345678",
      sequence: 2,
      kind: "agent.task" as const,
      text: "Review this change",
      attachmentIds: [],
      targetMemberIds: ["mem_target_12345678"],
      inReplyToMessageId: null,
      idempotencyKey: "task_request_12345678",
      author: {
        memberId: "mem_sender_12345678",
        displayName: "Codex",
        actorType: "agent" as const,
        agentProvider: "codex" as const,
      },
      createdAt: "2026-08-06T00:00:00.000Z",
    };
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ message, deliveries: [] }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new AgentRoomClient({
      baseUrl: "https://try-status.online/api",
      roomId: "room_12345678",
      accessToken: "art_secret",
      httpTimeoutMs: 100,
      socketConnectTimeoutMs: 100,
      recoveryIntervalMs: 100,
    });

    await expect(
      client.sendAgentTask(
        message.text,
        message.targetMemberIds,
        message.idempotencyKey,
      ),
    ).resolves.toEqual({ message, deliveries: [] });
    const [url, request] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://try-status.online/api/v1/rooms/room_12345678/messages",
    );
    expect(request).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        kind: "agent.task",
        text: message.text,
        targetMemberIds: message.targetMemberIds,
        idempotencyKey: message.idempotencyKey,
      }),
    });
  });

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

  it("does not reconnect after the membership is revoked", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "ROOM_NOT_FOUND",
            message: "Room not found",
          },
        }),
        {
          status: 404,
          headers: { "content-type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const controller = new AbortController();
    const client = new AgentRoomClient({
      baseUrl: "http://127.0.0.1:8787",
      roomId: "room_12345678",
      accessToken: "art_12345678",
      httpTimeoutMs: 100,
      socketConnectTimeoutMs: 100,
      recoveryIntervalMs: 100,
    });
    const states: string[] = [];

    const listening = client.listen(
      () => undefined,
      controller.signal,
      undefined,
      (update) => {
        states.push(update.state);
      },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(states).toContain("revoked"));
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    controller.abort();
    await expect(listening).resolves.toBe(undefined);
    expect(states).toEqual(["connecting", "revoked", "stopped"]);
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

  it("records Codex acceptance only after App Server accepts the turn", async () => {
    const stateDirectory = await mkdtemp(join(tmpdir(), "agentroom-card-turn-"));
    temporaryDirectories.push(stateDirectory);
    const acceptedByAgent = vi.fn(async () => undefined);
    const appServer = {
      isRunning: vi.fn(() => false),
      start: vi.fn(async () => undefined),
      startOrResumeThread: vi.fn(async () => "thread_1"),
      runTurn: vi.fn(async (
        _threadId: string,
        prompt: string,
        onStarted?: (turnId: string) => void,
      ) => {
        expect(prompt).toContain(
          "Local session card: /workspace/.agentroom/card.json",
        );
        onStarted?.("turn_1");
        return "Done";
      }),
      close: vi.fn(),
    } as unknown as CodexAppServerClient;
    const runner = new CodexTaskRunner(
      appServer,
      join(stateDirectory, "state.json"),
    );

    await runner.run(pendingDelivery(), {
      sessionCardPath: "/workspace/.agentroom/card.json",
      acceptedByAgent,
    });

    expect(acceptedByAgent).toHaveBeenCalledTimes(1);
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
