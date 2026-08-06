import type { DeliveryStatus } from "../api/types";

/**
 * Terminal-log delivery states: mono label + status glyph.
 * received means "delivered to the terminal", not "AI read".
 */
const META: Record<
  DeliveryStatus,
  { glyph: string; className: string; title: string }
> = {
  queued: { glyph: "●", className: "text-muted", title: "等待终端" },
  received: { glyph: "◐", className: "text-primary", title: "已送达终端" },
  running: { glyph: "◉", className: "text-warning", title: "AI 处理中" },
  replied: { glyph: "✓", className: "text-terminal", title: "已回复" },
  failed: { glyph: "✕", className: "text-danger", title: "执行失败" },
};

const LABEL: Record<DeliveryStatus, string> = {
  queued: "等待终端",
  received: "已送达终端",
  running: "AI 处理中",
  replied: "已回复",
  failed: "执行失败",
};

interface DeliveryStatusBadgeProps {
  status: DeliveryStatus;
  error?: string | null;
}

/** Compact terminal-style status pill for one AI delivery. */
export function DeliveryStatusBadge({
  status,
  error,
}: DeliveryStatusBadgeProps) {
  const meta = META[status];
  return (
    <span
      className={`font-data inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide ${meta.className}`}
      title={error ?? meta.title}
    >
      <span className={status === "running" ? "animate-spin-fast inline-block" : "inline-block"}>
        {meta.glyph}
      </span>
      {LABEL[status]}
    </span>
  );
}
