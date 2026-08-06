import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseUpdateManifest,
  updateInstalledCli,
} from "../../src/connectors/self-update.js";

describe("AgentRoom CLI self-update", () => {
  it("validates release manifest bundle metadata", () => {
    expect(() =>
      parseUpdateManifest({
        schemaVersion: 1,
        version: "0.2.0",
        files: {
          bundle: {
            name: "../../agentroom.mjs",
            sha256: "a".repeat(64),
            size: 10,
          },
        },
      }),
    ).toThrow("invalid bundle metadata");
  });

  it("downloads, verifies, and atomically replaces the shared bundle", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentroom-update-"));
    const targetPath = join(directory, "agentroom.mjs");
    const nextBundle = Buffer.from("console.log('updated')\n");
    const sha256 = createHash("sha256").update(nextBundle).digest("hex");
    await writeFile(targetPath, "console.log('old')\n");
    const manifest = {
      schemaVersion: 1,
      version: "0.2.0",
      files: {
        bundle: {
          name: `agentroom-v0.2.0-${sha256.slice(0, 12)}.mjs`,
          mediaType: "text/javascript",
          sha256,
          size: nextBundle.length,
        },
      },
    };
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      return url.endsWith("/manifest.json")
        ? new Response(JSON.stringify(manifest), { status: 200 })
        : new Response(nextBundle, {
            status: 200,
            headers: { "content-length": String(nextBundle.length) },
          });
    }) as typeof fetch;

    await expect(
      updateInstalledCli({
        downloadBase: "https://try-status.online/api/downloads/cli",
        targetPath,
        fetchImpl,
      }),
    ).resolves.toEqual({ updated: true, version: "0.2.0", sha256 });
    await expect(readFile(targetPath)).resolves.toEqual(nextBundle);
    await expect(
      updateInstalledCli({
        downloadBase: "https://try-status.online/api/downloads/cli",
        targetPath,
        fetchImpl,
      }),
    ).resolves.toEqual({ updated: false, version: "0.2.0", sha256 });
  });

  it("keeps the installed bundle when checksum verification fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agentroom-update-bad-"));
    const targetPath = join(directory, "agentroom.mjs");
    const original = Buffer.from("console.log('safe')\n");
    await writeFile(targetPath, original);
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      return url.endsWith("/manifest.json")
        ? new Response(
            JSON.stringify({
              schemaVersion: 1,
              version: "0.2.0",
              files: {
                bundle: {
                  name: "agentroom-v0.2.0-aaaaaaaaaaaa.mjs",
                  sha256: "a".repeat(64),
                  size: 4,
                },
              },
            }),
            { status: 200 },
          )
        : new Response("evil", { status: 200 });
    }) as typeof fetch;

    await expect(
      updateInstalledCli({
        downloadBase: "https://try-status.online/api/downloads/cli",
        targetPath,
        fetchImpl,
      }),
    ).rejects.toThrow("checksum verification failed");
    await expect(readFile(targetPath)).resolves.toEqual(original);
  });
});
