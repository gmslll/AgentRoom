import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const backendRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

describe("packaged AgentRoom CLI", () => {
  it(
    "starts the bundled Codex bridge with CommonJS Node built-ins available",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "agentroom-cli-bundle-"));
      const outputDirectory = join(directory, "release", "cli");
      const workspace = join(directory, "workspace");
      const configPath = join(workspace, ".agentroom", "codex-smoke.json");

      try {
        const build = spawnSync(
          process.execPath,
          [resolve(backendRoot, "scripts", "build-cli-release.mjs")],
          {
            cwd: backendRoot,
            encoding: "utf8",
            env: {
              ...process.env,
              AGENTROOM_CLI_DOWNLOAD_BASE:
                "https://try-status.online/api/downloads/cli",
              AGENTROOM_CLI_OUTPUT_DIR: outputDirectory,
            },
          },
        );
        expect(build.status, build.stderr || build.stdout).toBe(0);

        const manifest = JSON.parse(
          await readFile(join(outputDirectory, "manifest.json"), "utf8"),
        ) as { files: { bundle: { name: string } } };
        const bundlePath = join(
          outputDirectory,
          manifest.files.bundle.name,
        );
        await mkdir(dirname(configPath), { recursive: true });
        await writeFile(
          configPath,
          `${JSON.stringify({
            version: 1,
            baseUrl: "http://127.0.0.1:1",
            roomId: "room_bundle_smoke",
            accessToken: "art_bundle_smoke",
            provider: "codex",
            workspace,
            memberId: "mem_bundle_smoke",
            stateFile: join(workspace, ".agentroom", "codex-state.json"),
          })}\n`,
          { mode: 0o600 },
        );

        const child = spawn(
          process.execPath,
          [bundlePath, "run", "--config", configPath],
          {
            cwd: workspace,
            env: {
              ...process.env,
              AGENTROOM_CLI_ENTRY: bundlePath,
              AGENTROOM_DISABLE_AUTO_UPDATE: "true",
            },
            stdio: ["ignore", "ignore", "pipe"],
          },
        );
        let stderr = "";
        try {
          await new Promise<void>((resolvePromise, reject) => {
            const timer = setTimeout(() => {
              reject(new Error(`Timed out waiting for bridge startup: ${stderr}`));
            }, 5_000);
            child.stderr.on("data", (chunk: Buffer | string) => {
              stderr += chunk.toString();
              if (stderr.includes("AgentRoom realtime connection failed:")) {
                clearTimeout(timer);
                resolvePromise();
              }
            });
            child.once("exit", (code, signal) => {
              clearTimeout(timer);
              reject(
                new Error(
                  `Bundled bridge exited before connecting (${signal ?? `code ${code}`}): ${stderr}`,
                ),
              );
            });
          });
        } finally {
          child.kill("SIGTERM");
          await new Promise<void>((resolvePromise) => {
            if (child.exitCode !== null || child.signalCode !== null) {
              resolvePromise();
              return;
            }
            child.once("exit", () => resolvePromise());
          });
        }

        expect(stderr).not.toContain('Dynamic require of "events"');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    15_000,
  );
});
