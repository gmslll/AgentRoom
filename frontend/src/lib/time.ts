const pad = (n: number): string => String(n).padStart(2, "0");

/** "14:05" — local time of an ISO timestamp. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "2026-08-05" — local date of an ISO timestamp. */
export function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Short human-friendly label: today → time, otherwise date. */
export function formatMessageTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay ? formatTime(iso) : formatDate(iso);
}
