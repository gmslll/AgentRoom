import { createHash } from "node:crypto";
import {
  chmod,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

const maximumBundleSize = 20 * 1024 * 1024;

export interface CliUpdateResult {
  updated: boolean;
  version: string;
  sha256: string;
}

interface CliUpdateOptions {
  downloadBase: string;
  targetPath: string;
  currentVersion?: string;
  fetchImpl?: typeof fetch;
  manifestTimeoutMs?: number;
  bundleTimeoutMs?: number;
}

interface UpdateManifest {
  version: string;
  bundle: {
    name: string;
    sha256: string;
    size: number;
  };
}

export async function updateInstalledCli(
  options: CliUpdateOptions,
): Promise<CliUpdateResult> {
  const downloadBase = normalizeDownloadBase(options.downloadBase);
  const targetPath = resolve(options.targetPath);
  if (basename(targetPath) !== "agentroom.mjs") {
    throw new Error(
      "Self-update requires the globally installed agentroom.mjs launcher target",
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const releaseLock = await acquireUpdateLock(`${targetPath}.update.lock`);

  try {
    const manifestResponse = await fetchImpl(`${downloadBase}/manifest.json`, {
      headers: {
        accept: "application/json",
        "user-agent": "agentroom-cli-updater",
      },
      signal: AbortSignal.timeout(options.manifestTimeoutMs ?? 15_000),
    });
    if (!manifestResponse.ok) {
      throw new Error(
        `Could not download the AgentRoom CLI manifest (HTTP ${manifestResponse.status})`,
      );
    }
    const manifest = parseUpdateManifest(await manifestResponse.json());
    const currentSha256 = createHash("sha256")
      .update(await readFile(targetPath))
      .digest("hex");
    if (
      options.currentVersion &&
      compareCliVersions(manifest.version, options.currentVersion) < 0
    ) {
      return {
        updated: false,
        version: options.currentVersion,
        sha256: currentSha256,
      };
    }
    if (currentSha256 === manifest.bundle.sha256) {
      return {
        updated: false,
        version: manifest.version,
        sha256: manifest.bundle.sha256,
      };
    }

    const bundleResponse = await fetchImpl(
      `${downloadBase}/${encodeURIComponent(manifest.bundle.name)}`,
      {
        headers: {
          accept: "text/javascript",
          "user-agent": "agentroom-cli-updater",
        },
        signal: AbortSignal.timeout(options.bundleTimeoutMs ?? 30_000),
      },
    );
    if (!bundleResponse.ok) {
      throw new Error(
        `Could not download the AgentRoom CLI bundle (HTTP ${bundleResponse.status})`,
      );
    }
    const contentLength = Number(bundleResponse.headers.get("content-length"));
    if (
      Number.isFinite(contentLength) &&
      contentLength > maximumBundleSize
    ) {
      throw new Error("AgentRoom CLI bundle exceeds the update size limit");
    }
    const bundle = Buffer.from(await bundleResponse.arrayBuffer());
    const sha256 = createHash("sha256").update(bundle).digest("hex");
    if (
      bundle.length !== manifest.bundle.size ||
      sha256 !== manifest.bundle.sha256
    ) {
      throw new Error("AgentRoom CLI update checksum verification failed");
    }

    await replaceBundle(targetPath, bundle);
    return { updated: true, version: manifest.version, sha256 };
  } finally {
    await releaseLock();
  }
}

export function compareCliVersions(left: string, right: string): number {
  const leftVersion = parseCliVersion(left);
  const rightVersion = parseCliVersion(right);
  for (const key of ["major", "minor", "patch"] as const) {
    const difference = leftVersion[key] - rightVersion[key];
    if (difference !== 0) {
      return Math.sign(difference);
    }
  }
  if (!leftVersion.prerelease && !rightVersion.prerelease) {
    return 0;
  }
  if (!leftVersion.prerelease) {
    return 1;
  }
  if (!rightVersion.prerelease) {
    return -1;
  }

  const length = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length,
  );
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index];
    const rightIdentifier = rightVersion.prerelease[index];
    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }
    if (leftIdentifier === rightIdentifier) {
      continue;
    }
    const leftNumeric = /^\d+$/.test(leftIdentifier);
    const rightNumeric = /^\d+$/.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return Math.sign(Number(leftIdentifier) - Number(rightIdentifier));
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return leftIdentifier.localeCompare(rightIdentifier) < 0 ? -1 : 1;
  }
  return 0;
}

export function parseUpdateManifest(value: unknown): UpdateManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("AgentRoom CLI manifest is not an object");
  }
  const manifest = value as Record<string, unknown>;
  const files = asObject(manifest.files);
  const bundle = asObject(files.bundle);
  const version = manifest.version;
  const name = bundle.name;
  const sha256 = bundle.sha256;
  const size = bundle.size;
  if (
    manifest.schemaVersion !== 1 ||
    typeof version !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version) ||
    typeof name !== "string" ||
    !/^agentroom-v[0-9A-Za-z.-]+-[a-f0-9]{12}\.mjs$/.test(name) ||
    typeof sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(sha256) ||
    !Number.isSafeInteger(size) ||
    (size as number) <= 0 ||
    (size as number) > maximumBundleSize
  ) {
    throw new Error("AgentRoom CLI manifest has invalid bundle metadata");
  }
  return {
    version,
    bundle: { name, sha256, size: size as number },
  };
}

function normalizeDownloadBase(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "AgentRoom CLI download base must be an HTTP(S) URL without credentials, query, or hash",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function parseCliVersion(value: string): {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string[];
} {
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) {
    throw new Error(`Invalid AgentRoom CLI version: ${value}`);
  }
  const prerelease = match[4]?.split(".");
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    ...(prerelease ? { prerelease } : {}),
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

async function replaceBundle(targetPath: string, bundle: Buffer): Promise<void> {
  const temporaryPath = resolve(
    dirname(targetPath),
    `.agentroom.mjs.${process.pid}.${Date.now()}.tmp`,
  );
  await writeFile(temporaryPath, bundle, { flag: "wx", mode: 0o600 });
  await chmod(temporaryPath, 0o644);

  if (process.platform !== "win32") {
    try {
      await rename(temporaryPath, targetPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    return;
  }

  const backupPath = `${targetPath}.${process.pid}.${Date.now()}.backup`;
  try {
    await rename(targetPath, backupPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  try {
    await rename(temporaryPath, targetPath);
  } catch (error) {
    await rename(backupPath, targetPath).catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  await unlink(backupPath).catch(() => undefined);
}

async function acquireUpdateLock(path: string): Promise<() => Promise<void>> {
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
      let ownerPid: number;
      try {
        ownerPid = Number.parseInt(await readFile(path, "utf8"), 10);
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        throw readError;
      }
      if (
        Number.isSafeInteger(ownerPid) &&
        ownerPid > 0 &&
        processExists(ownerPid)
      ) {
        throw new Error("Another AgentRoom CLI update is already running");
      }
      await unlink(path).catch((unlinkError: NodeJS.ErrnoException) => {
        if (unlinkError.code !== "ENOENT") {
          throw unlinkError;
        }
      });
    }
  }
  throw new Error("Could not acquire the AgentRoom CLI update lock");
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
