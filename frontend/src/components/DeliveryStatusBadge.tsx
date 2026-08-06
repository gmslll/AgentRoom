import type { DeliveryStatus } from "../api/types";

const STYLE: Record<DeliveryStatus, string> = {
  queued: "text-muted border-border",
  received: "text-primary border-primary/40",
  running: "text-warning border-warning/40",
  replied: "text-terminal border-terminal/40",
  failed: "text-danger border-danger/40",
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
