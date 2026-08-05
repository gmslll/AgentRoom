import type { EventBus } from "./event-bus.js";
import type { RealtimeServerEvent } from "../rooms/types.js";
import type { RoomRepository } from "../rooms/repository.js";

/**
 * Drains the transactional outbox: events persisted by the PostgreSQL
 * repository are published to the event bus (local + Redis fan-out) and then
 * marked as published. Runs only when the repository supports the outbox
 * (PostgreSQL mode); in-memory development publishes directly.
 */
export class OutboxPublisher {
  #timer: NodeJS.Timeout | undefined;
  #purgeTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly repository: RoomRepository,
    private readonly eventBus: EventBus,
    private readonly intervalMs = 500,
    private readonly batchSize = 100,
    private readonly retentionMs = 7 * 24 * 60 * 60 * 1_000,
    private readonly purgeIntervalMs = 60 * 60 * 1_000,
    private readonly log: (line: string) => void = (line) =>
      console.error(`[outbox] ${line}`),
  ) {}

  start(): void {
    if (this.#timer) {
      return;
    }
    this.#timer = setInterval(() => {
      void this.drain().catch((error) => {
        this.log(`drain failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, this.intervalMs);
    this.#timer.unref?.();

    if (this.repository.purgeOutbox) {
      void this.purge();
      this.#purgeTimer = setInterval(() => {
        void this.purge().catch((error) => {
          this.log(`purge failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }, this.purgeIntervalMs);
      this.#purgeTimer.unref?.();
    }
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    if (this.#purgeTimer) {
      clearInterval(this.#purgeTimer);
      this.#purgeTimer = undefined;
    }
  }

  /** Deletes published entries beyond the retention window. Exposed for tests. */
  async purge(): Promise<number> {
    if (!this.repository.purgeOutbox) {
      return 0;
    }
    const olderThan = new Date(Date.now() - this.retentionMs).toISOString();
    return this.repository.purgeOutbox(olderThan);
  }

  /** Publishes any pending outbox events. Exposed for tests and one-shot drains. */
  async drain(): Promise<void> {
    if (!this.repository.listPendingOutbox) {
      return;
    }
    const pending = await this.repository.listPendingOutbox(this.batchSize);
    if (pending.length === 0) {
      return;
    }
    const failedIds: number[] = [];
    for (const entry of pending) {
      const { event, audienceMemberIds } = parseOutboxPayload(entry.payload);
      if (this.eventBus.publishAndReport) {
        const delivered = await this.eventBus.publishAndReport(
          event,
          audienceMemberIds,
        );
        if (!delivered) {
          failedIds.push(entry.id);
        }
      } else {
        this.eventBus.publish(event, audienceMemberIds);
      }
    }
    // Fan-out failures (e.g. Redis unavailable) re-queue the entries so a
    // later drain retries them; the claim was atomic, so nothing is lost.
    if (failedIds.length > 0) {
      await this.repository.releaseOutbox?.(failedIds);
    }
  }
}

interface OutboxEnvelope {
  event: RealtimeServerEvent;
  audienceMemberIds?: string[];
}

function parseOutboxPayload(payload: unknown): OutboxEnvelope {
  if (typeof payload === "object" && payload !== null && "event" in payload) {
    return payload as OutboxEnvelope;
  }
  // Legacy entries written before the audience envelope: treat as a bare event.
  return { event: payload as RealtimeServerEvent };
}
