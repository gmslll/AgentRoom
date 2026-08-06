import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

export interface CodexSessionHost {
  child: ChildProcess;
  endpoint: string;
  close(): Promise<void>;
}

export function codexSessionEndpoint(
  configPath: string,
  platform = process.platform,
): string {
  const digest = configDigest(configPath);
  if (platform === "win32") {
    const port = 40_000 + (Number.parseInt(digest.slice(0, 8), 16) % 20_000);
    return `ws://127.0.0.1:${port}`;
  }
  const socketPath = resolve(
    tmpdir(),
    "agentroom-codex",
    `${digest.slice(0, 24)}.sock`,
  );
  return `unix://${socketPath}`;
}

export function codexSessionHostLockPath(configPath: string): string {
  return resolve(
    tmpdir(),
    "agentroom-codex",
    `${configDigest(configPath).slice(0, 24)}.host.lock`,
  );
}

export async function startCodexSessionHost(
  command: string,
  workspace: string,
  endpoint: string,
  timeoutMs = 15_000,
): Promise<CodexSessionHost> {
  const unixPath = endpoint.startsWith("unix://")
    ? resolve(endpoint.slice("unix://".length))
    : undefined;
  if (unixPath) {
    await mkdir(dirname(unixPath), { recursive: true, mode: 0o700 });
    await unlink(unixPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
  } else {
    assertLoopbackWebSocket(endpoint);
  }

  const child = spawn(command, ["app-server", "--listen", endpoint], {
    cwd: workspace,
    stdio: ["ignore", "ignore", "pipe"],
  });
  let recentError = "";
  let spawnError: Error | undefined;
  child.stderr?.on("data", (chunk: Buffer | string) => {
    recentError = `${recentError}${chunk.toString()}`.slice(-8_000);
  });
  child.once("error", (error) => {
    spawnError = error;
  });

  try {
    await waitForEndpoint(
      child,
      endpoint,
      unixPath,
      timeoutMs,
      () => spawnError ?? recentError,
    );
  } catch (error) {
    child.kill("SIGTERM");
    await waitForExit(child, 3_000);
    if (unixPath) {
      await unlink(unixPath).catch(() => undefined);
    }
    throw error;
  }

  let closed = false;
  return {
    child,
    endpoint,
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await waitForExit(child, 5_000);
      }
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 1_000);
      }
      if (unixPath) {
        await unlink(unixPath).catch(() => undefined);
      }
    },
  };
}

async function waitForEndpoint(
  child: ChildProcess,
  endpoint: string,
  unixPath: string | undefined,
  timeoutMs: number,
  recentError: () => Error | string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const failure = recentError();
    if (failure instanceof Error) {
      throw failure;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        failure.trim() ||
          `Codex app-server exited before opening ${endpoint}`,
      );
    }
    if (unixPath ? await isSocket(unixPath) : await isReady(endpoint)) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  const failure = recentError();
  throw new Error(
    `Timed out waiting for Codex app-server endpoint ${endpoint}${
      failure ? `: ${failure instanceof Error ? failure.message : failure.trim()}` : ""
    }`,
  );
}

async function isSocket(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isSocket();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function isReady(endpoint: string): Promise<boolean> {
  try {
    const readyUrl = new URL(endpoint);
    readyUrl.protocol = "http:";
    readyUrl.pathname = "/readyz";
    const response = await fetch(readyUrl, {
      signal: AbortSignal.timeout(250),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function assertLoopbackWebSocket(endpoint: string): void {
  const url = new URL(endpoint);
  if (
    url.protocol !== "ws:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
  ) {
    throw new Error(
      "Codex session host WebSocket endpoint must bind to localhost",
    );
  }
}

function configDigest(configPath: string): string {
  return createHash("sha256").update(resolve(configPath)).digest("hex");
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise<void>((resolvePromise) => {
    const timer = setTimeout(resolvePromise, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolvePromise();
    });
  });
}
