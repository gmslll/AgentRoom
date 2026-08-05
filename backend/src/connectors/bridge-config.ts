import { resolve } from "node:path";
import {
  KeychainSecretStore,
  credentialAccount,
} from "./secret-store.js";

export type Provider = "claude" | "codex";

export interface StoredBridgeConfig {
  version: 1;
  baseUrl: string;
  roomId: string;
  accessToken: string;
  provider: Provider;
  workspace: string;
  stateFile?: string;
  memberId?: string;
  credentialStore?: "keychain";
}

export function parseStoredConfig(value: unknown): StoredBridgeConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Bridge config must be a JSON object");
  }
  const config = value as Record<string, unknown>;
  const stateFile = optionalString(config, "stateFile");
  const memberId = optionalString(config, "memberId");
  const credentialStore =
    config.credentialStore === "keychain" ? "keychain" : undefined;
  // With the keychain store the token intentionally never lands in the file:
  // join writes an empty accessToken and run resolves it from the OS store.
  const accessToken =
    typeof config.accessToken === "string" ? config.accessToken : "";
  if (credentialStore !== "keychain" && !accessToken) {
    throw new Error("Bridge config is missing accessToken");
  }
  if (credentialStore === "keychain" && !memberId) {
    throw new Error(
      "Bridge config with credentialStore=keychain must include memberId",
    );
  }
  return {
    version: 1,
    baseUrl: normalizeBaseUrl(requiredString(config, "baseUrl")),
    roomId: requiredString(config, "roomId"),
    accessToken,
    provider: parseProvider(requiredString(config, "provider")),
    workspace: resolve(requiredString(config, "workspace")),
    ...(stateFile ? { stateFile: resolve(stateFile) } : {}),
    ...(memberId ? { memberId } : {}),
    ...(credentialStore ? { credentialStore } : {}),
  };
}

export async function resolveKeychainToken(
  config: StoredBridgeConfig,
): Promise<string> {
  if (!config.memberId) {
    throw new Error("Bridge config is missing memberId for the credential store");
  }
  const token = await new KeychainSecretStore().load(
    credentialAccount(config.roomId, config.memberId),
  );
  if (!token) {
    throw new Error(
      "The member token is missing from the OS credential store; run agentroom join again",
    );
  }
  return token;
}

export function parseProvider(value: string): Provider {
  if (value !== "claude" && value !== "codex") {
    throw new Error("Provider must be claude or codex");
  }
  return value;
}

export function normalizeBaseUrl(value: string): string {
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
