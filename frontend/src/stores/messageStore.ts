import { create } from "zustand";
import type { Message } from "../api/types";

interface MessageState {
  /** Messages keyed by message.id (dedupe source of truth). */
  byId: Record<string, Message>;
  /** Highest sequence observed so far (realtime + HTTP watermark). */
  watermark: number;
  /** Whether older messages exist before the earliest loaded one. */
  hasOlder: boolean;
  upsertMessages: (messages: Message[]) => void;
  setHasOlder: (hasOlder: boolean) => void;
  reset: () => void;
}

/** Merge into the store, deduplicating by message.id. */
function upsertInto(
  byId: Record<string, Message>,
  messages: Message[],
): Record<string, Message> {
  const next = { ...byId };
  for (const message of messages) {
    next[message.id] = message;
  }
  return next;
}

export const useMessageStore = create<MessageState>()((set) => ({
  byId: {},
  watermark: 0,
  hasOlder: false,
  upsertMessages: (messages) =>
    set((state) => {
      const byId = upsertInto(state.byId, messages);
      const maxSequence = messages.reduce(
        (max, m) => Math.max(max, m.sequence),
        state.watermark,
      );
      return { byId, watermark: Math.max(state.watermark, maxSequence) };
    }),
  setHasOlder: (hasOlder) => set({ hasOlder }),
  reset: () => set({ byId: {}, watermark: 0, hasOlder: false }),
}));

/** All messages sorted by ascending room sequence. */
export const selectSortedMessages = (state: MessageState): Message[] =>
  Object.values(state.byId).sort((a, b) => a.sequence - b.sequence);

/** Earliest sequence currently held, or 0 when empty. */
export function earliestSequence(messages: Message[]): number {
  return messages.length > 0 ? messages[0].sequence : 0;
}
