import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
} from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { resolve } from "node:path";
import type {
  PendingAgentDelivery,
  RoomMessage,
} from "../protocol/rooms.js";

export type SessionCardProvider = "claude" | "codex";

export const sessionCardEvidenceStatuses = [
  "server_received",
  "dispatch_started",
  "host_delivered",
  "agent_acknowledged",
  "completed",
  "failed",
] as const;
export type SessionCardEvidenceStatus =
  (typeof sessionCardEvidenceStatuses)[number];

export interface SessionCard {
  schemaVersion: 1;
  provider: SessionCardProvider;
  delivery: {
    id: string;
    roomId: string;
    taskMessageId: string;
    targetMemberId: string;
    createdAt: string;
  };
  task: RoomMessage;
  storedAt: string;
}

interface SessionCardEvidence {
  schemaVersion: 1;
  deliveryId: string;
  status: SessionCardEvidenceStatus;
  recordedAt: string;
  detail?: string;
}

/**
 * Durable, provider-addressed local inbox for one bridge.
 *
 * PostgreSQL remains authoritative. These cards provide crash recovery and
 * honest local delivery evidence without putting member credentials on disk.
 */
export class SessionCardStore {
  readonly #baseRoot: string;
  readonly #providerRoot: string;
  readonly #root: string;

  constructor(
    root: string,
    private readonly provider: SessionCardProvider,
    private readonly roomId: string,
  ) {
    assertSafeIdentifier(roomId, "room ID");
    this.#baseRoot = resolve(root);
    this.#providerRoot = resolve(this.#baseRoot, provider);
    this.#root = resolve(this.#providerRoot, roomId);
  }

  async persist(pending: PendingAgentDelivery): Promise<string> {
    if (pending.delivery.roomId !== this.roomId || pending.task.roomId !== this.roomId) {
      throw new Error("Session card delivery belongs to another room");
    }
    if (pending.delivery.taskMessageId !== pending.task.id) {
      throw new Error("Session card delivery does not match its task message");
    }
    assertSafeIdentifier(pending.delivery.id, "delivery ID");
    const card = createCard(this.provider, pending);
    const path = this.cardPath(pending.delivery.id);
    await this.ensureDeliveryDirectory(pending.delivery.id);
    const created = await publishExclusive(path, `${JSON.stringify(card, null, 2)}\n`);
    if (!created) {
      const existing = await this.read(pending.delivery.id);
      if (!sameCard(existing, card)) {
        throw new Error(
          `Session card ${pending.delivery.id} conflicts with the stored task`,
        );
      }
    }
    return path;
  }

  async mark(
    deliveryId: string,
    status: SessionCardEvidenceStatus,
    detail?: string,
  ): Promise<void> {
    assertSafeIdentifier(deliveryId, "delivery ID");
    if (!sessionCardEvidenceStatuses.includes(status)) {
      throw new Error("Unknown session card evidence status");
    }
    await this.read(deliveryId);
    const evidence: SessionCardEvidence = {
      schemaVersion: 1,
      deliveryId,
      status,
      recordedAt: new Date().toISOString(),
      ...(detail ? { detail: truncate(detail, 2_000) } : {}),
    };
    await publishExclusive(
      resolve(this.deliveryDirectory(deliveryId), `${status}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`,
    );
  }

  async read(deliveryId: string): Promise<SessionCard> {
    await this.assertDeliveryDirectory(deliveryId);
    const value: unknown = JSON.parse(
      await readFile(this.cardPath(deliveryId), "utf8"),
    );
    if (!isSessionCard(value)) {
      throw new Error(`Session card ${deliveryId} is invalid`);
    }
    return value;
  }

  cardPath(deliveryId: string): string {
    return resolve(this.deliveryDirectory(deliveryId), "card.json");
  }

  evidencePath(
    deliveryId: string,
    status: SessionCardEvidenceStatus,
  ): string {
    return resolve(this.deliveryDirectory(deliveryId), `${status}.json`);
  }

  private deliveryDirectory(deliveryId: string): string {
    assertSafeIdentifier(deliveryId, "delivery ID");
    return resolve(this.#root, deliveryId);
  }

  private async ensureDeliveryDirectory(deliveryId: string): Promise<void> {
    const directory = this.deliveryDirectory(deliveryId);
    await ensurePrivateDirectory(this.#baseRoot, true);
    await ensurePrivateDirectory(this.#providerRoot);
    await ensurePrivateDirectory(this.#root);
    await ensurePrivateDirectory(directory);
  }

  private async assertDeliveryDirectory(deliveryId: string): Promise<void> {
    for (const path of [
      this.#baseRoot,
      this.#providerRoot,
      this.#root,
      this.deliveryDirectory(deliveryId),
    ]) {
      await assertPrivateDirectory(path);
    }
  }
}

function createCard(
  provider: SessionCardProvider,
  pending: PendingAgentDelivery,
): SessionCard {
  return {
    schemaVersion: 1,
    provider,
    delivery: {
      id: pending.delivery.id,
      roomId: pending.delivery.roomId,
      taskMessageId: pending.delivery.taskMessageId,
      targetMemberId: pending.delivery.targetMemberId,
      createdAt: pending.delivery.createdAt,
    },
    task: pending.task,
    storedAt: new Date().toISOString(),
  };
}

function sameCard(left: SessionCard, right: SessionCard): boolean {
  return isDeepStrictEqual(
    {
      schemaVersion: left.schemaVersion,
      provider: left.provider,
      delivery: left.delivery,
      task: left.task,
    },
    {
      schemaVersion: right.schemaVersion,
      provider: right.provider,
      delivery: right.delivery,
      task: right.task,
    },
  );
}

async function publishExclusive(path: string, content: string): Promise<boolean> {
  const temporaryPath = `${path}.tmp-${randomUUID()}`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } catch (error) {
    await handle.close();
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    await link(temporaryPath, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

async function ensurePrivateDirectory(
  path: string,
  recursive = false,
): Promise<void> {
  try {
    await mkdir(path, { recursive, mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
  await assertPrivateDirectory(path);
  await chmod(path, 0o700);
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`Session card path is not a private directory: ${path}`);
  }
}

function isSessionCard(value: unknown): value is SessionCard {
  if (!isObject(value) || !isObject(value.delivery)) {
    return false;
  }
  return (
    value.schemaVersion === 1 &&
    (value.provider === "claude" || value.provider === "codex") &&
    typeof value.storedAt === "string" &&
    typeof value.delivery.id === "string" &&
    typeof value.delivery.roomId === "string" &&
    typeof value.delivery.taskMessageId === "string" &&
    typeof value.delivery.targetMemberId === "string" &&
    typeof value.delivery.createdAt === "string" &&
    isObject(value.task) &&
    typeof value.task.id === "string" &&
    typeof value.task.roomId === "string"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(value)) {
    throw new Error(`${label} is not a safe AgentRoom identifier`);
  }
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}
