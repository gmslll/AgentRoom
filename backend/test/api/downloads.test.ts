import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/api/app.js";
import type { CliReleaseManifest } from "../../src/protocol/cli-release.js";

const apps: FastifyInstance[] = [];
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("CLI downloads", () => {
  it("serves the release manifest and only declared artifacts", async () => {
    const artifacts = await releaseDirectory();
    const app = await buildApp({ cliArtifactsDirectory: artifacts });
    apps.push(app);

    const manifest = await app.inject({
      method: "GET",
      url: "/downloads/cli/manifest.json",
    });
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers["cache-control"]).toContain("no-store");
    expect(manifest.json()).toMatchObject({
      version: "0.1.0",
      providers: ["claude", "codex"],
    });

    const installer = await app.inject({
      method: "GET",
      url: "/downloads/cli/install.sh",
    });
    expect(installer.statusCode).toBe(200);
    expect(installer.body).toBe("#!/bin/sh\n");
    expect(installer.headers["content-disposition"]).toContain("install.sh");
    expect(installer.headers["x-content-type-options"]).toBe("nosniff");

    const undeclared = await app.inject({
      method: "GET",
      url: "/downloads/cli/not-a-release.txt",
    });
    expect(undeclared.statusCode).toBe(404);
    expect(undeclared.json().error.code).toBe("CLI_ARTIFACT_NOT_FOUND");
  });

  it("fails closed when an artifact does not match its manifest checksum", async () => {
    const artifacts = await releaseDirectory({
      bundleSha256: "b".repeat(64),
    });
    const app = await buildApp({ cliArtifactsDirectory: artifacts });
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/downloads/cli/agentroom-v0.1.0.mjs",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("CLI_RELEASE_UNAVAILABLE");
  });
});

async function releaseDirectory(
  options: { bundleSize?: number; bundleSha256?: string } = {},
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "agentroom-cli-release-"));
  temporaryDirectories.push(directory);
  const bundle = "#!/usr/bin/env node\n";
  const unix = "#!/bin/sh\n";
  const windows = "Write-Host AgentRoom\n";
  await Promise.all([
    writeFile(join(directory, "agentroom-v0.1.0.mjs"), bundle),
    writeFile(join(directory, "install.sh"), unix),
    writeFile(join(directory, "install.ps1"), windows),
  ]);
  const manifest: CliReleaseManifest = {
    schemaVersion: 1,
    version: "0.1.0",
    minimumNodeVersion: "22.0.0",
    providers: ["claude", "codex"],
    files: {
      bundle: {
        ...artifact(
          "agentroom-v0.1.0.mjs",
          "text/javascript",
          bundle,
          options.bundleSize,
        ),
        ...(options.bundleSha256
          ? { sha256: options.bundleSha256 }
          : {}),
      },
      macosLinuxInstaller: artifact(
        "install.sh",
        "text/x-shellscript",
        unix,
      ),
      windowsInstaller: artifact(
        "install.ps1",
        "text/plain",
        windows,
      ),
    },
  };
  await writeFile(
    join(directory, "manifest.json"),
    `${JSON.stringify(manifest)}\n`,
  );
  return directory;
}

function artifact(
  name: string,
  mediaType: string,
  content: string,
  size = Buffer.byteLength(content),
) {
  return {
    name,
    mediaType,
    size,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
