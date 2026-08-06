import { spawnSync } from "node:child_process";
import { join, win32 } from "node:path";

interface ProbeResult {
  status: number | null;
  error?: Error;
}

interface ResolveProviderExecutableOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  locateOnWindows?: (command: string) => string[];
  probe?: (candidate: string) => ProbeResult;
}

/**
 * Resolves provider binaries before a room membership is created. Windows
 * native Claude installs live in a stable user-local path that may not be in
 * the current terminal's inherited PATH until it is restarted.
 */
export function resolveProviderExecutable(
  command: string,
  label: string,
  options: ResolveProviderExecutableOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const locateOnWindows =
    options.locateOnWindows ?? defaultWindowsLocator;
  const probe = options.probe ?? defaultProbe;
  const candidates = providerExecutableCandidates(
    command,
    label,
    platform,
    env,
    platform === "win32" ? locateOnWindows(command) : [],
  );
  let lastFailure: ProbeResult | undefined;
  for (const candidate of candidates) {
    const result = probe(candidate);
    if (!result.error && result.status === 0) {
      return candidate;
    }
    lastFailure = result;
  }

  const reason = lastFailure?.error?.message ??
    (lastFailure?.status === null || lastFailure === undefined
      ? "not found"
      : `exit status ${lastFailure.status}`);
  if (platform === "win32") {
    throw new Error(
      `${label} executable is unavailable (${reason}). Run 'where.exe ${command}' and '${command} --version' in a new PowerShell/CMD window. ` +
        `If it is not installed, install the ${label} CLI first; if it is installed elsewhere, pass its .exe path explicitly. ` +
        "Use --manual-start only when you intentionally want to save the AgentRoom bridge without configuring or launching the provider.",
    );
  }
  throw new Error(`${label} executable is unavailable: ${reason}`);
}

export function providerExecutableCandidates(
  command: string,
  label: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  located: string[],
): string[] {
  const candidates = [command];
  if (
    platform === "win32" &&
    label === "Claude Code" &&
    command.toLowerCase() === "claude" &&
    env.USERPROFILE
  ) {
    candidates.push(
      platform === "win32"
        ? win32.join(env.USERPROFILE, ".local", "bin", "claude.exe")
        : join(env.USERPROFILE, ".local", "bin", "claude.exe"),
    );
  }
  candidates.push(...located.filter((candidate) => candidate.trim()));
  return [...new Set(candidates)];
}

function defaultProbe(candidate: string): ProbeResult {
  const result = spawnSync(candidate, ["--version"], { stdio: "ignore" });
  return {
    status: result.status,
    ...(result.error ? { error: result.error } : {}),
  };
}

function defaultWindowsLocator(command: string): string[] {
  const result = spawnSync("where.exe", [command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return [];
  }
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
