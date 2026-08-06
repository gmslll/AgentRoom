/**
 * Stable idempotency keys for agent tasks. Generated once on the first send
 * attempt and reused across network retries so the backend can deduplicate.
 */
export function newIdempotencyKey(prefix = "task"): string {
  const uuid = crypto.randomUUID
    ? crypto.randomUUID()
    : randomUuidFallback();
  return `${prefix}_${uuid}`;
}

/** RFC 4122 v4 fallback for environments without crypto.randomUUID. */
function randomUuidFallback(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
