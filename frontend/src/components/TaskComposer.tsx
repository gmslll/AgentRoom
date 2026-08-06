import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ApiError } from "../api/client";
import { useAgentAccess, useSendTask, useSendText } from "../api/hooks";
import type { Attachment } from "../api/types";
import { newIdempotencyKey } from "../lib/idempotency";
import { providerLabel } from "../lib/provider";
import { useMemberStore } from "../stores/memberStore";
import { AttachmentPicker } from "./AttachmentStrip";
import { Icon } from "./ui/Icon";

export interface TaskComposerPreset {
  key: string;
  text?: string;
  targetMemberIds?: string[];
}

interface TaskComposerProps {
  roomId: string;
  preset?: TaskComposerPreset | null;
}
const MAX_TARGETS = 10;

export function TaskComposer({ roomId, preset }: TaskComposerProps) {
  const [text, setText] = useState("");
  const [dispatchMode, setDispatchMode] = useState(false);
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const idempotencyKeyRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendText = useSendText(roomId);
  const sendTask = useSendTask(roomId);
  const access = useAgentAccess(roomId);
  const allAgents = useMemberStore(
    useShallow((state) =>
      Object.values(state.byId).filter(
        (member) => member.actorType === "agent",
      ),
    ),
  );
  const allowedIds = new Set(
    (access.data?.agents ?? [])
      .filter((entry) => entry.canDispatch)
      .map((entry) => entry.agentMemberId),
  );
  const agents = allAgents.filter((agent) => allowedIds.has(agent.id));

  useEffect(() => {
    if (!preset) return;
    setText(preset.text ?? "");
    setTargets(
      new Set(
        (preset.targetMemberIds ?? []).filter((id) => allowedIds.has(id)),
      ),
    );
    setDispatchMode(true);
    setError(null);
    textareaRef.current?.focus();
    // `allowedIds` derives from query data; presets intentionally apply once by key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset?.key]);

  const pending = sendText.isPending || sendTask.isPending;
  const canSend = text.trim().length > 0 && !pending;
  const canDispatch = canSend && targets.size > 0;
  const attachmentIds = attachments.map((attachment) => attachment.id);

  const send = async () => {
    const value = text.trim();
    if (!value) return;
    setError(null);
    try {
      if (dispatchMode) {
        if (targets.size === 0) return;
        idempotencyKeyRef.current ??= newIdempotencyKey();
        await sendTask.mutateAsync({
          kind: "agent.task",
          text: value,
          targetMemberIds: [...targets],
          idempotencyKey: idempotencyKeyRef.current,
          ...(attachmentIds.length ? { attachmentIds } : {}),
        });
        idempotencyKeyRef.current = null;
        setTargets(new Set());
        setDispatchMode(false);
      } else {
        await sendText.mutateAsync({
          text: value,
          ...(attachmentIds.length ? { attachmentIds } : {}),
        });
      }
      setText("");
      setAttachments([]);
    } catch (cause) {
      setError(messageOf(cause));
    }
  };

  const toggleTarget = (memberId: string) =>
    setTargets((previous) => {
      const next = new Set(previous);
      if (next.has(memberId)) next.delete(memberId);
      else if (next.size < MAX_TARGETS) next.add(memberId);
      return next;
    });

  return (
    <div className="border-t border-border bg-surface/96 p-3 sm:px-5 sm:py-4">
      <div
        className={`mx-auto max-w-5xl border transition-colors ${dispatchMode ? "border-agent/40 bg-agent/[0.035]" : "border-border bg-bg/50"}`}
      >
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className={`size-1.5 ${dispatchMode ? "bg-agent" : "bg-human"}`}
            />
            <span className="font-data text-[9px] font-bold uppercase tracking-[0.12em] text-muted">
              {dispatchMode ? "TARGETED AGENT TASK" : "ROOM MESSAGE"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setDispatchMode((value) => !value);
              setTargets(new Set());
              setError(null);
            }}
            disabled={
              access.isPending || (agents.length === 0 && !dispatchMode)
            }
            className={`text-[10px] font-semibold ${dispatchMode ? "text-agent" : "text-muted hover:text-agent"}`}
          >
            {dispatchMode
              ? "切换为普通消息"
              : agents.length
                ? "@ Agent 派发"
                : "暂无可授权 Agent"}
          </button>
        </div>

        {dispatchMode && (
          <div className="border-b border-border/70 px-3 py-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold text-agent">
                选择任务目标
              </span>
              <span className="font-data text-[9px] text-muted">
                {targets.size}/{MAX_TARGETS}
              </span>
            </div>
            {agents.length === 0 ? (
              <p className="text-[11px] text-warning">
                当前账号没有可派发 Agent。请先在 Agent 权限面板领取或获得授权。
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
                      className={`inline-flex items-center gap-1.5 border px-2.5 py-1.5 text-[10px] transition-colors ${active ? "border-agent bg-agent/15 text-agent" : "border-border text-muted hover:border-agent/40 hover:text-text"}`}
                    >
                      <span
                        className={`size-1.5 ${active ? "bg-agent" : "bg-border-strong"}`}
                      />
                      {providerLabel(agent.agentProvider)} · {agent.displayName}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
          rows={2}
          maxLength={8000}
          placeholder={
            dispatchMode
              ? "描述任务目标、上下文和期望交付…"
              : "发送普通聊天，不会自动唤醒 AI…"
          }
          className="block max-h-48 min-h-20 w-full resize-y bg-transparent px-3 py-3 text-sm leading-6 text-text outline-none placeholder:text-muted/55"
        />

        <div className="flex items-end gap-2 border-t border-border/70 px-2 py-2">
          <AttachmentPicker
            roomId={roomId}
            attachments={attachments}
            onChange={setAttachments}
            disabled={pending}
          />
          <div className="min-w-0 flex-1">
            <p className="font-data hidden text-[9px] text-muted sm:block">
              ENTER SEND · SHIFT+ENTER NEW LINE · {text.length}/8000
            </p>
          </div>
          <button
            type="button"
            onClick={() => void send()}
            disabled={dispatchMode ? !canDispatch : !canSend}
            className="button-primary h-10 px-4 text-xs"
          >
            {pending ? "发送中…" : dispatchMode ? "派发任务" : "发送"}
            <Icon name="send" size={15} />
          </button>
        </div>
      </div>
      {error && (
        <p className="mx-auto mt-2 max-w-5xl text-[11px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "IDEMPOTENCY_KEY_REUSED")
      return "该幂等键已被不同任务使用，请重新编辑后发送";
    if (error.code === "AGENT_DISPATCH_NOT_AUTHORIZED")
      return "当前账号没有目标 Agent 的派发权限";
    return error.message;
  }
  return "发送失败，请重试";
}
