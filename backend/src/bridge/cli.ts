#!/usr/bin/env node
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

type Provider = "claude" | "codex";

interface StoredBridgeConfig {
  version: 1;
  baseUrl: string;
  roomId: string;
  accessToken: string;
  provider: Provider;
  workspace: string;
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "join") {
    await joinRoom(args);
  } else if (command === "run") {
    await runBridge(args);
  } else {
    printUsage();
    process.exitCode = command === undefined || command === "--help" ? 0 : 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function joinRoom(args: string[]): Promise<void> {
  const roomId = positional(args, 0) ?? option(args, "--room");
  if (!roomId) {
    throw new Error("A room ID is required");
  }
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    const inviteCode =
      option(args, "--invite") ??
      (await requiredPrompt(prompt, "Room invite code: "));
    const provider = parseProvider(
      option(args, "--provider") ??
        (await requiredPrompt(prompt, "Provider (claude/codex): ")),
    );
    const displayName =
      option(args, "--name") ??
      (await requiredPrompt(
        prompt,
        `Display name (${provider === "claude" ? "Claude" : "Codex"}): `,
        provider === "claude" ? "Claude" : "Codex",
      ));
    const baseUrl = normalizeBaseUrl(
      option(args, "--base-url") ?? "http://127.0.0.1:8787",
    );
    const workspace = resolve(option(args, "--workspace") ?? process.cwd());
    const response = await fetch(
      `${baseUrl}/v1/rooms/${encodeURIComponent(roomId)}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          inviteCode,
          displayName,
          actorType: "agent",
          agentProvider: provider,
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      throw new Error(apiError(body, response.status));
    }
    const accessToken = requiredNestedString(body, "accessToken");
    const memberId = requiredNestedString(body, "member", "id");
    const safeRoomId = roomId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
    const configPath = resolve(
      option(args, "--config") ??
        resolve(
          workspace,
          ".agentroom",
          `${provider}-${safeRoomId}-${memberId.slice(-8)}.json`,
        ),
    );
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    const config: StoredBridgeConfig = {
      version: 1,
      baseUrl,
      roomId,
      accessToken,
      provider,
      workspace,
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    console.log(`Joined AgentRoom as ${displayName} (${memberId}).`);
    console.log(`Private bridge config written to ${configPath}`);
    if (provider === "codex") {
      console.log(
        `Start the bridge with: npx --yes @agentroom/bridge run --config ${quote(configPath)}`,
      );
    } else {
      console.log("Configure Claude Code MCP to run:");
      console.log(
        `npx --yes @agentroom/bridge run --config ${quote(configPath)}`,
      );
      console.log(
        "Then load the channel with --dangerously-load-development-channels server:agentroom.",
      );
    }
  } finally {
    prompt.close();
  }
}

async function runBridge(args: string[]): Promise<void> {
  const configPath = option(args, "--config") ?? positional(args, 0);
  if (!configPath) {
    throw new Error("--config is required");
  }
  const config = parseStoredConfig(
    JSON.parse(await readFile(resolve(configPath), "utf8")) as unknown,
  );
  const releaseLock = await acquireLock(`${resolve(configPath)}.lock`);
  try {
    process.env.AGENTROOM_BASE_URL = config.baseUrl;
    process.env.AGENTROOM_ROOM_ID = config.roomId;
    process.env.AGENTROOM_ACCESS_TOKEN = config.accessToken;
    process.env.AGENTROOM_WORKSPACE = config.workspace;

    if (config.provider === "claude") {
      await import("./claude-channel.js");
    } else {
      await import("./codex-bridge.js");
    }
  } finally {
    await releaseLock();
  }
}

async function acquireLock(path: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      return async () => {
        await handle.close();
        await unlink(path).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const ownerPid = Number.parseInt(await readFile(path, "utf8"), 10);
      if (Number.isInteger(ownerPid) && ownerPid > 0 && processExists(ownerPid)) {
        throw new Error(`Another AgentRoom bridge is already using ${path}`);
      }
      await unlink(path);
    }
  }
  throw new Error(`Could not acquire AgentRoom bridge lock ${path}`);
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function parseStoredConfig(value: unknown): StoredBridgeConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Bridge config must be a JSON object");
  }
  const config = value as Record<string, unknown>;
  return {
    version: 1,
    baseUrl: normalizeBaseUrl(requiredString(config, "baseUrl")),
    roomId: requiredString(config, "roomId"),
    accessToken: requiredString(config, "accessToken"),
    provider: parseProvider(requiredString(config, "provider")),
    workspace: resolve(requiredString(config, "workspace")),
  };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function positional(args: string[], index: number): string | undefined {
  return args.filter((value, valueIndex) => {
    if (value.startsWith("--")) {
      return false;
    }
    return valueIndex === 0 || !args[valueIndex - 1]?.startsWith("--");
  })[index];
}

async function requiredPrompt(
  prompt: ReturnType<typeof createInterface>,
  message: string,
  fallback?: string,
): Promise<string> {
  if (!stdin.isTTY) {
    throw new Error(`Missing required interactive value: ${message.trim()}`);
  }
  const value = (await prompt.question(message)).trim() || fallback;
  if (!value) {
    throw new Error(`${message.trim()} is required`);
  }
  return value;
}

function parseProvider(value: string): Provider {
  if (value !== "claude" && value !== "codex") {
    throw new Error("Provider must be claude or codex");
  }
  return value;
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Base URL must use http or https");
  }
  return url.toString().replace(/\/$/, "");
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
): string {
  const result = value[key];
  if (typeof result !== "string" || !result) {
    throw new Error(`Bridge config is missing ${key}`);
  }
  return result;
}

function requiredNestedString(
  value: Record<string, unknown>,
  key: string,
  nestedKey?: string,
): string {
  const candidate = nestedKey
    ? (value[key] as Record<string, unknown> | undefined)?.[nestedKey]
    : value[key];
  if (typeof candidate !== "string" || !candidate) {
    throw new Error(
      `AgentRoom response did not include ${nestedKey ? `${key}.${nestedKey}` : key}`,
    );
  }
  return candidate;
}

function apiError(body: Record<string, unknown>, status: number): string {
  const error = body.error as Record<string, unknown> | undefined;
  return typeof error?.message === "string"
    ? error.message
    : `AgentRoom join failed with HTTP ${status}`;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function printUsage(): void {
  console.log(`AgentRoom bridge CLI

Usage:
  agentroom join <room-id> [--invite CODE] [--provider claude|codex]
                 [--name NAME] [--base-url URL] [--workspace PATH]
  agentroom run --config PATH`);
}
