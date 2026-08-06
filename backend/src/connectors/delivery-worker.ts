import type { PendingAgentDelivery } from "../protocol/rooms.js";
import type { SessionCardEvidenceStatus } from "./session-cards.js";

export interface DeliveryApi {
  updateDelivery(
    deliveryId: string,
    status: "received" | "running" | "failed",
    error?: string,
  ): Promise<unknown>;
  replyToDelivery(deliveryId: string, text: string): Promise<unknown>;
}

export interface AgentTaskRunner {
  run(
    delivery: PendingAgentDelivery,
    lifecycle?: AgentTaskLifecycle,
  ): Promise<string>;
}

export interface AgentTaskLifecycle {
  sessionCardPath?: string;
  acceptedByAgent(): Promise<void>;
}

export interface SessionCardJournal {
  persist(delivery: PendingAgentDelivery): Promise<string>;
  mark(
    deliveryId: string,
    status: SessionCardEvidenceStatus,
    detail?: string,
  ): Promise<void>;
}

export class DeliveryWorker {
  readonly #queuedIds = new Set<string>();
  #tail = Promise.resolve();

  constructor(
    private readonly api: DeliveryApi,
    private readonly runner: AgentTaskRunner,
    private readonly sessionCards?: SessionCardJournal,
  ) {}

  enqueue(delivery: PendingAgentDelivery): void {
    if (this.#queuedIds.has(delivery.delivery.id)) {
      return;
    }
    this.#queuedIds.add(delivery.delivery.id);
    this.#tail = this.#tail
      .then(() => this.process(delivery))
      .catch((error: unknown) => {
        console.error("AgentRoom delivery worker failed:", error);
      })
      .finally(() => this.#queuedIds.delete(delivery.delivery.id));
  }

  async idle(): Promise<void> {
    await this.#tail;
  }

  private async process(pending: PendingAgentDelivery): Promise<void> {
    const deliveryId = pending.delivery.id;
    try {
      const sessionCardPath = await this.sessionCards?.persist(pending);
      if (pending.delivery.status === "queued") {
        await this.api.updateDelivery(deliveryId, "received");
      }
      await this.markCard(deliveryId, "server_received");
      if (
        pending.delivery.status === "queued" ||
        pending.delivery.status === "received"
      ) {
        await this.api.updateDelivery(deliveryId, "running");
      }
      await this.markCard(deliveryId, "dispatch_started");
      const reply = await this.runner.run(pending, {
        ...(sessionCardPath ? { sessionCardPath } : {}),
        acceptedByAgent: async () => {
          await this.markCard(deliveryId, "host_delivered");
          await this.markCard(deliveryId, "agent_acknowledged");
        },
      });
      const normalizedReply = reply.trim();
      if (!normalizedReply) {
        throw new Error("Agent completed without a final reply");
      }
      await this.api.replyToDelivery(
        deliveryId,
        truncate(normalizedReply, 8_000, "\n\n[AgentRoom: reply truncated]"),
      );
      await this.markCard(deliveryId, "completed");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try {
        await this.api.updateDelivery(
          deliveryId,
          "failed",
          truncate(message || "Unknown agent failure", 2_000, "…"),
        );
      } catch (statusError) {
        console.error("Could not mark AgentRoom delivery as failed:", statusError);
      }
      await this.markCard(
        deliveryId,
        "failed",
        message || "Unknown agent failure",
      );
    }
  }

  private async markCard(
    deliveryId: string,
    status: SessionCardEvidenceStatus,
    detail?: string,
  ): Promise<void> {
    if (!this.sessionCards) {
      return;
    }
    try {
      await this.sessionCards.mark(deliveryId, status, detail);
    } catch (error) {
      console.error(
        `Could not record local session-card evidence ${status} for ${deliveryId}:`,
        error,
      );
    }
  }
}

function truncate(value: string, maxLength: number, suffix: string): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - suffix.length)}${suffix}`;
}
