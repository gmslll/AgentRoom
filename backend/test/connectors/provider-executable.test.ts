import { describe, expect, it } from "vitest";
import {
  providerExecutableCandidates,
  resolveProviderExecutable,
} from "../../src/connectors/provider-executable.js";

describe("provider executable resolution", () => {
  it("falls back to the native Claude Windows install path", () => {
    const expected = "C:\\Users\\gms\\.local\\bin\\claude.exe";
    expect(
      providerExecutableCandidates(
        "claude",
        "Claude Code",
        "win32",
        { USERPROFILE: "C:\\Users\\gms" },
        [],
      ),
    ).toEqual(["claude", expected]);

    expect(
      resolveProviderExecutable("claude", "Claude Code", {
        platform: "win32",
        env: { USERPROFILE: "C:\\Users\\gms" },
        locateOnWindows: () => [],
        probe: (candidate) =>
          candidate === expected
            ? { status: 0 }
            : { status: null, error: new Error("spawnSync claude ENOENT") },
      }),
    ).toBe(expected);
  });

  it("gives Windows-specific recovery steps when Claude is absent", () => {
    expect(() =>
      resolveProviderExecutable("claude", "Claude Code", {
        platform: "win32",
        env: {},
        locateOnWindows: () => [],
        probe: () => ({
          status: null,
          error: new Error("spawnSync claude ENOENT"),
        }),
      }),
    ).toThrow(/where\.exe claude.*new PowerShell\/CMD.*--manual-start/);
  });
});
