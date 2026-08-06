import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { AgentDelivery, Message } from "../api/types";
import {
  selectDeliveriesForTask,
  useDeliveryStore,
} from "../stores/deliveryStore";
import { useMemberStore } from "../stores/memberStore";
import { formatMessageTimestamp } from "../lib/time";
import { providerLabel } from "../lib/provider";
import { DeliveryStatusBadge } from "./DeliveryStatusBadge";

interface MessageBubbleProps {
  message: Message;
  /** Called when the user re-dispatches an agent reply to another AI. */
  onDispatchReply?: (message: Message) => void;
}

/**
 * Messages render like a dispatch log: mono sequence number, author,
 * timestamp; tasks are instruction blocks with per-target delivery states;
 * replies are indented results with a violet rule.
 */
export function MessageBubble({ message, onDispatchReply }: MessageBubbleProps) {
  if (message.kind === "agent.reply") {
    return <AgentReply message={message} onDispatch={onDispatchReply} />;
  }
  if (message.kind === "agent.task") {
    return <AgentTask message={message} />;
  }
  return <PlainMessage message={message} />;
}

function PlainMessage({ message }: MessageBubbleProps) {
  const { author } = message;
  return (
    <div className="animate-message-in px-4 py-1.5 hover:bg-surface/60">
      <div className="flex items-baseline gap-2">
        <span className="font-data shrink-0 text-[10px] text-muted/70">
          #{message.sequence}
        </span>
        <span className="text-sm font-semibold text-text">
          {author.displayName}
        </span>
        <span className="font-data ml-auto shrink-0 text-[10px] text-muted/50">
          {formatMessageTimestamp(message.createdAt)}
        </span>
      </div>
      <p className="mt-0.5 whitespace-pre-wrap break-words pl-6 text-sm text-text/90">
        {message.text}
      </p>
    </div>
  );
}

function AgentTask({ message }: MessageBubbleProps) {
  const [expanded, setExpanded] = useState(true);
  const deliveries = useDeliveryStore(
    useShallow((state) => selectDeliveriesForTask(state, message.id)),
  );

  return (
    <div className="animate-message-in border-l border-agent/40 px-4 py-1.5 hover:bg-surface/60">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-baseline gap-2 text-left"
      >
        <span className="font-data shrink-0 text-[10px] text-agent">
          {expanded ? "▾" : "▸"} #{message.sequence} TASK
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-text">
          {message.text}
        </span>
        <span className="font-data shrink-0 text-[10px] text-muted/50">
          {formatMessageTimestamp(message.createdAt)}
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-1 pl-6">
          {deliveries.length === 0 && (
            <p className="font-data text-[11px] text-muted">
              ··· 等待终端接收
            </p>
          )}
          {deliveries.map((delivery) => (
            <TaskDeliveryRow key={delivery.id} delivery={delivery} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskDeliveryRow({ delivery }: { delivery: AgentDelivery }) {
  const member = useMemberFor(delivery.targetMemberId);
  const name = member?.displayName ?? "unknown";
  const provider = member?.agentProvider ?? null;
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-data truncate text-[11px] text-muted">
        {providerLabel(provider)} · {name}
      </span>
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
  const author = message.author;
  return (
    <div className="animate-message-in border-l-2 border-agent/60 bg-agent/[0.04] px-4 py-1.5 hover:bg-agent/[0.06]">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-baseline gap-2 text-left"
      >
        <span className="font-data shrink-0 text-[10px] text-agent">
          {collapsed ? "▸" : "▾"} #{message.sequence} RESULT
        </span>
        <span className="text-sm font-medium text-agent">
          {providerLabel(author.agentProvider)} · {author.displayName}
        </span>
        <span className="font-data ml-auto shrink-0 text-[10px] text-muted/50">
          {formatMessageTimestamp(message.createdAt)}
        </span>
      </button>
      {!collapsed && (
        <>
          <p className="mt-0.5 whitespace-pre-wrap break-words pl-6 text-sm text-text/90">
            {message.text}
          </p>
          {onDispatch && (
            <button
              type="button"
              onClick={() => onDispatch(message)}
              className="press font-data ml-6 mt-1.5 rounded border border-agent/30 px-2 py-0.5 text-[11px] text-agent hover:bg-agent/10"
              title="将这份回复作为上下文,派发给另一个 AI 继续处理"
            >
              转派给…
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Small helper to resolve a member for a delivery target. */
function useMemberFor(memberId: string) {
  return useMemberStore((state) => state.byId[memberId] ?? null);
}
