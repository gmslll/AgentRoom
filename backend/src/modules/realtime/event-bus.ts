import { randomUUID } from "node:crypto";
import type { KeyValueStore } from "../../lib/redis.js";
import type { RealtimeServerEvent } from "../rooms/types.js";

type RoomEventListener = (event: RealtimeServerEvent) => void;

interface Subscription {
  memberId: string;
  listener: RoomEventListener;
}

export interface EventBus {
  publish(event: RealtimeServerEvent, audienceMemberIds?: string[]): void;
  subscribe(
    roomId: string,
    memberId: string,
    listener: RoomEventListener,
  ): () => void;
  /**
   * Publishes and reports whether the cross-instance fan-out succeeded.
   * Local delivery always happens; the return value tells the outbox drainer
   * whether it may mark the event as delivered.
   */
  publishAndReport?(
    event: RealtimeServerEvent,
    audienceMemberIds?: string[],
  ): Promise<boolean>;
}

export class InMemoryEventBus implements EventBus {
  readonly #listeners = new Map<string, Set<Subscription>>();

  constructor(
    private readonly onListenerError: (
      error: unknown,
      event: RealtimeServerEvent,
    ) => void = (error, event) => {
      console.error(`AgentRoom realtime listener failed for ${event.eventId}:`, error);
    },
  ) {}

  publish(event: RealtimeServerEvent, audienceMemberIds?: string[]): void {
    for (const subscription of this.#listeners.get(event.roomId) ?? []) {
      if (
        !audienceMemberIds ||
        audienceMemberIds.includes(subscription.memberId)
      ) {
        try {
          subscription.listener(event);
        } catch (error) {
          this.onListenerError(error, event);
        }
      }
    }
  }

  subscribe(
    roomId: string,
    memberId: string,
    listener: RoomEventListener,
  ): () => void {
    const listeners = this.#listeners.get(roomId) ?? new Set<Subscription>();
    const subscription = { memberId, listener };
    listeners.add(subscription);
    this.#listeners.set(roomId, listeners);

    return () => {
      listeners.delete(subscription);
      if (listeners.size === 0) {
        this.#listeners.delete(roomId);
      }
    };
  }
}

function roomChannel(roomId: string): string {
  return `agentroom:room:${roomId}`;
}

/**
 * Event bus that fans out through Redis pub/sub so multiple API instances
 * deliver the same room events. Local WebSocket subscribers still receive
 * events synchronously; the Redis channel carries events to other instances,
 * which forward them only to their own local subscribers (no echo loop).
 */
export class RedisEventBus implements EventBus {
  readonly #local = new InMemoryEventBus();
  readonly #channelSubscriptions = new Map<string, ChannelSubscription>();
  readonly #instanceId: string;

  constructor(private readonly store: KeyValueStore) {
    this.#instanceId = createInstanceId();
  }

  publish(event: RealtimeServerEvent, audienceMemberIds?: string[]): void {
    void this.publishAndReport(event, audienceMemberIds);
  }

  async publishAndReport(
    event: RealtimeServerEvent,
    audienceMemberIds?: string[],
  ): Promise<boolean> {
    this.#local.publish(event, audienceMemberIds);
    try {
      await this.store.publish(
        roomChannel(event.roomId),
        JSON.stringify({
          instanceId: this.#instanceId,
          event,
          audienceMemberIds,
        }),
      );
      return true;
    } catch (error) {
      console.error(
        `AgentRoom realtime publish failed for ${event.eventId}:`,
        error,
      );
      return false;
    }
  }

  subscribe(
    roomId: string,
    memberId: string,
    listener: RoomEventListener,
  ): () => void {
    const unsubscribeLocal = this.#local.subscribe(roomId, memberId, listener);
    const channel = roomChannel(roomId);
    let channelSubscription = this.#channelSubscriptions.get(channel);
    if (!channelSubscription) {
      channelSubscription = new ChannelSubscription(
        this.store,
        channel,
        this.#local,
        this.#instanceId,
      );
      this.#channelSubscriptions.set(channel, channelSubscription);
    }
    channelSubscription.refCount += 1;

    return () => {
      unsubscribeLocal();
      channelSubscription.refCount -= 1;
      if (channelSubscription.refCount <= 0) {
        this.#channelSubscriptions.delete(channel);
        void channelSubscription.close();
      }
    };
  }
}

class ChannelSubscription {
  refCount = 0;
  #unsubscribe: (() => Promise<void>) | undefined;
  #closed = false;
  #retryTimer: NodeJS.Timeout | undefined;
  #retryDelayMs = 500;
  readonly #maxRetryDelayMs = 30_000;

  constructor(
    private readonly store: KeyValueStore,
    private readonly channel: string,
    private readonly local: InMemoryEventBus,
    private readonly ownerInstanceId: string,
  ) {
    void this.#connect();
  }

  async #connect(): Promise<void> {
    if (this.#closed) {
      return;
    }
    try {
      const unsubscribe = await this.store.subscribe(this.channel, (raw) =>
        this.#onMessage(raw),
      );
      if (this.#closed) {
        void unsubscribe();
        return;
      }
      this.#unsubscribe = unsubscribe;
      this.#retryDelayMs = 500;
    } catch (error) {
      // A transient Redis failure must not permanently cut cross-instance
      // events: retry with backoff until the channel subscription lands.
      console.error(
        `AgentRoom realtime subscribe failed for ${this.channel}; ` +
          `retrying in ${this.#retryDelayMs}ms:`,
        error,
      );
      this.#retryTimer = setTimeout(() => {
        void this.#connect();
      }, this.#retryDelayMs);
      this.#retryTimer.unref?.();
      this.#retryDelayMs = Math.min(
        this.#retryDelayMs * 2,
        this.#maxRetryDelayMs,
      );
    }
  }

  #onMessage(raw: string): void {
    try {
      const parsed = JSON.parse(raw) as {
        instanceId?: string;
        event: RealtimeServerEvent;
        audienceMemberIds?: string[];
      };
      // The publishing instance already delivered the event to its local
      // subscribers synchronously; skip the echoed channel message.
      if (parsed.instanceId === this.ownerInstanceId) {
        return;
      }
      this.local.publish(parsed.event, parsed.audienceMemberIds);
    } catch {
      // Ignore malformed cross-instance messages.
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
    if (this.#retryTimer) {
      clearTimeout(this.#retryTimer);
      this.#retryTimer = undefined;
    }
    await this.#unsubscribe?.();
  }
}

function createInstanceId(): string {
  return randomUUID();
}
