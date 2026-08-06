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
import { Avatar } from "./Avatar";
import { DeliveryStatusBadge } from "./DeliveryStatusBadge";

interface MessageBubbleProps {
  message: Message;
  /** Called when the user re-dispatches an agent reply to another AI. */
  onDispatchReply?: (message: Message) => void;
}

/** One message: plain text, agent task with delivery states, or agent reply. */
export function MessageBubble({ message, onDispatchReply }: MessageBubbleProps) {
  const { author } = message;

  if (message.kind === "agent.reply") {
    return <AgentReply message={message} onDispatch={onDispatchReply} />;
  }
  if (message.kind === "agent.task") {
    return <AgentTask message={message} />;
  }
  return (
    <div className="flex gap-3 px-4 py-2 hover:bg-surface/40">
      <Avatar
        displayName={author.displayName}
        actorType={author.actorType}
        agentProvider={author.agentProvider}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-text">
            {author.displayName}
          </span>
          <span className="text-xs text-muted">
            {formatMessageTimestamp(message.createdAt)}
          </span>
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-text/90">
          {message.text}
        </p>
      </div>
    </div>
  );
}

function AgentTask({ message }: MessageBubbleProps) {
  const [expanded, setExpanded] = useState(true);
  const deliveries = useDeliveryStore(
    useShallow((state) => selectDeliveriesForTask(state, message.id)),
  );

  return (
    <div className="px-4 py-2 hover:bg-surface/40">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="text-xs text-muted">{expanded ? "▾" : "▸"}</span>
        <span className="rounded-full border border-agent/30 bg-agent/10 px-2 py-0.5 text-xs font-medium text-agent">
          任务
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-text">
          {message.text}
        </span>
        <span className="text-xs text-muted">
          {formatMessageTimestamp(message.createdAt)}
        </span>
      </button>
      {expanded && (
        <div className="mt-2 ml-6 flex flex-col gap-1.5">
          {deliveries.length === 0 && (
            <span className="text-xs text-muted">等待 AI 接收…</span>
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
  const name = member?.displayName ?? "AI";
  const provider = member?.agentProvider ?? null;
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-text/80">
          <span className="text-muted">{providerLabel(provider)}</span>
          <span className="font-medium">{name}</span>
        </span>
        <DeliveryStatusBadge status={delivery.status} error={delivery.error} />
      </div>
      {delivery.error && (
        <p className="mt-1 break-words font-mono text-xs text-danger">
          {delivery.error}
        </p>
      )}
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
    <div className="border-l-2 border-agent/50 px-4 py-2 pl-5 hover:bg-surface/40">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <Avatar
          displayName={message.author.displayName}
          actorType="agent"
          agentProvider={message.author.agentProvider}
          size="sm"
        />
        <span className="text-xs text-muted">来自</span>
        <span className="text-xs font-medium text-agent">
          {providerLabel(message.author.agentProvider)} ·{" "}
          {message.author.displayName}
        </span>
        <span className="text-xs text-muted">
          {formatMessageTimestamp(message.createdAt)}
        </span>
      </button>
      {!collapsed && (
        <>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm text-text/90">
            {message.text}
          </p>
          {onDispatch && (
            <button
              type="button"
              onClick={() => onDispatch(message)}
              className="mt-2 rounded border border-agent/40 px-2 py-0.5 text-[11px] text-agent transition-colors hover:bg-agent/10"
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
