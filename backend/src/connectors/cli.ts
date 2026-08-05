#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  assertCodexThreadAttachable,
  claudeMcpAddArgs,
  claudeResumeArgs,
  claudeServerName,
  codexStatePath,
  commandLine,
  formatCodexThread,
  localCliInvocation,
  resolveCodexThread,
} from "./session-attach.js";
import { CodexAppServerClient } from "./codex/app-server-client.js";
import { saveCodexState } from "./codex/state.js";

type Provider = "claude" | "codex";

interface StoredBridgeConfig {
  version: 1;
  baseUrl: string;
  roomId: string;
  accessToken: string;
  provider: Provider;
  workspace: string;
  stateFile?: string;
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "join") {
    await joinRoom(args, false);
  } else if (command === "attach") {
    await joinRoom(args, true);
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

async function joinRoom(args: string[], attach: boolean): Promise<void> {
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
    const session = option(args, "--session") ?? "last";
    const codexThreadId =
      attach && provider === "codex"
        ? await chooseCodexThread(args, prompt, workspace, session)
        : undefined;
    const claudeCommand =
      option(args, "--claude-command") ??
      process.env.AGENTROOM_CLAUDE_COMMAND ??
      "claude";
    if (attach && provider === "claude") {
      requireExecutable(claudeCommand, "Claude Code");
    }
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
    const stateFile =
      provider === "codex"
        ? codexStatePath(workspace, roomId, memberId)
        : undefined;
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    const config: StoredBridgeConfig = {
      version: 1,
      baseUrl,
      roomId,
      accessToken,
      provider,
      workspace,
      ...(stateFile ? { stateFile } : {}),
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    console.log(`Joined AgentRoom as ${displayName} (${memberId}).`);
    console.log(`Private bridge config written to ${configPath}`);
    const localCli = localCliInvocation();
    const runCommand = commandLine(localCli.command, [
      ...localCli.args,
      "run",
      "--config",
      configPath,
    ]);
    if (attach && provider === "codex") {
      if (!codexThreadId || !stateFile) {
        throw new Error("Codex session attachment was not initialized");
      }
      await saveCodexState(stateFile, {
        threadId: codexThreadId,
        resumeRequired: true,
      });
      console.log(`Attached existing Codex thread ${codexThreadId}.`);
      console.log(`Start the bridge with: ${runCommand}`);
    } else if (attach && provider === "claude") {
      const serverName = claudeServerName(roomId, memberId);
      const mcpArgs = claudeMcpAddArgs(serverName, configPath, localCli);
      configureClaudeMcp(claudeCommand, mcpArgs, workspace);
      console.log(`Configured Claude MCP channel ${serverName}.`);
      console.log("Exit the original Claude process before resuming it with:");
      console.log(
        commandLine(
          claudeCommand,
          claudeResumeArgs(session, serverName),
        ),
      );
    } else if (provider === "codex") {
      console.log(`Start the bridge with: ${runCommand}`);
    } else {
      console.log("Configure Claude Code MCP to run:");
      console.log(runCommand);
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
    if (config.stateFile) {
      process.env.AGENTROOM_STATE_FILE = config.stateFile;
    } else {
      delete process.env.AGENTROOM_STATE_FILE;
    }

    if (config.provider === "claude") {
      await import("./claude/channel.js");
    } else {
      await import("./codex/bridge.js");
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
  const stateFile = optionalString(config, "stateFile");
  return {
    version: 1,
    baseUrl: normalizeBaseUrl(requiredString(config, "baseUrl")),
    roomId: requiredString(config, "roomId"),
    accessToken: requiredString(config, "accessToken"),
    provider: parseProvider(requiredString(config, "provider")),
    workspace: resolve(requiredString(config, "workspace")),
    ...(stateFile ? { stateFile: resolve(stateFile) } : {}),
  };
}

async function chooseCodexThread(
  args: string[],
  prompt: ReturnType<typeof createInterface>,
  workspace: string,
  defaultSelector: string,
): Promise<string> {
  const codexCommand =
    option(args, "--codex-command") ??
    process.env.AGENTROOM_CODEX_COMMAND ??
    "codex";
  const appServer = new CodexAppServerClient(codexCommand, workspace);
  try {
    await appServer.start();
    const threads = await appServer.listThreads();
    let selector = option(args, "--session");
    if (!selector) {
      if (threads.length === 0) {
        throw new Error(
          "No saved Codex sessions were found in this workspace; use agentroom join to create a new one",
        );
      }
      console.log("Saved Codex sessions in this workspace:");
      threads.forEach((thread, index) => {
        console.log(formatCodexThread(thread, index));
      });
      selector = await requiredPrompt(
        prompt,
        "Session number, name, or thread ID (1): ",
        "1",
      );
    }
    const selected = resolveCodexThread(
      threads,
      selector ?? defaultSelector,
    );
    assertCodexThreadAttachable(selected);
    return await appServer.resumeThread(selected.id);
  } finally {
    appServer.close();
  }
}

function requireExecutable(command: string, label: string): void {
  const result = spawnSync(command, ["--version"], { stdio: "ignore" });
  if (result.error) {
    throw new Error(`${label} executable is unavailable: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} executable exited with status ${result.status}`);
  }
}

function configureClaudeMcp(
  command: string,
  args: string[],
  workspace: string,
): void {
  const result = spawnSync(command, args, {
    cwd: workspace,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `exit status ${result.status}`;
    throw new Error(
      `Could not configure the Claude MCP channel (${reason}). Run manually: ${commandLine(command, args)}`,
    );
  }
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

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const result = value[key];
  if (result === undefined) {
    return undefined;
  }
  if (typeof result !== "string" || !result) {
    throw new Error(`Bridge config field ${key} must be a non-empty string`);
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

function printUsage(): void {
  console.log(`AgentRoom bridge CLI

Usage:
  agentroom join <room-id> [--invite CODE] [--provider claude|codex]
                 [--name NAME] [--base-url URL] [--workspace PATH]
  agentroom attach <room-id> [--invite CODE] [--provider claude|codex]
                   [--session last|ID|NAME] [--name NAME]
                   [--base-url URL] [--workspace PATH]
  agentroom run --config PATH`);
}
