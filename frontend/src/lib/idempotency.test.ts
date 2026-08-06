import { describe, expect, it } from "vitest";
import { newIdempotencyKey } from "./idempotency";

describe("newIdempotencyKey", () => {
  it("generates a UUID v4-shaped key with the given prefix", () => {
    const key = newIdempotencyKey("task");
    expect(key).toMatch(
      /^task_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("generates unique keys across calls", () => {
    const keys = new Set(
      Array.from({ length: 100 }, () => newIdempotencyKey()),
    );
    expect(keys.size).toBe(100);
  });
});
