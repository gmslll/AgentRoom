import { describe, expect, it } from "vitest";
import { loadConfig, normalizePublicBaseUrl } from "../src/config.js";

describe("backend configuration", () => {
  it("derives the default public URL from the listening port", () => {
    expect(loadConfig({ PORT: "9000" }).publicBaseUrl).toBe(
      "http://127.0.0.1:9000",
    );
  });

  it("normalizes a configured public URL", () => {
    expect(normalizePublicBaseUrl("https://api.example.com/agentroom/")).toBe(
      "https://api.example.com/agentroom",
    );
  });

  it.each([
    "ftp://example.com",
    "https://user:password@example.com",
    "https://example.com/?token=secret",
    "https://example.com/#fragment",
    "https://example.com/$(unsafe)",
    "https://example.com/%PATH%",
  ])("rejects an unsafe public URL: %s", (value) => {
    expect(() => normalizePublicBaseUrl(value)).toThrow();
  });
});
