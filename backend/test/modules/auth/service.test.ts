import { describe, expect, it } from "vitest";
import { InMemoryAuthRepository } from "../../../src/modules/auth/memory-repository.js";
import { AuthRateLimiter } from "../../../src/modules/auth/rate-limiter.js";
import { AuthService } from "../../../src/modules/auth/service.js";

describe("AuthService", () => {
  it("rejects expired sessions", async () => {
    let now = new Date("2026-08-05T00:00:00.000Z");
    const service = new AuthService(
      new InMemoryAuthRepository(),
      1_000,
      () => now,
    );
    const access = await service.register({
      email: "expiry@example.com",
      displayName: "Expiry",
      password: "correct horse battery staple",
    });
    await expect(service.authenticate(access.accessToken)).resolves.toMatchObject({
      id: access.user.id,
    });

    now = new Date("2026-08-05T00:00:01.000Z");
    await expect(service.authenticate(access.accessToken)).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_SESSION",
    });
  });
});

describe("AuthRateLimiter", () => {
  it("bounds attempts, resets successful keys, and reopens after the window", async () => {
    let now = 1_000;
    const limiter = new AuthRateLimiter(2, 100, 10, () => now);
    await limiter.consume("client");
    await limiter.consume("client");
    await expect(limiter.consume("client")).rejects.toMatchObject({
      statusCode: 429,
      code: "AUTH_RATE_LIMITED",
    });

    await limiter.reset("client");
    await expect(limiter.consume("client")).resolves.toBeUndefined();
    await limiter.consume("client");
    now = 1_100;
    await expect(limiter.consume("client")).resolves.toBeUndefined();
  });
});
