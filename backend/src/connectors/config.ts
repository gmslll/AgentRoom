import { resolve } from "node:path";

export interface AgentRoomClientConfig {
  baseUrl: string;
  roomId: string;
  accessToken: string;
  httpTimeoutMs: number;
  socketConnectTimeoutMs: number;
  recoveryIntervalMs: number;
}

export interface AgentRoomBridgeConfig extends AgentRoomClientConfig {
  workspace: string;
  sessionCardRoot: string;
  memberId?: string;
  displayName?: string;
}

export interface CodexBridgeConfig extends AgentRoomBridgeConfig {
  stateFile: string;
  codexCommand: string;
  codexAppServerEndpoint?: string;
  codexRequestTimeoutMs: number;
  codexTurnTimeoutMs: number;
}

export function loadAgentRoomBridgeConfig(
  env: NodeJS.ProcessEnv = process.env,
): AgentRoomBridgeConfig {
  const baseUrl = env.AGENTROOM_BASE_URL ?? "http://127.0.0.1:8787";
  const roomId = env.AGENTROOM_ROOM_ID;
  const accessToken = env.AGENTROOM_ACCESS_TOKEN;
  const workspace = resolve(env.AGENTROOM_WORKSPACE ?? process.cwd());
  const memberId = env.AGENTROOM_MEMBER_ID;
  const displayName = env.AGENTROOM_DISPLAY_NAME;

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
    workspace,
    ...(memberId ? { memberId } : {}),
    ...(displayName ? { displayName } : {}),
    sessionCardRoot: resolve(
      env.AGENTROOM_SESSION_CARD_ROOT ??
        resolve(workspace, ".agentroom", "session-cards"),
    ),
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
  const safeRoomId = common.roomId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");

  return {
    ...common,
    stateFile:
      env.AGENTROOM_STATE_FILE ??
      resolve(common.workspace, ".agentroom", `codex-${safeRoomId}.json`),
    codexCommand: env.AGENTROOM_CODEX_COMMAND ?? "codex",
    ...(env.AGENTROOM_CODEX_APP_SERVER_ENDPOINT
      ? {
          codexAppServerEndpoint: env.AGENTROOM_CODEX_APP_SERVER_ENDPOINT,
        }
      : {}),
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
