import { Redis as IORedis } from "ioredis";

/**
 * Minimal Redis surface used by AgentRoom. Production uses ioredis against a
 * real Redis; tests and zero-setup development fall back to an in-memory
 * implementation with the same semantics (bounded, expiring, atomic).
 */
export interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  /** Atomically increments and returns the new value. */
  increment(key: string, ttlMs: number): Promise<number>;
  del(key: string): Promise<void>;
  /**
   * Atomically publish to a channel. Subscribers on the same instance receive
   * the message through `onMessage` callbacks registered via `subscribe`.
   */
  publish(channel: string, message: string): Promise<void>;
  subscribe(
    channel: string,
    onMessage: (message: string) => void,
  ): Promise<() => Promise<void>>;
  close(): Promise<void>;
  healthCheck(): Promise<void>;
}

export function createKeyValueStore(
  redisUrl: string | undefined,
): KeyValueStore {
  return redisUrl ? new RedisKeyValueStore(redisUrl) : new MemoryKeyValueStore();
}

class RedisKeyValueStore implements KeyValueStore {
  readonly #redis: IORedis;

  constructor(redisUrl: string) {
    this.#redis = new IORedis(redisUrl, {
      maxRetriesPerRequest: 2,
      enableOfflineQueue: false,
    });
  }

  async get(key: string): Promise<string | undefined> {
    return (await this.#redis.get(key)) ?? undefined;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    if (ttlMs === undefined) {
      await this.#redis.set(key, value);
    } else {
      await this.#redis.set(key, value, "PX", ttlMs);
    }
  }

  async increment(key: string, ttlMs: number): Promise<number> {
    const result = await this.#redis.eval(
      `
      local current = redis.call("INCR", KEYS[1])
      if current == 1 then
        redis.call("PEXPIRE", KEYS[1], ARGV[1])
      end
      return current
      `,
      1,
      key,
      String(ttlMs),
    );
    return Number(result);
  }

  async del(key: string): Promise<void> {
    await this.#redis.del(key);
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.#redis.publish(channel, message);
  }

  async subscribe(
    channel: string,
    onMessage: (message: string) => void,
  ): Promise<() => Promise<void>> {
    const subscriber = this.#redis.duplicate();
    await subscriber.subscribe(channel);
    const listener = (receivedChannel: string, receivedMessage: string) => {
      if (receivedChannel === channel) {
        onMessage(receivedMessage);
      }
    };
    subscriber.on("message", listener);
    return async () => {
      subscriber.off("message", listener);
      await subscriber.unsubscribe(channel);
      subscriber.disconnect();
    };
  }

  async close(): Promise<void> {
    this.#redis.disconnect();
  }

  async healthCheck(): Promise<void> {
    await this.#redis.ping();
  }
}

interface MemoryEntry {
  value: string;
  expiresAtMs: number | undefined;
}

interface MemorySubscription {
  channel: string;
  onMessage: (message: string) => void;
}

export class MemoryKeyValueStore implements KeyValueStore {
  readonly #entries = new Map<string, MemoryEntry>();
  readonly #subscriptions = new Map<string, Set<MemorySubscription>>();

  async get(key: string): Promise<string | undefined> {
    this.#expire();
    const entry = this.#entries.get(key);
    if (!entry || this.#isExpired(entry)) {
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs?: number): Promise<void> {
    this.#expire();
    this.#entries.set(key, {
      value,
      expiresAtMs: ttlMs === undefined ? undefined : Date.now() + ttlMs,
    });
  }

  async increment(key: string, ttlMs: number): Promise<number> {
    this.#expire();
    const entry = this.#entries.get(key);
    const now = Date.now();
    if (!entry || this.#isExpired(entry)) {
      this.#entries.set(key, {
        value: "1",
        expiresAtMs: now + ttlMs,
      });
      return 1;
    }
    const next = Number.parseInt(entry.value, 10) + 1;
    entry.value = String(next);
    return next;
  }

  async del(key: string): Promise<void> {
    this.#entries.delete(key);
  }

  async publish(channel: string, message: string): Promise<void> {
    for (const subscription of this.#subscriptions.get(channel) ?? []) {
      subscription.onMessage(message);
    }
  }

  async subscribe(
    channel: string,
    onMessage: (message: string) => void,
  ): Promise<() => Promise<void>> {
    const subscription: MemorySubscription = { channel, onMessage };
    const subscriptions =
      this.#subscriptions.get(channel) ?? new Set<MemorySubscription>();
    subscriptions.add(subscription);
    this.#subscriptions.set(channel, subscriptions);
    return async () => {
      subscriptions.delete(subscription);
      if (subscriptions.size === 0) {
        this.#subscriptions.delete(channel);
      }
    };
  }

  async close(): Promise<void> {
    this.#entries.clear();
    this.#subscriptions.clear();
  }

  async healthCheck(): Promise<void> {
    // In-memory store is always available.
  }

  #expire(): void {
    const now = Date.now();
    for (const [key, entry] of this.#entries) {
      if (this.#isExpired(entry)) {
        this.#entries.delete(key);
      }
    }
  }

  #isExpired(entry: MemoryEntry): boolean {
    return entry.expiresAtMs !== undefined && entry.expiresAtMs <= Date.now();
  }
}
