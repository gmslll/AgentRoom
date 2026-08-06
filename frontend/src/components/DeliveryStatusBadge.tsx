import type { DeliveryStatus } from "../api/types";

const STYLE: Record<DeliveryStatus, string> = {
  queued: "text-muted border-border bg-white/[0.02]",
  received: "text-primary border-primary/40 bg-primary/[0.06]",
  running:
    "text-warning border-warning/40 bg-[linear-gradient(90deg,rgba(251,191,36,0.05),rgba(251,191,36,0.16),rgba(251,191,36,0.05))] bg-[length:200%_100%] animate-flow-x",
  replied:
    "text-terminal border-terminal/50 bg-terminal/[0.07] shadow-[0_0_12px_rgba(52,211,153,0.25)]",
  failed:
    "text-danger border-danger/50 bg-danger/[0.07] shadow-[0_0_12px_rgba(248,113,113,0.2)]",
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

/** Compact status pill for one AI delivery. */
export function DeliveryStatusBadge({
  status,
  error,
}: DeliveryStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${STYLE[status]}`}
      title={error ?? undefined}
    >
      {status === "running" && (
        <span className="inline-block size-2 animate-pulse rounded-full bg-warning" />
      )}
      {LABEL[status]}
    </span>
  );
}
