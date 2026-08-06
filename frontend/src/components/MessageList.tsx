import type { Ref } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Message } from "../api/types";
import { useMessageStore } from "../stores/messageStore";
import { MessageBubble } from "./MessageBubble";

interface MessageListProps {
  roomId: string;
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  /** Called when the user re-dispatches an agent reply to another AI. */
  onDispatchReply?: (message: Message) => void;
  /** Scroll container ref for auto-scroll control. */
  scrollRef?: Ref<HTMLDivElement>;
}

/** Scrollable message stream with "load older" at the top. */
export function MessageList({
  roomId,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onDispatchReply,
  scrollRef,
}: MessageListProps) {
  const messages = useMessageStore(
    useShallow((state) =>
      Object.values(state.byId)
        .filter((m) => m.roomId === roomId)
        .sort((a, b) => a.sequence - b.sequence),
    ),
  );

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-bg/25">
      <div className="signal-rule relative mx-auto max-w-5xl py-5">
        {hasOlder && (
          <div className="flex justify-center pb-2">
            <button
              type="button"
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className="press rounded-md border border-border bg-surface px-3 py-1 text-[11px] text-muted hover:border-border-strong hover:text-text disabled:opacity-50"
            >
              {loadingOlder ? "加载中…" : "加载更早的消息"}
            </button>
          </div>
        )}
        {messages.length === 0 ? (
          <div className="mx-4 my-12 border border-dashed border-border px-6 py-12 text-center sm:mx-6">
            <p className="eyebrow">No room traffic</p>
            <p className="mt-3 text-sm font-semibold text-text">
              这条信号线上还没有消息
            </p>
            <p className="mt-1 text-xs text-muted">
              发送普通消息，或从接入面板连接本地 Agent。
            </p>
          </div>
        ) : (
          messages.map((message: Message) => (
            <MessageBubble
              key={message.id}
              message={message}
              onDispatchReply={onDispatchReply}
            />
          ))
        )}
      </div>
    </div>
  );
}
