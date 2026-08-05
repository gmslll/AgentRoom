import type { PendingAgentDelivery } from "../modules/rooms/types.js";

export interface DeliveryApi {
  updateDelivery(
    deliveryId: string,
    status: "received" | "running" | "failed",
    error?: string,
  ): Promise<unknown>;
  replyToDelivery(deliveryId: string, text: string): Promise<unknown>;
}

export interface AgentTaskRunner {
  run(delivery: PendingAgentDelivery): Promise<string>;
}

export class DeliveryWorker {
  readonly #queuedIds = new Set<string>();
  #tail = Promise.resolve();

  constructor(
    private readonly api: DeliveryApi,
    private readonly runner: AgentTaskRunner,
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
      if (pending.delivery.status === "queued") {
        await this.api.updateDelivery(deliveryId, "received");
      }
      if (
        pending.delivery.status === "queued" ||
        pending.delivery.status === "received"
      ) {
        await this.api.updateDelivery(deliveryId, "running");
      }
      const reply = await this.runner.run(pending);
      const normalizedReply = reply.trim();
      if (!normalizedReply) {
        throw new Error("Agent completed without a final reply");
      }
      await this.api.replyToDelivery(
        deliveryId,
        truncate(normalizedReply, 8_000, "\n\n[AgentRoom: reply truncated]"),
      );
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
    }
  }
}

function truncate(value: string, maxLength: number, suffix: string): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - suffix.length)}${suffix}`;
}
