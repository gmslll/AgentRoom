import { createHash, randomBytes, randomUUID } from "node:crypto";

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export function createSecret(prefix: string, bytes = 24): string {
  return `${prefix}_${randomBytes(bytes).toString("base64url")}`;
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}
