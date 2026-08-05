import { describe, expect, it } from "vitest";
import { MemoryKeyValueStore } from "../../../src/lib/redis.js";
import { RedisAuthRateLimiter } from "../../../src/modules/auth/rate-limiter.js";

describe("RedisAuthRateLimiter", () => {
  it("enforces a shared attempt budget and resets successful keys", async () => {
    const store = new MemoryKeyValueStore();
    const limiter = new RedisAuthRateLimiter(store, 2, 60_000);

    await limiter.consume("client:1");
    await limiter.consume("client:1");
    await expect(limiter.consume("client:1")).rejects.toMatchObject({
      statusCode: 429,
      code: "AUTH_RATE_LIMITED",
    });

    await limiter.reset("client:1");
    await expect(limiter.consume("client:1")).resolves.toBeUndefined();
  });

  it("shares the budget between two limiter instances over one store", async () => {
    const store = new MemoryKeyValueStore();
    const limiterA = new RedisAuthRateLimiter(store, 2, 60_000);
    const limiterB = new RedisAuthRateLimiter(store, 2, 60_000);

    await limiterA.consume("shared");
    await limiterB.consume("shared");
    await expect(limiterA.consume("shared")).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it("keeps separate keys separate", async () => {
    const store = new MemoryKeyValueStore();
    const limiter = new RedisAuthRateLimiter(store, 1, 60_000);
    await limiter.consume("a");
    await expect(limiter.consume("b")).resolves.toBeUndefined();
  });
});
