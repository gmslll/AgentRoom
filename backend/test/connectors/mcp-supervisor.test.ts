import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CodexMcpSupervisor,
  discoverCodexBridgeConfigs,
} from "../../src/connectors/codex/mcp-supervisor.js";

describe("Codex MCP workspace discovery", () => {
  it("loads only Codex bridge configs for the exact workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agentroom-mcp-"));
    const privateDirectory = join(workspace, ".agentroom");
    await mkdir(privateDirectory, { mode: 0o700 });
    await Promise.all([
      writeFile(
        join(privateDirectory, "codex-room.json"),
        JSON.stringify({
          version: 1,
          baseUrl: "https://try-status.online/api",
          roomId: "room_codex",
          accessToken: "art_private",
          provider: "codex",
          workspace,
          memberId: "mem_codex",
        }),
      ),
      writeFile(
        join(privateDirectory, "claude-room.json"),
        JSON.stringify({
          version: 1,
          baseUrl: "https://try-status.online/api",
          roomId: "room_claude",
          accessToken: "art_private",
          provider: "claude",
          workspace,
          memberId: "mem_claude",
        }),
      ),
      writeFile(
        join(privateDirectory, "codex-other-workspace.json"),
        JSON.stringify({
          version: 1,
          baseUrl: "https://try-status.online/api",
          roomId: "room_elsewhere",
          accessToken: "art_private",
          provider: "codex",
          workspace: join(workspace, "elsewhere"),
        }),
      ),
      writeFile(
        join(privateDirectory, "codex-state.json"),
        JSON.stringify({ threadId: "thread_state" }),
      ),
    ]);

    const discovered = await discoverCodexBridgeConfigs(workspace);

    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.config).toMatchObject({
      roomId: "room_codex",
      provider: "codex",
      memberId: "mem_codex",
    });
  });

  it("does not follow config symlinks from the private directory", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agentroom-mcp-link-"));
    const privateDirectory = join(workspace, ".agentroom");
    const outside = join(workspace, "outside.json");
    await mkdir(privateDirectory, { mode: 0o700 });
    await writeFile(
      outside,
      JSON.stringify({
        version: 1,
        baseUrl: "https://try-status.online/api",
        roomId: "room_link",
        accessToken: "art_private",
        provider: "codex",
        workspace,
      }),
    );
    await symlink(outside, join(privateDirectory, "linked.json"));

    await expect(discoverCodexBridgeConfigs(workspace)).resolves.toEqual([]);
  });

  it("starts and stops a discovered receiver child with the MCP lifecycle", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "agentroom-mcp-child-"));
    const privateDirectory = join(workspace, ".agentroom");
    await mkdir(privateDirectory, { mode: 0o700 });
    await writeFile(
      join(privateDirectory, "codex-room.json"),
      JSON.stringify({
        version: 1,
        baseUrl: "https://try-status.online/api",
        roomId: "room_codex",
        accessToken: "art_private",
        provider: "codex",
        workspace,
        memberId: "mem_codex",
      }),
    );
    const supervisor = new CodexMcpSupervisor({
      workspace,
      cli: {
        command: process.execPath,
        args: [
          "-e",
          "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)",
          "--",
        ],
      },
      scanIntervalMs: 60_000,
    });

    try {
      await supervisor.start();
      await waitFor(() => supervisor.statuses()[0]?.status === "running");
      expect(supervisor.statuses()).toEqual([
        expect.objectContaining({
          roomId: "room_codex",
          memberId: "mem_codex",
          status: "running",
          pid: expect.any(Number),
        }),
      ]);
    } finally {
      await supervisor.close();
    }
    expect(supervisor.statuses()).toEqual([]);
  });
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for the receiver child");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
  }
}
