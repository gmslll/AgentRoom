import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  parseStoredConfig,
  type StoredBridgeConfig,
} from "../bridge-config.js";
import type { CommandInvocation } from "../session-attach.js";

export type ReceiverStatus =
  | "starting"
  | "running"
  | "already-running"
  | "failed";

export interface CodexReceiverStatus {
  configPath: string;
  roomId: string;
  memberId?: string;
  workspace: string;
  status: ReceiverStatus;
  pid?: number;
  error?: string;
}

interface ManagedReceiver {
  config: StoredBridgeConfig;
  configPath: string;
  status: ReceiverStatus;
  child?: ChildProcess;
  pid?: number;
  error?: string;
  retryAfter?: number;
}

interface CodexMcpSupervisorOptions {
  workspace: string;
  cli: CommandInvocation;
  scanIntervalMs?: number;
  retryDelayMs?: number;
}

/**
 * Starts one `agentroom run` child for every Codex bridge config in the current
 * workspace. A process lock in the child remains authoritative, so two Codex
 * sessions opened in the same project cannot execute the same delivery twice.
 */
export class CodexMcpSupervisor {
  readonly #workspace: string;
  readonly #cli: CommandInvocation;
  readonly #scanIntervalMs: number;
  readonly #retryDelayMs: number;
  readonly #receivers = new Map<string, ManagedReceiver>();
  #scanTimer: NodeJS.Timeout | undefined;
  #scanning: Promise<void> | undefined;
  #closed = false;

  constructor(options: CodexMcpSupervisorOptions) {
    this.#workspace = resolve(options.workspace);
    this.#cli = options.cli;
    this.#scanIntervalMs = options.scanIntervalMs ?? 5_000;
    this.#retryDelayMs = options.retryDelayMs ?? 15_000;
  }

  async start(): Promise<void> {
    if (this.#closed) {
      throw new Error("The AgentRoom MCP supervisor is closed");
    }
    await this.scan();
    if (!this.#scanTimer) {
      this.#scanTimer = setInterval(() => {
        void this.scan().catch((error: unknown) => {
          console.error("AgentRoom MCP workspace scan failed:", error);
        });
      }, this.#scanIntervalMs);
    }
  }

  scan(): Promise<void> {
    if (this.#closed) {
      return Promise.resolve();
    }
    if (!this.#scanning) {
      const current = this.#scanWorkspace();
      this.#scanning = current;
      const clear = () => {
        if (this.#scanning === current) {
          this.#scanning = undefined;
        }
      };
      void current.then(clear, clear);
    }
    return this.#scanning;
  }

  statuses(): CodexReceiverStatus[] {
    return [...this.#receivers.values()]
      .map((receiver) => ({
        configPath: receiver.configPath,
        roomId: receiver.config.roomId,
        ...(receiver.config.memberId
          ? { memberId: receiver.config.memberId }
          : {}),
        workspace: receiver.config.workspace,
        status: receiver.status,
        ...(receiver.pid ? { pid: receiver.pid } : {}),
        ...(receiver.error ? { error: receiver.error } : {}),
      }))
      .sort((left, right) => left.configPath.localeCompare(right.configPath));
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    if (this.#scanTimer) {
      clearInterval(this.#scanTimer);
      this.#scanTimer = undefined;
    }
    await this.#scanning?.catch(() => undefined);

    const children = [...this.#receivers.values()]
      .map((receiver) => receiver.child)
      .filter((child): child is ChildProcess => Boolean(child));
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
    }
    await Promise.all(children.map((child) => waitForExit(child, 5_000)));
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
    this.#receivers.clear();
  }

  async #scanWorkspace(): Promise<void> {
    const discovered = await discoverCodexBridgeConfigs(this.#workspace);
    const discoveredPaths = new Set(discovered.map((item) => item.configPath));

    for (const [configPath, receiver] of this.#receivers) {
      if (!discoveredPaths.has(configPath)) {
        if (
          receiver.child &&
          receiver.child.exitCode === null &&
          receiver.child.signalCode === null
        ) {
          receiver.child.kill("SIGTERM");
        }
        this.#receivers.delete(configPath);
      }
    }

    for (const discoveredConfig of discovered) {
      const existing = this.#receivers.get(discoveredConfig.configPath);
      if (
        existing?.child &&
        existing.child.exitCode === null &&
        existing.child.signalCode === null
      ) {
        continue;
      }
      if (existing?.retryAfter && existing.retryAfter > Date.now()) {
        continue;
      }

      const lockOwner = await activeLockOwner(
        `${discoveredConfig.configPath}.lock`,
      );
      if (lockOwner) {
        this.#receivers.set(discoveredConfig.configPath, {
          ...discoveredConfig,
          status: "already-running",
          pid: lockOwner,
        });
        continue;
      }

      this.#launch(discoveredConfig);
    }
  }

  #launch(discovered: DiscoveredCodexBridgeConfig): void {
    const child = spawn(
      this.#cli.command,
      [
        ...this.#cli.args,
        "run",
        "--config",
        discovered.configPath,
      ],
      {
        cwd: this.#workspace,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    const receiver: ManagedReceiver = {
      ...discovered,
      child,
      status: "starting",
      ...(child.pid ? { pid: child.pid } : {}),
    };
    this.#receivers.set(discovered.configPath, receiver);

    let recentError = "";
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      recentError = `${recentError}${text}`.slice(-4_000);
      process.stderr.write(
        `[AgentRoom ${discovered.config.roomId}] ${text}`,
      );
    });
    child.once("spawn", () => {
      receiver.status = "running";
      if (child.pid) {
        receiver.pid = child.pid;
      }
    });
    child.once("error", (error) => {
      receiver.status = "failed";
      receiver.error = error.message;
      receiver.retryAfter = Date.now() + this.#retryDelayMs;
    });
    child.once("exit", (code, signal) => {
      delete receiver.child;
      delete receiver.pid;
      if (this.#closed || signal === "SIGTERM" || signal === "SIGKILL") {
        return;
      }
      receiver.status = "failed";
      receiver.error =
        recentError.trim() ||
        `AgentRoom bridge exited (${signal ?? `code ${code ?? "unknown"}`})`;
      receiver.retryAfter = Date.now() + this.#retryDelayMs;
    });
  }
}

export interface DiscoveredCodexBridgeConfig {
  config: StoredBridgeConfig;
  configPath: string;
}

export async function discoverCodexBridgeConfigs(
  workspace: string,
): Promise<DiscoveredCodexBridgeConfig[]> {
  const resolvedWorkspace = resolve(workspace);
  const configDirectory = join(resolvedWorkspace, ".agentroom");
  const entries = await readdir(configDirectory, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return [];
      }
      throw error;
    },
  );
  const configs: DiscoveredCodexBridgeConfig[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    const configPath = join(configDirectory, entry.name);
    try {
      const config = parseStoredConfig(
        JSON.parse(await readFile(configPath, "utf8")) as unknown,
      );
      if (
        config.provider === "codex" &&
        resolve(config.workspace) === resolvedWorkspace
      ) {
        configs.push({ config, configPath });
      }
    } catch {
      // The private directory also contains Codex state and session-card JSON.
      // Only complete bridge configs are relevant to workspace discovery.
    }
  }

  return configs.sort((left, right) =>
    left.configPath.localeCompare(right.configPath),
  );
}

async function activeLockOwner(path: string): Promise<number | undefined> {
  try {
    const owner = Number.parseInt(await readFile(path, "utf8"), 10);
    if (!Number.isSafeInteger(owner) || owner <= 0) {
      return undefined;
    }
    try {
      process.kill(owner, 0);
      return owner;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM"
        ? owner
        : undefined;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolvePromise) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.off("exit", finish);
      resolvePromise();
    };
    const timer = setTimeout(finish, timeoutMs);
    child.once("exit", finish);
  });
}
