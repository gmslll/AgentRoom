import { readFile, rename, unlink, writeFile } from "node:fs/promises";

export type ReceiverRealtimeStatus =
  | "starting"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "revoked"
  | "stopped";

export interface ReceiverRuntimeStatus {
  version: 1;
  pid: number;
  roomId: string;
  memberId?: string;
  state: ReceiverRealtimeStatus;
  updatedAt: string;
  lastConnectedAt?: string;
  lastError?: string;
}

/**
 * Writes a token-free sidecar next to a private bridge config. Other Codex MCP
 * processes can read it to distinguish a live child process from a connected
 * realtime receiver. Writes are serialized and atomically renamed.
 */
export class ReceiverStatusReporter {
  #current: ReceiverRuntimeStatus;
  #writing = Promise.resolve();

  constructor(
    private readonly path: string,
    identity: { roomId: string; memberId?: string },
    pid = process.pid,
  ) {
    this.#current = {
      version: 1,
      pid,
      roomId: identity.roomId,
      ...(identity.memberId ? { memberId: identity.memberId } : {}),
      state: "starting",
      updatedAt: new Date().toISOString(),
    };
  }

  report(state: ReceiverRealtimeStatus, error?: unknown): Promise<void> {
    const now = new Date().toISOString();
    const lastError = error === undefined ? undefined : safeError(error);
    const current: ReceiverRuntimeStatus = {
      ...this.#current,
      state,
      updatedAt: now,
    };
    if (state === "connected") {
      current.lastConnectedAt = now;
      delete current.lastError;
    }
    if (lastError) {
      current.lastError = lastError;
    }
    this.#current = current;
    const snapshot = JSON.stringify(this.#current, null, 2);
    const write = async () => {
      const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(temporaryPath, `${snapshot}\n`, {
          encoding: "utf8",
          mode: 0o600,
          flag: "wx",
        });
        await rename(temporaryPath, this.path);
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
    };
    this.#writing = this.#writing.catch(() => undefined).then(write);
    return this.#writing;
  }
}

export async function readReceiverRuntimeStatus(
  path: string,
): Promise<ReceiverRuntimeStatus | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return parseReceiverRuntimeStatus(value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    return undefined;
  }
}

export function receiverStatusPath(configPath: string): string {
  return `${configPath}.status`;
}

function parseReceiverRuntimeStatus(
  value: unknown,
): ReceiverRuntimeStatus | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !Number.isSafeInteger(record.pid) ||
    (record.pid as number) <= 0 ||
    typeof record.roomId !== "string" ||
    typeof record.updatedAt !== "string" ||
    !isRealtimeStatus(record.state)
  ) {
    return undefined;
  }
  return {
    version: 1,
    pid: record.pid as number,
    roomId: record.roomId,
    ...(typeof record.memberId === "string"
      ? { memberId: record.memberId }
      : {}),
    state: record.state,
    updatedAt: record.updatedAt,
    ...(typeof record.lastConnectedAt === "string"
      ? { lastConnectedAt: record.lastConnectedAt }
      : {}),
    ...(typeof record.lastError === "string"
      ? { lastError: record.lastError }
      : {}),
  };
}

function isRealtimeStatus(value: unknown): value is ReceiverRealtimeStatus {
  return (
    value === "starting" ||
    value === "connecting" ||
    value === "connected" ||
    value === "reconnecting" ||
    value === "revoked" ||
    value === "stopped"
  );
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replaceAll(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replaceAll(/\b(?:ari|ars|art)_[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .slice(0, 1_000);
}
