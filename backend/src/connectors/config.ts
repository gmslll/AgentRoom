import { resolve } from "node:path";

export interface AgentRoomBridgeConfig {
  baseUrl: string;
  roomId: string;
  accessToken: string;
  httpTimeoutMs: number;
  socketConnectTimeoutMs: number;
  recoveryIntervalMs: number;
}

export interface CodexBridgeConfig extends AgentRoomBridgeConfig {
  workspace: string;
  stateFile: string;
  codexCommand: string;
  codexRequestTimeoutMs: number;
  codexTurnTimeoutMs: number;
}

export function loadAgentRoomBridgeConfig(
  env: NodeJS.ProcessEnv = process.env,
): AgentRoomBridgeConfig {
  const baseUrl = env.AGENTROOM_BASE_URL ?? "http://127.0.0.1:8787";
  const roomId = env.AGENTROOM_ROOM_ID;
  const accessToken = env.AGENTROOM_ACCESS_TOKEN;

  if (!roomId) {
    throw new Error("AGENTROOM_ROOM_ID is required");
  }
  if (!accessToken) {
    throw new Error("AGENTROOM_ACCESS_TOKEN is required");
  }

  const url = new URL(baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("AGENTROOM_BASE_URL must use http or https");
  }

  return {
    baseUrl: url.toString().replace(/\/$/, ""),
    roomId,
    accessToken,
    httpTimeoutMs: positiveInteger(
      env.AGENTROOM_HTTP_TIMEOUT_MS,
      15_000,
      "AGENTROOM_HTTP_TIMEOUT_MS",
    ),
    socketConnectTimeoutMs: positiveInteger(
      env.AGENTROOM_SOCKET_CONNECT_TIMEOUT_MS,
      15_000,
      "AGENTROOM_SOCKET_CONNECT_TIMEOUT_MS",
    ),
    recoveryIntervalMs: positiveInteger(
      env.AGENTROOM_RECOVERY_INTERVAL_MS,
      15_000,
      "AGENTROOM_RECOVERY_INTERVAL_MS",
    ),
  };
}

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  if (raw === undefined) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function loadCodexBridgeConfig(
  env: NodeJS.ProcessEnv = process.env,
): CodexBridgeConfig {
  const common = loadAgentRoomBridgeConfig(env);
  const workspace = resolve(env.AGENTROOM_WORKSPACE ?? process.cwd());
  const safeRoomId = common.roomId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");

  return {
    ...common,
    workspace,
    stateFile:
      env.AGENTROOM_STATE_FILE ??
      resolve(workspace, ".agentroom", `codex-${safeRoomId}.json`),
    codexCommand: env.AGENTROOM_CODEX_COMMAND ?? "codex",
    codexRequestTimeoutMs: positiveInteger(
      env.AGENTROOM_CODEX_REQUEST_TIMEOUT_MS,
      30_000,
      "AGENTROOM_CODEX_REQUEST_TIMEOUT_MS",
    ),
    codexTurnTimeoutMs: positiveInteger(
      env.AGENTROOM_CODEX_TURN_TIMEOUT_MS,
      30 * 60_000,
      "AGENTROOM_CODEX_TURN_TIMEOUT_MS",
    ),
  };
}
