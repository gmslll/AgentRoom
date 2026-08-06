import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import WebSocket from "ws";

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonRpcNotification {
  method: string;
  params?: Record<string, unknown>;
  id?: number;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

interface CompletedTurn {
  status: string;
  error?: string;
}

export interface CodexThreadSummary {
  id: string;
  name?: string;
  preview?: string;
  createdAt?: number;
  updatedAt?: number;
  status?: string;
}

export class CodexAppServerClient {
  #process: ChildProcessWithoutNullStreams | undefined;
  #socket: WebSocket | undefined;
  #requestId = 0;
  readonly #pending = new Map<number, PendingRequest>();
  readonly #turnWaiters = new Map<
    string,
    {
      resolve: (text: string) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  readonly #completedTurns = new Map<string, CompletedTurn>();
  readonly #lastAgentMessage = new Map<string, string>();
  readonly #timedOutTurns = new Set<string>();
  readonly #ownedTurns = new Set<string>();
  readonly #threadStatuses = new Map<string, string>();
  readonly #threadStatusWaiters = new Map<string, Set<() => void>>();
  #turnStartInFlight = false;
  #starting: Promise<void> | undefined;

  constructor(
    private readonly command: string,
    private readonly workspace: string,
    private readonly requestTimeoutMs = 30_000,
    private readonly turnTimeoutMs = 30 * 60_000,
    private readonly endpoint?: string,
  ) {}

  async start(): Promise<void> {
    if (this.isRunning()) {
      return;
    }
    if (this.#starting) {
      return this.#starting;
    }

    const starting = this.startProcess();
    this.#starting = starting;
    try {
      await starting;
    } finally {
      if (this.#starting === starting) {
        this.#starting = undefined;
      }
    }
  }

  isRunning(): boolean {
    return Boolean(
      (this.#process?.stdin.writable && !this.#process.killed) ||
        this.#socket?.readyState === WebSocket.OPEN,
    );
  }

  private async startProcess(): Promise<void> {
    try {
      if (this.endpoint) {
        await this.startSocketTransport();
      } else {
        this.startStdioTransport();
      }
      await this.request("initialize", {
        clientInfo: {
          name: "agentroom_bridge",
          title: "AgentRoom Bridge",
          version: "0.4.1",
        },
      });
      this.notify("initialized", {});
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      const child = this.#process;
      const socket = this.#socket;
      this.#process = undefined;
      this.#socket = undefined;
      child?.kill("SIGTERM");
      socket?.terminate();
      this.failAll(failure);
      throw error;
    }
  }

  private startStdioTransport(): void {
    const child = spawn(
      this.command,
      ["app-server"],
      {
        cwd: this.workspace,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.#process = child;
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        this.handleMessage(JSON.parse(line) as JsonRpcResponse | JsonRpcNotification);
      } catch (error) {
        console.error("Ignoring invalid Codex app-server message:", error);
      }
    });
    child.once("error", (error) => {
      this.handleProcessTermination(child, error);
    });
    child.once("exit", (code, signal) => {
      this.handleProcessTermination(
        child,
        new Error(
          `Codex app-server exited (${signal ?? `code ${code ?? "unknown"}`})`,
        ),
      );
    });
  }

  private async startSocketTransport(): Promise<void> {
    const endpoint = this.endpoint;
    if (!endpoint) {
      throw new Error("Codex app-server endpoint is required");
    }
    const unixPath = endpoint.startsWith("unix://")
      ? endpoint.slice("unix://".length)
      : undefined;
    const socket = unixPath
      ? new WebSocket("ws://localhost/rpc", {
          perMessageDeflate: false,
          createConnection: () => createConnection(unixPath),
        })
      : new WebSocket(endpoint, { perMessageDeflate: false });
    this.#socket = socket;
    await new Promise<void>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        socket.terminate();
        reject(
          new Error(
            `Timed out connecting to Codex app-server endpoint ${endpoint}`,
          ),
        );
      }, this.requestTimeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        socket.off("open", opened);
        socket.off("error", failed);
        socket.off("close", closed);
      };
      const opened = () => {
        cleanup();
        resolvePromise();
      };
      const failed = (error: Error) => {
        cleanup();
        reject(error);
      };
      const closed = () => {
        cleanup();
        reject(
          new Error(
            `Codex app-server endpoint ${endpoint} closed during startup`,
          ),
        );
      };
      socket.once("open", opened);
      socket.once("error", failed);
      socket.once("close", closed);
    });
    socket.on("message", (raw) => {
      try {
        this.handleMessage(
          JSON.parse(raw.toString()) as JsonRpcResponse | JsonRpcNotification,
        );
      } catch (error) {
        console.error("Ignoring invalid Codex app-server message:", error);
      }
    });
    socket.once("error", (error) => {
      this.handleSocketTermination(socket, error);
    });
    socket.once("close", (code, reason) => {
      this.handleSocketTermination(
        socket,
        new Error(
          `Codex app-server socket closed (${code}${
            reason.length ? `: ${reason.toString()}` : ""
          })`,
        ),
      );
    });
  }

  async startOrResumeThread(
    threadId?: string,
    developerInstructions?: string,
  ): Promise<string> {
    if (threadId) {
      try {
        return await this.resumeThread(threadId, developerInstructions);
      } catch (error) {
        if (!this.isRunning()) {
          throw error;
        }
        console.error(`Could not resume Codex thread ${threadId}:`, error);
      }
    }

    const result = asObject(
      await this.request("thread/start", {
        cwd: this.workspace,
        ...(developerInstructions ? { developerInstructions } : {}),
      }),
    );
    return this.captureThread(result);
  }

  async resumeThread(
    threadId: string,
    developerInstructions?: string,
  ): Promise<string> {
    const result = asObject(
      await this.request("thread/resume", {
        threadId,
        ...(developerInstructions ? { developerInstructions } : {}),
      }),
    );
    return this.captureThread(result);
  }

  async setThreadName(threadId: string, name: string): Promise<void> {
    await this.request("thread/name/set", { threadId, name });
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.request("thread/delete", { threadId });
    this.#threadStatuses.delete(threadId);
  }

  async listThreads(limit = 50): Promise<CodexThreadSummary[]> {
    const result = await this.request("thread/list", {
      limit,
      sortKey: "updated_at",
      sortDirection: "desc",
      archived: false,
      cwd: this.workspace,
      sourceKinds: ["cli", "vscode", "appServer"],
    });
    return parseCodexThreadList(result);
  }

  async runTurn(
    threadId: string,
    prompt: string,
    onStarted?: (turnId: string) => void,
  ): Promise<string> {
    const deadline = Date.now() + this.turnTimeoutMs;
    await this.waitForThreadIdle(threadId, deadline);
    let result: Record<string, unknown>;
    while (true) {
      this.#turnStartInFlight = true;
      try {
        result = asObject(
          await this.request("turn/start", {
            threadId,
            input: [{ type: "text", text: prompt }],
            cwd: this.workspace,
            approvalPolicy: "never",
            sandboxPolicy: {
              type: "workspaceWrite",
              writableRoots: [this.workspace],
              networkAccess: false,
            },
          }),
        );
        break;
      } catch (error) {
        this.#turnStartInFlight = false;
        this.pruneUnownedTurnEvents();
        if (!isThreadBusyError(error) || Date.now() >= deadline) {
          throw error;
        }
        await this.waitForThreadIdle(threadId, deadline, true);
      }
    }
    let turnId: string;
    try {
      turnId = requiredNestedId(result, "turn");
      this.#ownedTurns.add(turnId);
    } finally {
      this.#turnStartInFlight = false;
    }
    for (const candidate of this.#completedTurns.keys()) {
      if (candidate !== turnId) {
        this.#completedTurns.delete(candidate);
        this.#lastAgentMessage.delete(candidate);
      }
    }
    onStarted?.(turnId);
    const completed = this.#completedTurns.get(turnId);
    if (completed) {
      this.#completedTurns.delete(turnId);
      return this.finishTurn(turnId, completed);
    }

    return new Promise<string>((resolvePromise, reject) => {
      const remainingMs = Math.max(1, deadline - Date.now());
      const timer = setTimeout(() => {
        this.#turnWaiters.delete(turnId);
        this.#lastAgentMessage.delete(turnId);
        this.#ownedTurns.delete(turnId);
        this.#timedOutTurns.add(turnId);
        const timeoutError = new Error(
          `Codex turn timed out after ${this.turnTimeoutMs}ms`,
        );
        const rejectTimeout = () => reject(timeoutError);
        if (this.isRunning()) {
          void this.request("turn/interrupt", { threadId, turnId }).then(
            rejectTimeout,
            (error: unknown) => {
              console.error(`Could not interrupt timed-out Codex turn ${turnId}:`, error);
              rejectTimeout();
            },
          );
        } else {
          rejectTimeout();
        }
      }, remainingMs);
      this.#turnWaiters.set(turnId, {
        resolve: resolvePromise,
        reject,
        timer,
      });
    });
  }

  close(): void {
    const child = this.#process;
    const socket = this.#socket;
    if (!child && !socket) {
      return;
    }
    this.#process = undefined;
    this.#socket = undefined;
    child?.kill("SIGTERM");
    socket?.terminate();
    this.failAll(new Error("Codex app-server closed"));
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.#requestId;
    return new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new Error(
            `Codex app-server request ${method} timed out after ${this.requestTimeoutMs}ms`,
          ),
        );
      }, this.requestTimeoutMs);
      this.#pending.set(id, { resolve: resolvePromise, reject, timer });
      try {
        this.send({ method, id, params });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ method, params });
  }

  private send(message: unknown): void {
    if (this.#socket?.readyState === WebSocket.OPEN) {
      this.#socket.send(JSON.stringify(message));
      return;
    }
    if (this.#process?.stdin.writable) {
      this.#process.stdin.write(`${JSON.stringify(message)}\n`);
      return;
    }
    throw new Error("Codex app-server is not running");
  }

  private handleMessage(
    message: JsonRpcResponse | JsonRpcNotification,
  ): void {
    if ("id" in message && typeof message.id === "number" && !("method" in message)) {
      const pending = this.#pending.get(message.id);
      if (!pending) {
        return;
      }
      this.#pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new Error(`Codex app-server: ${message.error.message}`),
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (!("method" in message)) {
      return;
    }

    if (typeof message.id === "number") {
      this.send({
        id: message.id,
        error: {
          code: -32_000,
          message: "AgentRoom unattended mode cannot answer interactive requests",
        },
      });
      return;
    }

    if (message.method === "thread/status/changed") {
      const params = asObject(message.params);
      const threadId =
        typeof params.threadId === "string" ? params.threadId : undefined;
      const status = asObject(params.status).type;
      if (threadId && typeof status === "string") {
        this.#threadStatuses.set(threadId, status);
        this.notifyThreadStatusWaiters(threadId);
      }
      return;
    }

    if (message.method === "item/completed") {
      const params = asObject(message.params);
      const item = asObject(params.item);
      if (item.type === "agentMessage" && typeof item.text === "string") {
        const turnId = typeof params.turnId === "string" ? params.turnId : undefined;
        if (
          turnId &&
          (this.#ownedTurns.has(turnId) || this.#turnStartInFlight) &&
          !this.#timedOutTurns.has(turnId) &&
          item.text.trim()
        ) {
          this.#lastAgentMessage.set(turnId, item.text);
        }
      }
      return;
    }

    if (message.method === "turn/completed") {
      const params = asObject(message.params);
      const turn = asObject(params.turn);
      if (typeof turn.id !== "string") {
        return;
      }
      const turnId = turn.id;
      if (!this.#ownedTurns.has(turnId) && !this.#turnStartInFlight) {
        return;
      }
      if (this.#timedOutTurns.delete(turnId)) {
        this.#lastAgentMessage.delete(turnId);
        this.#ownedTurns.delete(turnId);
        return;
      }
      const turnError = asObject(turn.error).message;
      const completed: CompletedTurn = {
        status: typeof turn.status === "string" ? turn.status : "failed",
        ...(typeof turnError === "string" ? { error: turnError } : {}),
      };
      const waiter = this.#turnWaiters.get(turnId);
      if (!waiter) {
        this.#completedTurns.set(turnId, completed);
        return;
      }
      this.#turnWaiters.delete(turnId);
      clearTimeout(waiter.timer);
      try {
        waiter.resolve(this.finishTurn(turnId, completed));
      } catch (error) {
        waiter.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private finishTurn(turnId: string, completed: CompletedTurn): string {
    const message = this.#lastAgentMessage.get(turnId) ?? "";
    this.#lastAgentMessage.delete(turnId);
    this.#ownedTurns.delete(turnId);
    if (completed.status !== "completed") {
      throw new Error(
        completed.error ?? `Codex turn ended with status ${completed.status}`,
      );
    }
    return message;
  }

  private captureThread(result: Record<string, unknown>): string {
    const thread = asObject(result.thread);
    const threadId = requiredNestedId(result, "thread");
    const status = asObject(thread.status).type;
    if (typeof status === "string") {
      this.#threadStatuses.set(threadId, status);
    }
    return threadId;
  }

  private async waitForThreadIdle(
    threadId: string,
    deadline: number,
    waitAtLeastOnce = false,
  ): Promise<void> {
    while (
      waitAtLeastOnce ||
      this.#threadStatuses.get(threadId) === "active"
    ) {
      waitAtLeastOnce = false;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new Error(
          `Codex thread ${threadId} stayed busy for ${this.turnTimeoutMs}ms`,
        );
      }
      await new Promise<void>((resolvePromise) => {
        const waiters = this.#threadStatusWaiters.get(threadId) ?? new Set();
        this.#threadStatusWaiters.set(threadId, waiters);
        const finish = () => {
          clearTimeout(timer);
          waiters.delete(finish);
          if (waiters.size === 0) {
            this.#threadStatusWaiters.delete(threadId);
          }
          resolvePromise();
        };
        const timer = setTimeout(finish, Math.min(1_000, remainingMs));
        waiters.add(finish);
      });
    }
  }

  private notifyThreadStatusWaiters(threadId: string): void {
    for (const waiter of this.#threadStatusWaiters.get(threadId) ?? []) {
      waiter();
    }
  }

  private pruneUnownedTurnEvents(): void {
    for (const turnId of this.#completedTurns.keys()) {
      if (!this.#ownedTurns.has(turnId)) {
        this.#completedTurns.delete(turnId);
        this.#lastAgentMessage.delete(turnId);
      }
    }
  }

  private handleProcessTermination(
    child: ChildProcessWithoutNullStreams,
    error: Error,
  ): void {
    if (this.#process !== child) {
      return;
    }
    this.#process = undefined;
    this.failAll(error);
  }

  private handleSocketTermination(socket: WebSocket, error: Error): void {
    if (this.#socket !== socket) {
      return;
    }
    this.#socket = undefined;
    this.failAll(error);
  }

  private failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const [turnId, waiter] of this.#turnWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
      this.#lastAgentMessage.delete(turnId);
    }
    this.#turnWaiters.clear();
    this.#completedTurns.clear();
    this.#timedOutTurns.clear();
    this.#ownedTurns.clear();
    this.#threadStatuses.clear();
    for (const threadId of this.#threadStatusWaiters.keys()) {
      this.notifyThreadStatusWaiters(threadId);
    }
    this.#threadStatusWaiters.clear();
    this.#turnStartInFlight = false;
  }
}

function isThreadBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(active|busy)\b|in progress|already running|turn.*running/i.test(
    message,
  );
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export function parseCodexThreadList(value: unknown): CodexThreadSummary[] {
  const data = asObject(value).data;
  if (!Array.isArray(data)) {
    throw new Error("Codex app-server thread/list response did not include data");
  }

  return data.flatMap((candidate) => {
    const thread = asObject(candidate);
    if (typeof thread.id !== "string" || !thread.id) {
      return [];
    }
    const status = asObject(thread.status).type;
    return [
      {
        id: thread.id,
        ...(typeof thread.name === "string" && thread.name
          ? { name: thread.name }
          : {}),
        ...(typeof thread.preview === "string" && thread.preview
          ? { preview: thread.preview }
          : {}),
        ...(typeof thread.createdAt === "number"
          ? { createdAt: thread.createdAt }
          : {}),
        ...(typeof thread.updatedAt === "number"
          ? { updatedAt: thread.updatedAt }
          : {}),
        ...(typeof status === "string" ? { status } : {}),
      },
    ];
  });
}

function requiredNestedId(
  value: Record<string, unknown>,
  key: string,
): string {
  const nested = asObject(value[key]);
  if (typeof nested.id !== "string") {
    throw new Error(`Codex app-server response did not include ${key}.id`);
  }
  return nested.id;
}
