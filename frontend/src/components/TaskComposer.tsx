import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { useSendTask, useSendText } from "../api/hooks";
import { useShallow } from "zustand/react/shallow";
import { newIdempotencyKey } from "../lib/idempotency";
import { providerLabel } from "../lib/provider";
import { useMemberStore } from "../stores/memberStore";

export interface TaskComposerPreset {
  /** Unique token per preset; changing it re-applies the preset. */
  key: string;
  text?: string;
  targetMemberIds?: string[];
}

interface TaskComposerProps {
  roomId: string;
  isOwner: boolean;
  /** Preset that opens dispatch mode with pre-filled text/targets. */
  preset?: TaskComposerPreset | null;
}

const MAX_TARGETS = 10;

/**
 * Message input. Ordinary text never triggers AI; only the room owner can
 * switch into task-dispatch mode and select explicit agent targets. The
 * idempotency key is generated once per dispatch and reused across retries.
 */
export function TaskComposer({ roomId, isOwner, preset }: TaskComposerProps) {
  const [text, setText] = useState("");
  const [dispatchMode, setDispatchMode] = useState(false);
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);

  // Apply a dispatch preset (e.g. "re-dispatch this reply" or "dispatch to
  // this member") each time its key changes.
  useEffect(() => {
    if (!preset) return;
    setText(preset.text ?? "");
    setTargets(new Set(preset.targetMemberIds ?? []));
    setDispatchMode(true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.key]);

  const sendText = useSendText(roomId);
  const sendTask = useSendTask(roomId);
  const agents = useMemberStore(
    useShallow((state) =>
      Object.values(state.byId).filter((m) => m.actorType === "agent"),
    ),
  );

  const canSendText = text.trim().length > 0 && !sendText.isPending;
  const canDispatch = text.trim().length > 0 && targets.size > 0 && !sendTask.isPending;

  const handleSendText = async () => {
    const value = text.trim();
    if (!value) return;
    setError(null);
    try {
      await sendText.mutateAsync({ text: value });
      setText("");
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const handleDispatch = async () => {
    const value = text.trim();
    if (!value || targets.size === 0) return;
    setError(null);
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = newIdempotencyKey();
    }
    const idempotencyKey = idempotencyKeyRef.current;
    try {
      await sendTask.mutateAsync({
        kind: "agent.task",
        text: value,
        targetMemberIds: [...targets],
        idempotencyKey,
      });
      idempotencyKeyRef.current = null;
      setText("");
      setTargets(new Set());
      setDispatchMode(false);
    } catch (err) {
      // Keep the same idempotency key for retries; it was never accepted.
      setError(messageOf(err));
    }
  };

  const toggleTarget = (memberId: string) => {
    setTargets((prev) => {
      const next = new Set(prev);
      if (next.has(memberId)) {
        next.delete(memberId);
      } else if (next.size < MAX_TARGETS) {
        next.add(memberId);
      }
      return next;
    });
  };

  const pending = sendText.isPending || sendTask.isPending;

  return (
    <div className="border-t border-border bg-surface/60 px-4 py-3">
      {dispatchMode && (
        <div className="mb-2">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-agent">
              派发任务给 AI(最多 {MAX_TARGETS} 个)
            </span>
            <button
              type="button"
              onClick={() => setDispatchMode(false)}
              className="text-xs text-muted hover:text-text"
            >
              取消
            </button>
          </div>
          {agents.length === 0 ? (
            <p className="text-xs text-muted">
              还没有 Agent 成员,先在上方接入你的本地 Agent。
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {agents.map((agent) => {
                const active = targets.has(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    onClick={() => toggleTarget(agent.id)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      active
                        ? "border-agent bg-agent/15 text-agent"
                        : "border-border text-muted hover:border-agent/40 hover:text-text"
                    }`}
                  >
                    {providerLabel(agent.agentProvider)} · {agent.displayName}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (dispatchMode) void handleDispatch();
              else void handleSendText();
            }
          }}
          rows={1}
          placeholder={
            dispatchMode
              ? "描述要 AI 执行的任务…(Enter 发送)"
              : "发送消息…(Enter 发送,Shift+Enter 换行)"
          }
          className="max-h-40 min-h-[38px] flex-1 resize-y rounded-lg border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted/60 focus:border-primary focus:outline-none"
        />
        {isOwner && !dispatchMode && (
          <button
            type="button"
            onClick={() => setDispatchMode(true)}
            disabled={agents.length === 0}
            className="rounded-lg border border-agent/40 px-3 py-2 text-sm text-agent transition-colors hover:bg-agent/10 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              agents.length === 0
                ? "先接入 Agent 成员"
                : "选择 AI 目标并派发任务"
            }
          >
            派发任务
          </button>
        )}
        <button
          type="button"
          onClick={() => (dispatchMode ? void handleDispatch() : void handleSendText())}
          disabled={dispatchMode ? !canDispatch : !canSendText}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          {pending ? "发送中…" : "发送"}
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </div>
  );
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "IDEMPOTENCY_KEY_REUSED") {
      return "该任务已用不同内容发送过,请换一段描述或目标重试";
    }
    return error.message;
  }
  return "发送失败,请重试";
}
