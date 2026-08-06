import { describe, expect, it } from "vitest";
import type { Message } from "../api/types";
import {
  earliestSequence,
  selectSortedMessages,
  useMessageStore,
} from "./messageStore";

const roomId = "room_1";

function message(
  overrides: Partial<Message> & { id: string; sequence: number },
): Message {
  return {
    roomId,
    kind: "text",
    text: "hello",
    attachmentIds: [],
    targetMemberIds: [],
    inReplyToMessageId: null,
    idempotencyKey: null,
    author: {
      memberId: "mem_1",
      displayName: "Alice",
      actorType: "human",
      agentProvider: null,
    },
    createdAt: "2026-08-05T00:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  useMessageStore.getState().reset();
});

describe("messageStore", () => {
  it("deduplicates by message.id", () => {
    useMessageStore
      .getState()
      .upsertMessages([message({ id: "msg_1", sequence: 1, text: "v1" })]);
    useMessageStore
      .getState()
      .upsertMessages([
        message({ id: "msg_1", sequence: 1, text: "v1 (duplicate)" }),
      ]);
    const messages = selectSortedMessages(useMessageStore.getState());
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("v1 (duplicate)");
  });

  it("sorts by ascending sequence", () => {
    useMessageStore
      .getState()
      .upsertMessages([
        message({ id: "msg_3", sequence: 3 }),
        message({ id: "msg_1", sequence: 1 }),
        message({ id: "msg_2", sequence: 2 }),
      ]);
    const ids = selectSortedMessages(useMessageStore.getState()).map(
      (m) => m.id,
    );
    expect(ids).toEqual(["msg_1", "msg_2", "msg_3"]);
  });

  it("raises the watermark to the max observed sequence", () => {
    useMessageStore
      .getState()
      .upsertMessages([
        message({ id: "msg_1", sequence: 1 }),
        message({ id: "msg_2", sequence: 5 }),
      ]);
    expect(useMessageStore.getState().watermark).toBe(5);
  });

  it("earliestSequence returns 0 when empty", () => {
    expect(earliestSequence([])).toBe(0);
  });
});
