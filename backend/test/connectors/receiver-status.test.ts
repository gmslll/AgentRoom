import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ReceiverStatusReporter,
  readReceiverRuntimeStatus,
} from "../../src/connectors/receiver-status.js";

describe("receiver runtime status", () => {
  it("writes token-free realtime state atomically", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentroom-status-"));
    const path = join(directory, "receiver.status");
    try {
      const reporter = new ReceiverStatusReporter(
        path,
        { roomId: "room_1", memberId: "mem_1" },
        4242,
      );

      await reporter.report(
        "reconnecting",
        new Error("socket unavailable for Bearer art_should_not_leak"),
      );
      expect(await readReceiverRuntimeStatus(path)).toMatchObject({
        pid: 4242,
        roomId: "room_1",
        memberId: "mem_1",
        state: "reconnecting",
        lastError: "socket unavailable for Bearer [REDACTED]",
      });

      await reporter.report("connected");
      const connected = await readReceiverRuntimeStatus(path);
      expect(connected).toMatchObject({
        state: "connected",
        lastConnectedAt: expect.any(String),
      });
      expect(connected).not.toHaveProperty("lastError");
      expect(await readFile(path, "utf8")).not.toContain("accessToken");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("ignores malformed sidecars", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentroom-status-bad-"));
    const path = join(directory, "receiver.status");
    try {
      await writeFile(path, "not-json");
      await expect(readReceiverRuntimeStatus(path)).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
