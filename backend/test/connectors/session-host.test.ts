import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  codexSessionEndpoint,
  codexSessionHostLockPath,
} from "../../src/connectors/codex/session-host.js";

describe("Codex session host", () => {
  it("uses a deterministic short socket outside the workspace", () => {
    const first = codexSessionEndpoint(
      "/a/very/long/workspace/path/.agentroom/codex-room-member.json",
      "darwin",
    );
    const second = codexSessionEndpoint(
      "/a/very/long/workspace/path/.agentroom/codex-room-member.json",
      "linux",
    );
    const other = codexSessionEndpoint(
      "/a/very/long/workspace/path/.agentroom/codex-other-member.json",
      "darwin",
    );

    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(
      first.startsWith(`unix://${resolve(tmpdir(), "agentroom-codex")}`),
    ).toBe(true);
    expect(first.endsWith(".sock")).toBe(true);
    expect(Buffer.byteLength(first.slice("unix://".length))).toBeLessThan(104);
    expect(
      codexSessionHostLockPath(
        "/a/very/long/workspace/path/.agentroom/codex-room-member.json",
      ),
    ).toContain(resolve(tmpdir(), "agentroom-codex"));
  });

  it("uses a deterministic loopback WebSocket endpoint on Windows", () => {
    const endpoint = codexSessionEndpoint(
      "C:\\work\\.agentroom\\codex.json",
      "win32",
    );
    expect(endpoint).toMatch(/^ws:\/\/127\.0\.0\.1:[4-5][0-9]{4}$/);
  });
});
