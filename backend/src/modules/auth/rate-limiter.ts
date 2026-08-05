import { AppError } from "../../lib/errors.js";

interface WindowState {
  attempts: number;
  resetsAt: number;
}

export class AuthRateLimiter {
  readonly #windows = new Map<string, WindowState>();

  constructor(
    private readonly maxAttempts: number,
    private readonly windowMs: number,
    private readonly maxEntries = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  consume(key: string): void {
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

  reset(key: string): void {
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
