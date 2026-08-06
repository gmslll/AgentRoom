#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  assertCodexThreadAttachable,
  agentRoomConnectionPrompt,
  type AgentRoomSessionContext,
  claudeMcpAddArgs,
  claudeResumeArgs,
  claudeServerName,
  claudeStartArgs,
  codexBootstrapPrompt,
  codexMcpAddArgs,
  codexReceiverServerName,
  codexRemoteResumeArgs,
  codexStatePath,
  commandLine,
  formatCodexThread,
  localCliInvocation,
  resolveCodexThread,
} from "./session-attach.js";
import { CodexAppServerClient } from "./codex/app-server-client.js";
import {
  codexSessionEndpoint,
  codexSessionHostLockPath,
  startCodexSessionHost,
} from "./codex/session-host.js";
import { loadCodexState, saveCodexState } from "./codex/state.js";
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
import { receiverStatusPath } from "./receiver-status.js";
import { AgentRoomClient } from "./agentroom-client.js";
import {
  downloadAttachmentToWorkspace,
  uploadWorkspaceFiles,
} from "./attachment-files.js";
import { resolveProviderExecutable } from "./provider-executable.js";

declare const __AGENTROOM_CLI_VERSION__: string;
declare const __AGENTROOM_CLI_DOWNLOAD_BASE__: string;

const cliVersion =
  typeof __AGENTROOM_CLI_VERSION__ === "string"
    ? __AGENTROOM_CLI_VERSION__
    : "0.6.0-dev";
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
  } else if (command === "start") {
    await startConfiguredSession(args);
  } else if (command === "send") {
    await sendRoomMessage(args);
  } else if (command === "history") {
    await printRoomHistory(args);
  } else if (command === "attachment") {
    await downloadRoomAttachment(args);
  } else if (command === "dispatch") {
    await dispatchAgentTask(args);
  } else if (command === "claim-code") {
    await issueAgentClaimCode(args);
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
  let promptClosed = false;
  const closePrompt = () => {
    if (!promptClosed) {
      promptClosed = true;
      prompt.close();
    }
  };
  try {
    const provider = parseProvider(
      option(args, "--provider") ??
        (await requiredPrompt(prompt, "Provider (claude/codex): ")),
    );
    const manualStart = args.includes("--manual-start");
    let codexCommand =
      option(args, "--codex-command") ??
      process.env.AGENTROOM_CODEX_COMMAND ??
      "codex";
    let claudeCommand =
      option(args, "--claude-command") ??
      process.env.AGENTROOM_CLAUDE_COMMAND ??
      "claude";
    if (!manualStart && provider === "claude") {
      claudeCommand = resolveProviderExecutable(claudeCommand, "Claude Code");
    }
    if (!manualStart && provider === "codex") {
      codexCommand = resolveProviderExecutable(codexCommand, "Codex");
    }

    const publicJoin = args.includes("--public");
    const inviteOption = option(args, "--invite");
    if (publicJoin && inviteOption) {
      throw new Error("--public and --invite cannot be used together");
    }
    const inviteCode =
      inviteOption ??
      (publicJoin
        ? undefined
        : ((await prompt.question(
            "Room invite code (leave blank for a public room): ",
          )).trim() || undefined));
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
    const noLaunch = args.includes("--no-launch") || !stdin.isTTY || !stdout.isTTY;
    const codexThreadId =
      attach && provider === "codex"
        ? await chooseCodexThread(args, prompt, workspace, session)
        : undefined;
    const response = await fetch(
      `${baseUrl}/v1/rooms/${encodeURIComponent(roomId)}/members`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(inviteCode ? { inviteCode } : {}),
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
    const agentClaim = optionalObject(body, "agentClaim");
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
    const codexAppServerEndpoint =
      provider === "codex" && !manualStart
        ? codexSessionEndpoint(configPath)
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
      displayName,
      ...(attach && provider === "claude"
        ? { providerSession: session }
        : {}),
      ...(credentialStore ? { credentialStore } : {}),
      ...(stateFile ? { stateFile } : {}),
      ...(codexAppServerEndpoint ? { codexAppServerEndpoint } : {}),
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    console.log(`Joined AgentRoom as ${displayName} (${memberId}).`);
    if (provider && agentClaim) {
      const claimCode = optionalString(agentClaim, "code");
      const expiresAt = optionalString(agentClaim, "expiresAt");
      if (claimCode && expiresAt) {
        console.log(`Agent ownership claim code: ${claimCode}`);
        console.log(
          `Claim this Agent from a signed-in room account before ${expiresAt}.`,
        );
      }
    }
    console.log(`Private bridge config written to ${configPath}`);
    const localCli = localCliInvocation();
    const runCommand = commandLine(localCli.command, [
      ...localCli.args,
      "run",
      "--config",
      configPath,
    ]);
    if (manualStart) {
      console.log(`Start the bridge with: ${runCommand}`);
    } else if (provider === "codex") {
      if (!stateFile || !codexAppServerEndpoint) {
        throw new Error("Codex session paths were not initialized");
      }
      if (attach && !codexThreadId) {
        throw new Error("Codex session attachment was not initialized");
      }
      configureCodexMcp(codexCommand, localCli, workspace);
      console.log(`Configured Codex MCP receiver ${codexReceiverServerName}.`);
      closePrompt();
      await runCodexSession({
        codexCommand,
        configPath,
        stateFile,
        endpoint: codexAppServerEndpoint,
        context: { roomId, memberId, displayName, workspace },
        ...(codexThreadId ? { existingThreadId: codexThreadId } : {}),
        injectConnection: true,
        noLaunch,
      });
    } else {
      const serverName = claudeServerName(roomId, memberId);
      const mcpArgs = claudeMcpAddArgs(serverName, configPath, localCli);
      configureClaudeMcp(claudeCommand, mcpArgs, workspace);
      console.log(`Configured Claude MCP channel ${serverName}.`);
      const context: AgentRoomSessionContext = {
        roomId,
        memberId,
        displayName,
        workspace,
      };
      const launchArgs = attach
        ? claudeResumeArgs(session, serverName, context)
        : claudeStartArgs(serverName, context);
      closePrompt();
      await launchOrPrint({
        command: claudeCommand,
        args: launchArgs,
        workspace,
        configPath,
        noLaunch,
        label: "Claude Code",
      });
    }
  } finally {
    closePrompt();
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
    process.env.AGENTROOM_RECEIVER_STATUS_FILE = receiverStatusPath(
      resolve(configPath),
    );
    if (config.memberId) {
      process.env.AGENTROOM_MEMBER_ID = config.memberId;
    } else {
      delete process.env.AGENTROOM_MEMBER_ID;
    }
    if (config.displayName) {
      process.env.AGENTROOM_DISPLAY_NAME = config.displayName;
    } else {
      delete process.env.AGENTROOM_DISPLAY_NAME;
    }
    if (config.codexAppServerEndpoint) {
      process.env.AGENTROOM_CODEX_APP_SERVER_ENDPOINT =
        config.codexAppServerEndpoint;
    } else {
      delete process.env.AGENTROOM_CODEX_APP_SERVER_ENDPOINT;
    }
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

async function sendRoomMessage(args: string[]): Promise<void> {
  const text = option(args, "--text");
  if (!text?.trim()) {
    throw new Error("--text is required and must be non-empty");
  }
  if (text.length > 8_000) {
    throw new Error("--text must be at most 8000 characters");
  }
  const { client, config } = await configuredClient(args);
  const attachments = await uploadWorkspaceFiles(
    client,
    config.workspace,
    options(args, "--file"),
  );
  const message = await client.sendTextMessage(
    text,
    attachments.map((attachment) => attachment.id),
  );
  console.log(JSON.stringify({ message, attachments }, null, 2));
}

async function printRoomHistory(args: string[]): Promise<void> {
  const afterSequence = integerOption(args, "--after-sequence", 0, 0);
  const limit = integerOption(args, "--limit", 50, 1, 200);
  const { client } = await configuredClient(args);
  const history = await client.listMessages(afterSequence, limit);
  console.log(JSON.stringify(history, null, 2));
}

async function downloadRoomAttachment(args: string[]): Promise<void> {
  const attachmentId = option(args, "--id");
  if (!attachmentId) {
    throw new Error("--id is required");
  }
  const { client, config } = await configuredClient(args);
  const downloaded = await downloadAttachmentToWorkspace(
    client,
    config.workspace,
    config.roomId,
    attachmentId,
  );
  console.log(
    JSON.stringify(
      {
        attachment: downloaded.attachment,
        localPath: downloaded.path,
      },
      null,
      2,
    ),
  );
}

async function dispatchAgentTask(args: string[]): Promise<void> {
  const text = option(args, "--text");
  const targets = option(args, "--targets")
    ?.split(",")
    .map((target) => target.trim())
    .filter(Boolean);
  const idempotencyKey = option(args, "--idempotency-key");
  if (!text?.trim() || text.length > 8_000) {
    throw new Error(
      "--text is required and must be between 1 and 8000 characters",
    );
  }
  if (!targets?.length || targets.length > 10) {
    throw new Error("--targets requires 1 to 10 comma-separated Agent member IDs");
  }
  if (
    !idempotencyKey ||
    idempotencyKey.length < 8 ||
    idempotencyKey.length > 100
  ) {
    throw new Error("--idempotency-key must be between 8 and 100 characters");
  }
  const { client, config } = await configuredClient(args);
  const attachments = await uploadWorkspaceFiles(
    client,
    config.workspace,
    options(args, "--file"),
  );
  const result = await client.sendAgentTask(
    text,
    [...new Set(targets)],
    idempotencyKey,
    attachments.map((attachment) => attachment.id),
  );
  console.log(JSON.stringify({ ...result, attachments }, null, 2));
}

async function issueAgentClaimCode(args: string[]): Promise<void> {
  const { client, config } = await configuredClient(args);
  if (!config.memberId) {
    throw new Error(
      "The bridge config has no memberId; join the room again before issuing an Agent claim code",
    );
  }
  const agentClaim = await client.issueAgentClaimCode(config.memberId);
  console.log(`Agent ownership claim code: ${agentClaim.code}`);
  console.log(
    `Claim this Agent from a signed-in room account before ${agentClaim.expiresAt}.`,
  );
}

async function configuredClient(
  args: string[],
): Promise<{
  client: AgentRoomClient;
  config: StoredBridgeConfig;
  configPath: string;
}> {
  const configPath = option(args, "--config") ?? positional(args, 0);
  if (!configPath) {
    throw new Error("--config is required");
  }
  const resolvedConfigPath = resolve(configPath);
  const config = parseStoredConfig(
    JSON.parse(await readFile(resolvedConfigPath, "utf8")) as unknown,
  );
  const accessToken =
    config.credentialStore === "keychain"
      ? await resolveKeychainToken(config)
      : config.accessToken;
  return {
    configPath: resolvedConfigPath,
    config,
    client: new AgentRoomClient({
      baseUrl: config.baseUrl,
      roomId: config.roomId,
      accessToken,
      httpTimeoutMs: 15_000,
      socketConnectTimeoutMs: 15_000,
      recoveryIntervalMs: 15_000,
    }),
  };
}

async function configureExistingBridge(args: string[]): Promise<void> {
  const configPath = option(args, "--config") ?? positional(args, 0);
  if (!configPath) {
    throw new Error("--config is required");
  }
  const resolvedConfigPath = resolve(configPath);
  let config = parseStoredConfig(
    JSON.parse(await readFile(resolvedConfigPath, "utf8")) as unknown,
  );
  const localCli = localCliInvocation();

  if (config.provider === "codex") {
    config = await ensureCodexSessionConfig(resolvedConfigPath, config);
    const codexCommand = resolveProviderExecutable(
      option(args, "--codex-command") ??
      process.env.AGENTROOM_CODEX_COMMAND ??
      "codex",
      "Codex",
    );
    configureCodexMcp(codexCommand, localCli, config.workspace);
    console.log(`Configured Codex MCP receiver ${codexReceiverServerName}.`);
    console.log("Start the connected Codex CLI with:");
    console.log(configuredStartCommand(resolvedConfigPath));
    return;
  }

  if (!config.memberId) {
    throw new Error(
      "The existing Claude config has no memberId; join the room again to create an MCP-managed config",
    );
  }
  const claudeCommand = resolveProviderExecutable(
    option(args, "--claude-command") ??
    process.env.AGENTROOM_CLAUDE_COMMAND ??
    "claude",
    "Claude Code",
  );
  const serverName = claudeServerName(config.roomId, config.memberId);
  configureClaudeMcp(
    claudeCommand,
    claudeMcpAddArgs(serverName, resolvedConfigPath, localCli),
    config.workspace,
  );
  console.log(`Configured Claude MCP channel ${serverName}.`);
  console.log("Start the connected Claude Code CLI with:");
  console.log(configuredStartCommand(resolvedConfigPath));
}

async function startConfiguredSession(args: string[]): Promise<void> {
  const configPath = option(args, "--config") ?? positional(args, 0);
  if (!configPath) {
    throw new Error("--config is required");
  }
  const resolvedConfigPath = resolve(configPath);
  let config = parseStoredConfig(
    JSON.parse(await readFile(resolvedConfigPath, "utf8")) as unknown,
  );
  if (!config.memberId) {
    throw new Error(
      "The bridge config has no memberId; join the room again before starting an interactive session",
    );
  }
  const noLaunch = args.includes("--no-launch") || !stdin.isTTY || !stdout.isTTY;
  const context: AgentRoomSessionContext = {
    roomId: config.roomId,
    memberId: config.memberId,
    displayName:
      config.displayName ?? (config.provider === "claude" ? "Claude" : "Codex"),
    workspace: config.workspace,
  };

  if (config.provider === "claude") {
    const claudeCommand = resolveProviderExecutable(
      option(args, "--claude-command") ??
      process.env.AGENTROOM_CLAUDE_COMMAND ??
      "claude",
      "Claude Code",
    );
    const serverName = claudeServerName(config.roomId, config.memberId);
    await launchOrPrint({
      command: claudeCommand,
      args: config.providerSession
        ? claudeResumeArgs(config.providerSession, serverName, context)
        : claudeStartArgs(serverName, context),
      workspace: config.workspace,
      configPath: resolvedConfigPath,
      noLaunch,
      label: "Claude Code",
    });
    return;
  }

  config = await ensureCodexSessionConfig(resolvedConfigPath, config);
  if (!config.stateFile || !config.codexAppServerEndpoint) {
    throw new Error("Codex session config upgrade did not produce local session paths");
  }
  const codexCommand = resolveProviderExecutable(
    option(args, "--codex-command") ??
    process.env.AGENTROOM_CODEX_COMMAND ??
    "codex",
    "Codex",
  );
  configureCodexMcp(
    codexCommand,
    localCliInvocation(),
    config.workspace,
  );
  const state = await loadCodexState(config.stateFile);
  await runCodexSession({
    codexCommand,
    configPath: resolvedConfigPath,
    stateFile: config.stateFile,
    endpoint: config.codexAppServerEndpoint,
    context,
    ...(state?.threadId ? { existingThreadId: state.threadId } : {}),
    injectConnection: !state?.threadId,
    noLaunch,
  });
}

interface CodexSessionOptions {
  codexCommand: string;
  configPath: string;
  stateFile: string;
  endpoint: string;
  context: AgentRoomSessionContext;
  existingThreadId?: string;
  injectConnection: boolean;
  noLaunch: boolean;
}

async function runCodexSession(options: CodexSessionOptions): Promise<void> {
  const hostLockPath = codexSessionHostLockPath(options.configPath);
  await mkdir(dirname(hostLockPath), { recursive: true, mode: 0o700 });
  const releaseHostLock = await acquireLock(hostLockPath);
  let host: Awaited<ReturnType<typeof startCodexSessionHost>> | undefined;
  let appServer: CodexAppServerClient | undefined;
  try {
    const releaseBridgeLock = await acquireLock(`${options.configPath}.lock`);
    let threadId: string;
    try {
      host = await startCodexSessionHost(
        options.codexCommand,
        options.context.workspace,
        options.endpoint,
      );
      appServer = new CodexAppServerClient(
        options.codexCommand,
        options.context.workspace,
        30_000,
        30 * 60_000,
        host.endpoint,
      );
      await appServer.start();
      const existingState = await loadCodexState(options.stateFile);
      const requestedThreadId = options.existingThreadId ?? existingState?.threadId;
      const developerInstructions = agentRoomConnectionPrompt(options.context);
      threadId = requestedThreadId
        ? await appServer.resumeThread(requestedThreadId, developerInstructions)
        : await appServer.startOrResumeThread(undefined, developerInstructions);
      await saveCodexState(options.stateFile, {
        ...existingState,
        threadId,
        resumeRequired: true,
      });

      if (options.injectConnection) {
        await appServer.runTurn(threadId, codexBootstrapPrompt(options.context));
        if (!requestedThreadId) {
          await appServer.setThreadName(
            threadId,
            `AgentRoom · ${safeDisplayName(options.context.displayName, "Codex")}`,
          );
        }
      }
    } finally {
      appServer?.close();
      appServer = undefined;
      await releaseBridgeLock();
    }

    const launchArgs = codexRemoteResumeArgs(
      threadId,
      options.endpoint,
    );
    if (options.noLaunch) {
      console.log("Codex session prepared. Start it later with:");
      console.log(configuredStartCommand(options.configPath));
      return;
    }

    console.log(
      `Starting Codex CLI for ${options.context.roomId}; AgentRoom tasks will appear in this session.`,
    );
    await runInteractive(
      options.codexCommand,
      launchArgs,
      options.context.workspace,
      "Codex CLI",
    );
  } finally {
    appServer?.close();
    await host?.close();
    await releaseHostLock();
  }
}

interface LaunchOptions {
  command: string;
  args: string[];
  workspace: string;
  configPath: string;
  noLaunch: boolean;
  label: string;
}

async function launchOrPrint(options: LaunchOptions): Promise<void> {
  if (options.noLaunch) {
    console.log(`${options.label} configured. Start it later with:`);
    console.log(configuredStartCommand(options.configPath));
    return;
  }
  console.log(`Starting ${options.label}; AgentRoom is attached to this session.`);
  await runInteractive(
    options.command,
    options.args,
    options.workspace,
    options.label,
  );
}

async function runInteractive(
  command: string,
  args: string[],
  workspace: string,
  label: string,
): Promise<void> {
  const child = spawn(command, args, {
    cwd: workspace,
    stdio: "inherit",
  });
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
          return;
        }
        reject(
          new Error(
            `${label} exited (${signal ?? `code ${code ?? "unknown"}`})`,
          ),
        );
      });
    });
  } finally {
    process.off("SIGINT", forwardInterrupt);
    process.off("SIGTERM", forwardTermination);
  }
}

async function ensureCodexSessionConfig(
  configPath: string,
  config: StoredBridgeConfig,
): Promise<StoredBridgeConfig> {
  if (!config.memberId) {
    throw new Error(
      "The existing Codex config has no memberId; join the room again to create an interactive session config",
    );
  }
  const stateFile =
    config.stateFile ??
    codexStatePath(config.workspace, config.roomId, config.memberId);
  const codexAppServerEndpoint =
    config.codexAppServerEndpoint ?? codexSessionEndpoint(configPath);
  if (
    config.stateFile === stateFile &&
    config.codexAppServerEndpoint === codexAppServerEndpoint
  ) {
    return config;
  }
  const upgraded: StoredBridgeConfig = {
    ...config,
    stateFile,
    codexAppServerEndpoint,
  };
  await saveStoredConfig(configPath, upgraded);
  console.log("Upgraded the Codex bridge config for visible Remote TUI delivery.");
  return upgraded;
}

async function saveStoredConfig(
  path: string,
  config: StoredBridgeConfig,
): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function configuredStartCommand(configPath: string): string {
  const cli = localCliInvocation();
  return commandLine(cli.command, [
    ...cli.args,
    "start",
    "--config",
    resolve(configPath),
  ]);
}

function safeDisplayName(value: string, fallback: string): string {
  return (
    value
      .replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, "")
      .replaceAll(/\s+/g, " ")
      .trim()
      .slice(0, 80) || fallback
  );
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
  const codexCommand = resolveProviderExecutable(
    option(args, "--codex-command") ??
    process.env.AGENTROOM_CODEX_COMMAND ??
    "codex",
    "Codex",
  );
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

function options(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) {
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${name} requires a value`);
    }
    values.push(value);
  }
  return values;
}

function positional(args: string[], index: number): string | undefined {
  return args.filter((value, valueIndex) => {
    if (value.startsWith("--")) {
      return false;
    }
    return valueIndex === 0 || !args[valueIndex - 1]?.startsWith("--");
  })[index];
}

function integerOption(
  args: string[],
  name: string,
  fallback: number,
  minimum: number,
  maximum?: number,
): number {
  const raw = option(args, name);
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum ?? "the safe integer limit"}`,
    );
  }
  return value;
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

function optionalObject(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const candidate = value[key];
  return typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : undefined;
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const candidate = value[key];
  return typeof candidate === "string" && candidate ? candidate : undefined;
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
  agentroom join <room-id> [--public | --invite CODE] [--provider claude|codex]
                 [--name NAME] [--base-url URL] [--workspace PATH]
                 [--credential-store file|keychain] [--no-launch]
                 [--manual-start]
  agentroom attach <room-id> [--public | --invite CODE] [--provider claude|codex]
                   [--session last|ID|NAME] [--name NAME]
                   [--base-url URL] [--workspace PATH]
                   [--credential-store file|keychain] [--no-launch]
                   [--manual-start]
  agentroom start --config PATH [--no-launch]
  agentroom send --config PATH --text TEXT [--file WORKSPACE_PATH ...]
  agentroom history --config PATH [--after-sequence N] [--limit 1..200]
  agentroom attachment --config PATH --id ATTACHMENT_ID
  agentroom dispatch --config PATH --targets MEMBER_ID[,MEMBER_ID]
                     --idempotency-key KEY --text TEXT
                     [--file WORKSPACE_PATH ...]
  agentroom claim-code --config PATH
  agentroom run --config PATH
  agentroom mcp [--workspace PATH]
  agentroom configure --config PATH
  agentroom update [--download-base URL]
  agentroom --version`);
}
