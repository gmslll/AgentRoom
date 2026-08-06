import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
} from "node:fs/promises";
import { basename, extname, isAbsolute, relative, resolve } from "node:path";
import {
  AgentRoomClient,
  type AgentRoomAttachment,
} from "./agentroom-client.js";

export const maximumLocalAttachmentBytes = 104_857_600;

export interface LocalAttachment {
  attachment: AgentRoomAttachment;
  path: string;
}

export async function uploadWorkspaceFiles(
  client: AgentRoomClient,
  workspace: string,
  paths: string[],
): Promise<AgentRoomAttachment[]> {
  if (paths.length > 10) {
    throw new Error("At most 10 files can be uploaded with one message");
  }
  const uniquePaths = [...new Set(paths)];
  const attachments: AgentRoomAttachment[] = [];
  for (const path of uniquePaths) {
    const file = await readWorkspaceFile(workspace, path);
    attachments.push(
      await client.uploadAttachment({
        name: file.name,
        mediaType: mediaTypeFor(file.name),
        bytes: file.bytes,
      }),
    );
  }
  return attachments;
}

export async function downloadAttachmentToWorkspace(
  client: AgentRoomClient,
  workspace: string,
  roomId: string,
  attachmentId: string,
): Promise<LocalAttachment> {
  assertSafeIdentifier(roomId, "room ID");
  assertSafeIdentifier(attachmentId, "attachment ID");
  const downloaded = await client.downloadAttachment(
    attachmentId,
    maximumLocalAttachmentBytes,
  );
  const workspaceRoot = await realpath(resolve(workspace));
  const directory = resolve(
    workspaceRoot,
    ".agentroom",
    "attachments",
    roomId,
    attachmentId,
  );
  await ensurePrivateDirectory(directory, workspaceRoot);
  const safeName = safeAttachmentName(downloaded.attachment.name);
  const path = resolve(directory, safeName);
  const flags =
    constants.O_WRONLY |
    constants.O_CREAT |
    constants.O_EXCL |
    (constants.O_NOFOLLOW ?? 0);
  try {
    const handle = await open(path, flags, 0o600);
    try {
      await handle.writeFile(downloaded.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    const existing = await lstat(path);
    if (!existing.isFile() || existing.isSymbolicLink()) {
      throw new Error(`Attachment destination is not a regular file: ${path}`);
    }
    const existingBytes = await readFile(path);
    if (
      createHash("sha256").update(existingBytes).digest("hex") !==
      createHash("sha256").update(downloaded.bytes).digest("hex")
    ) {
      throw new Error(`Attachment destination already contains different data: ${path}`);
    }
  }
  await chmod(path, 0o600);
  return { attachment: downloaded.attachment, path };
}

async function readWorkspaceFile(
  workspace: string,
  path: string,
): Promise<{ name: string; bytes: Uint8Array }> {
  const workspaceRoot = await realpath(resolve(workspace));
  const candidate = await realpath(resolve(workspaceRoot, path));
  if (!isWithin(workspaceRoot, candidate)) {
    throw new Error(`File must be inside the configured workspace: ${path}`);
  }
  const handle = await open(
    candidate,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      throw new Error(`Attachment path is not a regular file: ${path}`);
    }
    if (metadata.size <= 0) {
      throw new Error(`Attachment file is empty: ${path}`);
    }
    if (metadata.size > maximumLocalAttachmentBytes) {
      throw new Error(
        `Attachment ${path} exceeds ${maximumLocalAttachmentBytes} bytes`,
      );
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength !== metadata.size) {
      throw new Error(`Attachment changed while it was being read: ${path}`);
    }
    return { name: basename(candidate), bytes };
  } finally {
    await handle.close();
  }
}

async function ensurePrivateDirectory(
  directory: string,
  workspaceRoot: string,
): Promise<void> {
  if (!isWithin(workspaceRoot, directory)) {
    throw new Error("Attachment destination escaped the configured workspace");
  }
  const relativePath = relative(workspaceRoot, directory);
  let current = workspaceRoot;
  for (const segment of relativePath.split(/[\\/]+/).filter(Boolean)) {
    current = resolve(current, segment);
    await mkdir(current, { mode: 0o700 }).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
    });
    const metadata = await lstat(current);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Attachment directory is unsafe: ${current}`);
    }
    await chmod(current, 0o700);
  }
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(root, candidate);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function safeAttachmentName(value: string): string {
  const name = basename(value)
    .normalize("NFKC")
    .replaceAll(/[^\p{L}\p{N}._ -]/gu, "_")
    .replaceAll(/^\.+/g, "")
    .slice(0, 180);
  return name || "attachment.bin";
}

function assertSafeIdentifier(value: string, label: string): void {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(value)) {
    throw new Error(`Unsafe ${label}`);
  }
}

function mediaTypeFor(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".svg":
      return "image/svg+xml";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    case ".csv":
      return "text/csv";
    case ".md":
      return "text/markdown";
    case ".txt":
    case ".log":
      return "text/plain";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case ".zip":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}
