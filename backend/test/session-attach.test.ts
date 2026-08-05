import { describe, expect, it } from "vitest";
import { parseCodexThreadList } from "../src/bridge/codex/app-server-client.js";
import {
  assertCodexThreadAttachable,
  claudeMcpAddArgs,
  claudeResumeArgs,
  claudeServerName,
  codexStatePath,
  commandLine,
  formatCodexThread,
  resolveCodexThread,
} from "../src/bridge/session-attach.js";

const threads = [
  {
    id: "thread_latest",
    name: "Backend room",
    preview: "Continue backend work",
    updatedAt: 1_754_352_000,
    status: "notLoaded",
  },
  {
    id: "thread_older",
    name: "Frontend room",
    status: "notLoaded",
  },
];

describe("session attachment", () => {
  it("selects Codex threads by recency, number, ID, or exact name", () => {
    expect(resolveCodexThread(threads, "last").id).toBe("thread_latest");
    expect(resolveCodexThread(threads, "2").id).toBe("thread_older");
    expect(resolveCodexThread(threads, "thread_older").id).toBe(
      "thread_older",
    );
    expect(resolveCodexThread(threads, "Backend room").id).toBe(
      "thread_latest",
    );
  });

  it("passes an unlisted explicit thread ID through for strict server validation", () => {
    expect(resolveCodexThread([], "0198-session-id")).toEqual({
      id: "0198-session-id",
    });
  });

  it("rejects a thread that appears loaded or busy", () => {
    expect(() =>
      assertCodexThreadAttachable({ id: "thread_busy", status: "active" }),
    ).toThrow("finish its current turn and close it");
  });

  it("parses the app-server thread/list response defensively", () => {
    expect(
      parseCodexThreadList({
        data: [
          {
            id: "thread_1",
            name: "Existing work",
            preview: "Fix auth",
            createdAt: 10,
            updatedAt: 20,
            status: { type: "notLoaded" },
          },
          { malformed: true },
        ],
      }),
    ).toEqual([
      {
        id: "thread_1",
        name: "Existing work",
        preview: "Fix auth",
        createdAt: 10,
        updatedAt: 20,
        status: "notLoaded",
      },
    ]);
    expect(() => parseCodexThreadList({})).toThrow("did not include data");
  });

  it("uses member-scoped state files so Codex agents cannot share threads", () => {
    const first = codexStatePath(
      "/work/project",
      "room_example",
      "mem_first1234",
    );
    const second = codexStatePath(
      "/work/project",
      "room_example",
      "mem_second5678",
    );
    expect(first).not.toBe(second);
    expect(first).toContain(
      ".agentroom/codex-room_example-mem_first1234.json",
    );
  });

  it("removes terminal control characters from displayed thread metadata", () => {
    expect(
      formatCodexThread(
        {
          id: "thread_1\u001b[31m",
          name: "Safe\u001b]8;;https://example.com\u0007 title",
          status: "notLoaded\u001b[0m",
        },
        0,
      ),
    ).not.toContain("\u001b");
  });

  it("builds token-free Claude MCP and resume commands", () => {
    const serverName = claudeServerName(
      "room_1234567890",
      "mem_abcdefghij",
    );
    const configPath = "/work/project/.agentroom/claude.json";
    const mcpArgs = claudeMcpAddArgs(serverName, configPath);

    expect(mcpArgs).toEqual([
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "local",
      serverName,
      "--",
      "npx",
      "--yes",
      "@agentroom/bridge",
      "run",
      "--config",
      configPath,
    ]);
    expect(claudeResumeArgs("last", serverName)).toEqual([
      "--continue",
      "--dangerously-load-development-channels",
      `server:${serverName}`,
    ]);
    expect(claudeResumeArgs("backend-work", serverName)).toEqual([
      "--resume",
      "backend-work",
      "--dangerously-load-development-channels",
      `server:${serverName}`,
    ]);
    expect(commandLine("claude", claudeResumeArgs("last", serverName))).toBe(
      `'claude' '--continue' '--dangerously-load-development-channels' 'server:${serverName}'`,
    );
    expect(commandLine("claude", ["session $(touch bad)'name"])).toBe(
      `'claude' 'session $(touch bad)'"'"'name'`,
    );
  });
});
