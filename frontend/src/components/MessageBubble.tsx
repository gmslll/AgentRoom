import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AgentDelivery, Message } from "../api/types";
import { formatMessageTimestamp } from "../lib/time";
import { providerLabel } from "../lib/provider";
import {
  selectDeliveriesForTask,
  useDeliveryStore,
} from "../stores/deliveryStore";
import { useMemberStore } from "../stores/memberStore";
import { AttachmentRefs } from "./AttachmentStrip";
import { Avatar } from "./Avatar";
import { DeliveryStatusBadge } from "./DeliveryStatusBadge";
import { Icon } from "./ui/Icon";

interface MessageBubbleProps {
  message: Message;
  onDispatchReply?: (message: Message) => void;
}

export function MessageBubble({
  message,
  onDispatchReply,
}: MessageBubbleProps) {
  if (message.kind === "agent.reply")
    return <AgentReply message={message} onDispatch={onDispatchReply} />;
  if (message.kind === "agent.task") return <AgentTask message={message} />;
  return <PlainMessage message={message} />;
}

function TimelineIndex({
  message,
  color = "muted",
}: {
  message: Message;
  color?: "muted" | "agent" | "primary";
}) {
  const style =
    color === "agent"
      ? "border-agent/50 text-agent"
      : color === "primary"
        ? "border-primary/50 text-primary"
        : "border-border-strong text-muted";
  return (
    <span
      className={`font-data relative z-10 grid size-8 shrink-0 place-items-center border bg-surface text-[9px] ${style}`}
    >
      {String(message.sequence).padStart(2, "0")}
    </span>
  );
}

function PlainMessage({ message }: { message: Message }) {
  return (
    <article className="animate-message-in relative flex gap-3 px-4 py-3 sm:px-6">
      <TimelineIndex message={message} />
      <div className="min-w-0 flex-1 border-b border-border/50 pb-3">
        <header className="flex items-center gap-2">
          <Avatar
            displayName={message.author.displayName}
            actorType={message.author.actorType}
            agentProvider={message.author.agentProvider}
            size="sm"
          />
          <span className="text-xs font-bold text-text">
            {message.author.displayName}
          </span>
          <span className="font-data ml-auto text-[9px] text-muted">
            {formatMessageTimestamp(message.createdAt)}
          </span>
        </header>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-text/90">
          {message.text}
        </p>
        {message.moderation?.state === "flagged" && (
          <ModerationFlag reason={message.moderation.reason} />
        )}
        <AttachmentRefs
          roomId={message.roomId}
          attachmentIds={message.attachmentIds}
        />
      </div>
    </article>
  );
}

function AgentTask({ message }: { message: Message }) {
  const [expanded, setExpanded] = useState(true);
  const deliveries = useDeliveryStore(
    useShallow((state) => selectDeliveriesForTask(state, message.id)),
  );
  return (
    <article className="animate-message-in relative flex gap-3 px-4 py-3 sm:px-6">
      <TimelineIndex message={message} color="agent" />
      <div className="min-w-0 flex-1 border border-agent/28 bg-agent/[0.035]">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-start gap-3 px-4 py-3 text-left"
        >
          <span className="grid size-7 shrink-0 place-items-center border border-agent/30 bg-agent/10 text-agent">
            <Icon name="bot" size={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-data block text-[9px] font-bold tracking-[0.12em] text-agent">
              TARGETED TASK
            </span>
            <span
              className={`mt-1 block text-sm leading-6 text-text ${expanded ? "" : "truncate"}`}
            >
              {message.text}
            </span>
          </span>
          <span className="font-data shrink-0 text-[9px] text-muted">
            {expanded ? "−" : "+"}
          </span>
        </button>
        {expanded && (
          <div className="border-t border-agent/15 px-4 py-3">
            <div className="space-y-2">
              {deliveries.length === 0 ? (
                <p className="font-data text-[9px] text-muted">
                  NO DELIVERY STATE YET
                </p>
              ) : (
                deliveries.map((delivery) => (
                  <TaskDeliveryRow key={delivery.id} delivery={delivery} />
                ))
              )}
            </div>
            {message.moderation?.state === "flagged" && (
              <ModerationFlag reason={message.moderation.reason} />
            )}
            <AttachmentRefs
              roomId={message.roomId}
              attachmentIds={message.attachmentIds}
            />
          </div>
        )}
      </div>
    </article>
  );
}

function TaskDeliveryRow({ delivery }: { delivery: AgentDelivery }) {
  const member = useMemberFor(delivery.targetMemberId);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-l border-border pl-3">
      <div className="min-w-0">
        <p className="truncate text-[11px] font-semibold text-text">
          {member?.displayName ?? "Unknown Agent"}
        </p>
        <p className="font-data mt-0.5 text-[8px] text-muted">
          {providerLabel(member?.agentProvider ?? null)} ·{" "}
          {delivery.id.slice(-8)}
        </p>
      </div>
      <DeliveryStatusBadge status={delivery.status} error={delivery.error} />
    </div>
  );
}

function AgentReply({
  message,
  onDispatch,
}: {
  message: Message;
  onDispatch?: (message: Message) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <article className="animate-message-in relative flex gap-3 px-4 py-3 sm:px-6">
      <TimelineIndex message={message} color="primary" />
      <div className="sheet cut-corner min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex w-full items-center gap-3 border-b border-black/10 px-4 py-3 text-left"
        >
          <span className="grid size-7 place-items-center border border-black/15 bg-black/5 text-ink">
            <Icon name="check" size={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="font-data block text-[8px] font-bold tracking-[0.12em] text-ink/55">
              AGENT DELIVERY
            </span>
            <span className="mt-0.5 block truncate text-xs font-bold text-ink">
              {providerLabel(message.author.agentProvider)} ·{" "}
              {message.author.displayName}
            </span>
          </span>
          <span className="font-data text-[8px] text-ink/45">
            {formatMessageTimestamp(message.createdAt)}
          </span>
        </button>
        {!collapsed && (
          <div className="px-4 py-4">
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-ink/90">
              {message.text}
            </p>
            {message.moderation?.state === "flagged" && (
              <ModerationFlag reason={message.moderation.reason} inverse />
            )}
            <AttachmentRefs
              roomId={message.roomId}
              attachmentIds={message.attachmentIds}
              inverse
            />
            {onDispatch && (
              <button
                type="button"
                onClick={() => onDispatch(message)}
                className="mt-4 inline-flex items-center gap-1.5 border border-black/20 px-3 py-1.5 font-data text-[9px] font-bold text-ink/70 transition-colors hover:border-black/40 hover:bg-black/5"
              >
                <Icon name="send" size={12} />
                继续派发
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function ModerationFlag({
  reason,
  inverse = false,
}: {
  reason?: string;
  inverse?: boolean;
}) {
  return (
    <div
      className={`mt-3 flex items-start gap-2 border-l-2 border-warning px-3 py-2 text-[10px] ${inverse ? "bg-black/5 text-ink/65" : "bg-warning/5 text-warning"}`}
    >
      <Icon name="shield" size={13} />
      <span>内容已标记{reason ? `：${reason}` : ""}</span>
    </div>
  );
}
function useMemberFor(memberId: string) {
  return useMemberStore((state) => state.byId[memberId] ?? null);
}
