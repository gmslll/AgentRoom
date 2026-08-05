import { resolve } from "node:path";
import type { CodexThreadSummary } from "./codex/app-server-client.js";

export interface CommandInvocation {
  command: string;
  args: string[];
}

export function resolveCodexThread(
  threads: CodexThreadSummary[],
  selector: string,
): CodexThreadSummary {
  const normalized = selector.trim();
  if (!normalized) {
    throw new Error("A Codex session selection is required");
  }
  if (normalized === "last") {
    const latest = threads[0];
    if (!latest) {
      throw new Error("No saved Codex sessions were found in this workspace");
    }
    return latest;
  }

  if (/^[1-9][0-9]*$/.test(normalized)) {
    const selected = threads[Number(normalized) - 1];
    if (!selected) {
      throw new Error(`Codex session number ${normalized} is out of range`);
    }
    return selected;
  }

  const byId = threads.find((thread) => thread.id === normalized);
  if (byId) {
    return byId;
  }
  const byName = threads.filter((thread) => thread.name === normalized);
  if (byName.length === 1) {
    return byName[0]!;
  }
  if (byName.length > 1) {
    throw new Error(
      `Multiple Codex sessions are named ${JSON.stringify(normalized)}; use a thread ID`,
    );
  }

  return { id: normalized };
}

export function assertCodexThreadAttachable(
  thread: CodexThreadSummary,
): void {
  if (thread.status && thread.status !== "notLoaded") {
    throw new Error(
      `Codex session ${thread.id} is ${thread.status}; finish its current turn and close it before attaching`,
    );
  }
}

export function formatCodexThread(
  thread: CodexThreadSummary,
  index: number,
): string {
  const title = thread.name ?? thread.preview ?? "Untitled session";
  const compactTitle = terminalSafe(title)
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const updated = thread.updatedAt
    ? new Date(thread.updatedAt * 1_000).toISOString()
    : "unknown time";
  const threadId = terminalSafe(thread.id);
  const status = terminalSafe(thread.status ?? "unknown");
  return `${index + 1}. ${compactTitle} (${threadId}, ${updated}, ${status})`;
}

export function codexStatePath(
  workspace: string,
  roomId: string,
  memberId: string,
): string {
  return resolve(
    workspace,
    ".agentroom",
    `codex-${safeSegment(roomId)}-${safeSegment(memberId)}.json`,
  );
}

export function claudeServerName(roomId: string, memberId: string): string {
  return `agentroom_${safeSegment(roomId).slice(-16)}_${safeSegment(memberId).slice(-8)}`;
}

export function claudeMcpAddArgs(
  serverName: string,
  configPath: string,
  cli: CommandInvocation,
): string[] {
  return [
    "mcp",
    "add",
    "--transport",
    "stdio",
    "--scope",
    "local",
    serverName,
    "--",
    cli.command,
    ...cli.args,
    "run",
    "--config",
    configPath,
  ];
}

export function localCliInvocation(
  entry = process.env.AGENTROOM_CLI_ENTRY ?? process.argv[1],
  executable = process.execPath,
): CommandInvocation {
  if (!entry) {
    throw new Error("Could not determine the local AgentRoom CLI entrypoint");
  }
  return { command: executable, args: [resolve(entry)] };
}

export function claudeResumeArgs(
  session: string,
  serverName: string,
): string[] {
  const channelArgs = [
    "--dangerously-load-development-channels",
    `server:${serverName}`,
  ];
  return session === "last"
    ? ["--continue", ...channelArgs]
    : ["--resume", session, ...channelArgs];
}

export function commandLine(
  command: string,
  args: string[],
  platform = process.platform,
): string {
  if (platform === "win32") {
    return `& ${[command, ...args].map(powerShellQuote).join(" ")}`;
  }
  return [command, ...args].map(shellQuote).join(" ");
}

function safeSegment(value: string): string {
  return value.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
}

function terminalSafe(value: string): string {
  return value.replaceAll(/[\u0000-\u001f\u007f-\u009f]/g, "");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function powerShellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
