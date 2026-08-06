#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  assertCodexThreadAttachable,
  claudeMcpAddArgs,
  claudeResumeArgs,
  claudeServerName,
  claudeStartArgs,
  codexMcpAddArgs,
  codexReceiverServerName,
  codexStatePath,
  commandLine,
  formatCodexThread,
  localCliInvocation,
  resolveCodexThread,
} from "./session-attach.js";
import { CodexAppServerClient } from "./codex/app-server-client.js";
import { saveCodexState } from "./codex/state.js";
import {
  type Provider,
  type StoredBridgeConfig,
  normalizeBaseUrl,
  parseProvider,
  parseStoredConfig,
  resolveKeychainToken,
} from "./bridge-config.js";
import {
  KeychainSecretStore,
  credentialAccount,
  resolveCredentialStoreKind,
} from "./secret-store.js";
import { updateInstalledCli } from "./self-update.js";

declare const __AGENTROOM_CLI_VERSION__: string;
declare const __AGENTROOM_CLI_DOWNLOAD_BASE__: string;

const cliVersion =
  typeof __AGENTROOM_CLI_VERSION__ === "string"
    ? __AGENTROOM_CLI_VERSION__
    : "0.2.3-dev";
const cliDownloadBase =
  typeof __AGENTROOM_CLI_DOWNLOAD_BASE__ === "string"
    ? __AGENTROOM_CLI_DOWNLOAD_BASE__
    : "http://127.0.0.1:8787/downloads/cli";

const [command, ...args] = process.argv.slice(2);

try {
  if (command === "join") {
    await joinRoom(args, false);
  } else if (command === "attach") {
    await joinRoom(args, true);
  } else if (command === "run") {
    await runBridge(args);
  } else if (command === "mcp") {
    await runCodexMcp(args);
  } else if (command === "configure") {
    await configureExistingBridge(args);
  } else if (command === "update") {
    await updateCli(args);
  } else if (command === "version" || command === "--version") {
    console.log(`agentroom ${cliVersion}`);
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
    const manualStart = args.includes("--manual-start");
    const codexCommand =
      option(args, "--codex-command") ??
      process.env.AGENTROOM_CODEX_COMMAND ??
      "codex";
    const codexThreadId =
      attach && provider === "codex"
        ? await chooseCodexThread(args, prompt, workspace, session)
        : undefined;
    const claudeCommand =
      option(args, "--claude-command") ??
      process.env.AGENTROOM_CLAUDE_COMMAND ??
      "claude";
    if (!manualStart && provider === "claude") {
      requireExecutable(claudeCommand, "Claude Code");
    }
    if (!manualStart && provider === "codex") {
      requireExecutable(codexCommand, "Codex");
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

    // Optionally keep the member token out of the config file, in the OS
    // credential store (Keychain / Credential Manager / libsecret).
    let credentialStore: "keychain" | undefined;
    if (resolveCredentialStoreKind(option(args, "--credential-store")) === "keychain") {
      const store = new KeychainSecretStore();
      if (await store.save(credentialAccount(roomId, memberId), accessToken)) {
        credentialStore = "keychain";
        console.log("Member token stored in the OS credential store.");
      } else {
        console.warn(
          "OS credential store unavailable; the member token will be written to the config file.",
        );
      }
    }

    const config: StoredBridgeConfig = {
      version: 1,
      baseUrl,
      roomId,
      accessToken: credentialStore ? "" : accessToken,
      provider,
      workspace,
      memberId,
      ...(credentialStore ? { credentialStore } : {}),
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
    }

    if (manualStart) {
      console.log(`Start the bridge with: ${runCommand}`);
    } else if (provider === "codex") {
      configureCodexMcp(codexCommand, localCli, workspace);
      console.log(`Configured Codex MCP receiver ${codexReceiverServerName}.`);
      console.log(
        `Start or restart Codex in ${workspace}; AgentRoom will connect automatically.`,
      );
      console.log(
        "Use /mcp or the agentroom_receiver_status tool to inspect the receiver.",
      );
    } else {
      const serverName = claudeServerName(roomId, memberId);
      const mcpArgs = claudeMcpAddArgs(serverName, configPath, localCli);
      configureClaudeMcp(claudeCommand, mcpArgs, workspace);
      console.log(`Configured Claude MCP channel ${serverName}.`);
      console.log(
        attach
          ? "Exit the original Claude process before resuming it with:"
          : "Start Claude Code with:",
      );
      console.log(
        commandLine(
          claudeCommand,
          attach
            ? claudeResumeArgs(session, serverName)
            : claudeStartArgs(serverName),
        ),
      );
    }
  } finally {
    prompt.close();
  }
}

async function runBridge(args: string[]): Promise<void> {
  if (await autoUpdateReceiver("run", args)) {
    return;
  }
  const configPath = option(args, "--config") ?? positional(args, 0);
  if (!configPath) {
    throw new Error("--config is required");
  }
  const config = parseStoredConfig(
    JSON.parse(await readFile(resolve(configPath), "utf8")) as unknown,
  );
  const accessToken =
    config.credentialStore === "keychain"
      ? await resolveKeychainToken(config)
      : config.accessToken;
  const releaseLock = await acquireLock(`${resolve(configPath)}.lock`);
  try {
    process.env.AGENTROOM_BASE_URL = config.baseUrl;
    process.env.AGENTROOM_ROOM_ID = config.roomId;
    process.env.AGENTROOM_ACCESS_TOKEN = accessToken;
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

async function runCodexMcp(args: string[]): Promise<void> {
  if (await autoUpdateReceiver("mcp", args)) {
    return;
  }
  const workspace = resolve(option(args, "--workspace") ?? process.cwd());
  process.env.AGENTROOM_DISCOVERY_WORKSPACE = workspace;
  await import("./codex/mcp-receiver.js");
}

async function configureExistingBridge(args: string[]): Promise<void> {
  const configPath = option(args, "--config") ?? positional(args, 0);
  if (!configPath) {
    throw new Error("--config is required");
  }
  const resolvedConfigPath = resolve(configPath);
  const config = parseStoredConfig(
    JSON.parse(await readFile(resolvedConfigPath, "utf8")) as unknown,
  );
  const localCli = localCliInvocation();

  if (config.provider === "codex") {
    const codexCommand =
      option(args, "--codex-command") ??
      process.env.AGENTROOM_CODEX_COMMAND ??
      "codex";
    requireExecutable(codexCommand, "Codex");
    configureCodexMcp(codexCommand, localCli, config.workspace);
    console.log(`Configured Codex MCP receiver ${codexReceiverServerName}.`);
    console.log(
      `Start or restart Codex in ${config.workspace}; AgentRoom will connect automatically.`,
    );
    return;
  }

  if (!config.memberId) {
    throw new Error(
      "The existing Claude config has no memberId; join the room again to create an MCP-managed config",
    );
  }
  const claudeCommand =
    option(args, "--claude-command") ??
    process.env.AGENTROOM_CLAUDE_COMMAND ??
    "claude";
  requireExecutable(claudeCommand, "Claude Code");
  const serverName = claudeServerName(config.roomId, config.memberId);
  configureClaudeMcp(
    claudeCommand,
    claudeMcpAddArgs(serverName, resolvedConfigPath, localCli),
    config.workspace,
  );
  console.log(`Configured Claude MCP channel ${serverName}.`);
  console.log("Start Claude Code with:");
  console.log(commandLine(claudeCommand, claudeStartArgs(serverName)));
}

async function updateCli(args: string[]): Promise<void> {
  const targetPath = process.env.AGENTROOM_CLI_ENTRY;
  if (!targetPath) {
    throw new Error(
      "agentroom update must be run through the globally installed agentroom launcher",
    );
  }
  const result = await updateInstalledCli({
    downloadBase:
      option(args, "--download-base") ??
      process.env.AGENTROOM_DOWNLOAD_BASE ??
      cliDownloadBase,
    targetPath,
    currentVersion: cliVersion,
  });
  if (result.updated) {
    console.log(
      `Updated AgentRoom CLI to ${result.version} (${result.sha256.slice(0, 12)}).`,
    );
    console.log(
      "Restart Claude/Codex so their MCP receivers use the updated CLI.",
    );
  } else {
    console.log(
      `AgentRoom CLI is already current (${result.version}, ${result.sha256.slice(0, 12)}).`,
    );
  }
}

async function autoUpdateReceiver(
  subcommand: "run" | "mcp",
  args: string[],
): Promise<boolean> {
  if (process.env.AGENTROOM_AUTO_UPDATE_RELAUNCHED === "true") {
    delete process.env.AGENTROOM_AUTO_UPDATE_RELAUNCHED;
    return false;
  }
  if (process.env.AGENTROOM_DISABLE_AUTO_UPDATE === "true") {
    return false;
  }
  const entry = process.env.AGENTROOM_CLI_ENTRY ?? process.argv[1];
  if (!entry) {
    return false;
  }
  const targetPath = resolve(entry);
  if (basename(targetPath) !== "agentroom.mjs") {
    return false;
  }

  try {
    const runningSha256 = createHash("sha256")
      .update(await readFile(targetPath))
      .digest("hex");
    const update = await updateInstalledCli({
      downloadBase:
        process.env.AGENTROOM_DOWNLOAD_BASE ?? cliDownloadBase,
      targetPath,
      currentVersion: cliVersion,
      manifestTimeoutMs: 2_000,
      bundleTimeoutMs: 5_000,
    });
    if (runningSha256 === update.sha256) {
      return false;
    }

    console.error(
      `AgentRoom CLI ${update.version} downloaded and verified; restarting the ${subcommand} receiver with ${update.sha256.slice(0, 12)}.`,
    );
    try {
      await relayToUpdatedCli(targetPath, subcommand, args);
      return true;
    } catch (error) {
      console.error(
        "Could not hand the receiver to the updated CLI; continuing with the already loaded version:",
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  } catch (error) {
    console.error(
      `AgentRoom automatic update check failed; continuing with ${cliVersion}:`,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  }
}

async function relayToUpdatedCli(
  targetPath: string,
  subcommand: "run" | "mcp",
  args: string[],
): Promise<void> {
  const child = spawn(
    process.execPath,
    [targetPath, subcommand, ...args],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENTROOM_AUTO_UPDATE_RELAUNCHED: "true",
        AGENTROOM_CLI_ENTRY: targetPath,
      },
      stdio: "inherit",
    },
  );
  const forwardInterrupt = () => child.kill("SIGINT");
  const forwardTermination = () => child.kill("SIGTERM");
  process.once("SIGINT", forwardInterrupt);
  process.once("SIGTERM", forwardTermination);

  try {
    await new Promise<void>((resolvePromise, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
          resolvePromise();
        } else {
          reject(
            new Error(
              `Updated AgentRoom CLI exited (${signal ?? `code ${code ?? "unknown"}`})`,
            ),
          );
        }
      });
    });
  } finally {
    process.off("SIGINT", forwardInterrupt);
    process.off("SIGTERM", forwardTermination);
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

function configureCodexMcp(
  command: string,
  cli: ReturnType<typeof localCliInvocation>,
  workspace: string,
): void {
  const expectedCommand = cli.command;
  const expectedArgs = [...cli.args, "mcp"];
  const existing = spawnSync(
    command,
    ["mcp", "get", codexReceiverServerName, "--json"],
    { cwd: workspace, encoding: "utf8" },
  );
  if (existing.error) {
    throw new Error(
      `Could not inspect Codex MCP configuration: ${existing.error.message}`,
    );
  }
  if (existing.status === 0) {
    const parsed = JSON.parse(existing.stdout || "{}") as {
      transport?: {
        type?: string;
        command?: string;
        args?: string[];
      };
    };
    if (
      parsed.transport?.type !== "stdio" ||
      parsed.transport.command !== expectedCommand ||
      !sameStrings(parsed.transport.args, expectedArgs)
    ) {
      throw new Error(
        `Codex MCP server ${codexReceiverServerName} already exists with a different command. ` +
          `Remove it with '${command} mcp remove ${codexReceiverServerName}', then run agentroom join again.`,
      );
    }
    return;
  }

  const result = spawnSync(command, codexMcpAddArgs(cli), {
    cwd: workspace,
    stdio: "inherit",
  });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message ?? `exit status ${result.status}`;
    throw new Error(
      `Could not configure the Codex MCP receiver (${reason}). Run manually: ${commandLine(command, codexMcpAddArgs(cli))}`,
    );
  }
}

function sameStrings(
  actual: string[] | undefined,
  expected: string[],
): boolean {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
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
                 [--credential-store file|keychain] [--manual-start]
  agentroom attach <room-id> [--invite CODE] [--provider claude|codex]
                   [--session last|ID|NAME] [--name NAME]
                   [--base-url URL] [--workspace PATH]
                   [--credential-store file|keychain] [--manual-start]
  agentroom run --config PATH
  agentroom mcp [--workspace PATH]
  agentroom configure --config PATH
  agentroom update [--download-base URL]
  agentroom --version`);
}
