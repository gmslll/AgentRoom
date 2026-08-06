import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";

export interface CodexBridgeState {
  threadId: string;
  resumeRequired?: true;
  connectionBootstrapPending?: true;
}

export async function loadCodexState(
  path: string,
): Promise<CodexBridgeState | undefined> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (
      typeof value === "object" &&
      value !== null &&
      "threadId" in value &&
      typeof value.threadId === "string"
    ) {
      const record = value as Record<string, unknown>;
      return {
        threadId: value.threadId,
        ...(record.resumeRequired === true ? { resumeRequired: true } : {}),
        ...(record.connectionBootstrapPending === true
          ? { connectionBootstrapPending: true }
          : {}),
      };
    }
    return undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      console.error(`Ignoring invalid Codex bridge state at ${path}:`, error.message);
      return undefined;
    }
    throw error;
  }
}

export async function saveCodexState(
  path: string,
  state: CodexBridgeState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}
