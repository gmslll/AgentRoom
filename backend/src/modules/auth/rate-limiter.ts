import { AppError } from "../../lib/errors.js";
import type { KeyValueStore } from "../../lib/redis.js";

export interface RateLimiter {
  consume(key: string): Promise<void>;
  reset(key: string): Promise<void>;
}

interface WindowState {
  attempts: number;
  resetsAt: number;
}

/** In-process sliding-window limiter for single-instance development and tests. */
export class AuthRateLimiter implements RateLimiter {
  readonly #windows = new Map<string, WindowState>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  async consume(key: string): Promise<void> {
    const now = this.now();
    const current = this.#windows.get(key);
    if (!current || current.resetsAt <= now) {
      this.#makeRoom();
      this.#windows.set(key, {
        attempts: 1,
        resetsAt: now + this.windowMs,
      });
      return;
    }
    if (current.attempts >= this.maxAttempts) {
      throw new AppError(
        429,
        "AUTH_RATE_LIMITED",
        "Too many authentication attempts; try again later",
      );
    }
    current.attempts += 1;
  }

  async reset(key: string): Promise<void> {
    this.#windows.delete(key);
  }

  #makeRoom(): void {
    if (this.#windows.size < this.maxEntries) {
      return;
    }
    const oldestKey = this.#windows.keys().next().value;
    if (oldestKey !== undefined) {
      this.#windows.delete(oldestKey);
    }
  }
}

/**
 * Shared sliding-window limiter backed by Redis, so multiple API instances
 * enforce the same attempt budget. Falls back gracefully to the in-process
 * limiter when Redis is unavailable.
 */
export class RedisAuthRateLimiter implements RateLimiter {
  readonly #fallback: AuthRateLimiter;

  constructor(
    private readonly store: KeyValueStore,
    private readonly maxAttempts: number,
    private readonly windowMs: number,
    fallbackNow: () => number = Date.now,
  ) {
    this.#fallback = new AuthRateLimiter(
      maxAttempts,
      windowMs,
      10_000,
      fallbackNow,
    );
  }

  async consume(key: string): Promise<void> {
    try {
      const attempts = await this.store.increment(
        `auth:limit:${key}`,
        this.windowMs,
      );
      if (attempts > this.maxAttempts) {
        throw new AppError(
          429,
          "AUTH_RATE_LIMITED",
          "Too many authentication attempts; try again later",
        );
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      // Redis unavailable: degrade to the process-local limiter.
      await this.#fallback.consume(key);
    }
  }

  async reset(key: string): Promise<void> {
    try {
      await this.store.del(`auth:limit:${key}`);
    } catch {
      await this.#fallback.reset(key);
    }
  }
}
