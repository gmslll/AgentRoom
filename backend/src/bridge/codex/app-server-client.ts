import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

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
  #starting: Promise<void> | undefined;

  constructor(
    private readonly command: string,
    private readonly workspace: string,
    private readonly requestTimeoutMs = 30_000,
    private readonly turnTimeoutMs = 30 * 60_000,
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
    return Boolean(this.#process?.stdin.writable && !this.#process.killed);
  }

  private async startProcess(): Promise<void> {
    const child = spawn(this.command, ["app-server"], {
      cwd: this.workspace,
      stdio: ["pipe", "pipe", "pipe"],
    });
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
      this.handleTermination(child, error);
    });
    child.once("exit", (code, signal) => {
      this.handleTermination(
        child,
        new Error(
          `Codex app-server exited (${signal ?? `code ${code ?? "unknown"}`})`,
        ),
      );
    });

    try {
      await this.request("initialize", {
        clientInfo: {
          name: "agentroom_bridge",
          title: "AgentRoom Bridge",
          version: "0.1.0",
        },
      });
      this.notify("initialized", {});
    } catch (error) {
      child.kill("SIGTERM");
      this.handleTermination(
        child,
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    }
  }

  async startOrResumeThread(threadId?: string): Promise<string> {
    if (threadId) {
      try {
        return await this.resumeThread(threadId);
      } catch (error) {
        if (!this.isRunning()) {
          throw error;
        }
        console.error(`Could not resume Codex thread ${threadId}:`, error);
      }
    }

    const result = asObject(
      await this.request("thread/start", { cwd: this.workspace }),
    );
    return requiredNestedId(result, "thread");
  }

  async resumeThread(threadId: string): Promise<string> {
    const result = asObject(
      await this.request("thread/resume", { threadId }),
    );
    return requiredNestedId(result, "thread");
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

  async runTurn(threadId: string, prompt: string): Promise<string> {
    const result = asObject(
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
    const turnId = requiredNestedId(result, "turn");
    const completed = this.#completedTurns.get(turnId);
    if (completed) {
      this.#completedTurns.delete(turnId);
      return this.finishTurn(turnId, completed);
    }

    return new Promise<string>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.#turnWaiters.delete(turnId);
        this.#lastAgentMessage.delete(turnId);
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
      }, this.turnTimeoutMs);
      this.#turnWaiters.set(turnId, {
        resolve: resolvePromise,
        reject,
        timer,
      });
    });
  }

  close(): void {
    const child = this.#process;
    if (!child) {
      return;
    }
    child.kill("SIGTERM");
    this.handleTermination(child, new Error("Codex app-server closed"));
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
    if (!this.#process?.stdin.writable) {
      throw new Error("Codex app-server is not running");
    }
    this.#process.stdin.write(`${JSON.stringify(message)}\n`);
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

    if (message.method === "item/completed") {
      const params = asObject(message.params);
      const item = asObject(params.item);
      if (item.type === "agentMessage" && typeof item.text === "string") {
        const turnId = typeof params.turnId === "string" ? params.turnId : undefined;
        if (turnId && !this.#timedOutTurns.has(turnId) && item.text.trim()) {
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
      if (this.#timedOutTurns.delete(turnId)) {
        this.#lastAgentMessage.delete(turnId);
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
    if (completed.status !== "completed") {
      throw new Error(
        completed.error ?? `Codex turn ended with status ${completed.status}`,
      );
    }
    return message;
  }

  private handleTermination(
    child: ChildProcessWithoutNullStreams,
    error: Error,
  ): void {
    if (this.#process !== child) {
      return;
    }
    this.#process = undefined;
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
  }
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
