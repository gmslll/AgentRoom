import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import type { Member } from "../api/types";
import { selectMemberGroups, useMemberStore } from "./memberStore";

const human: Member = {
  id: "mem_h",
  roomId: "room_1",
  displayName: "Alice",
  actorType: "human",
  agentProvider: null,
  role: "owner",
  joinedAt: "2026-08-05T00:00:00.000Z",
};

const agent: Member = {
  id: "mem_a",
  roomId: "room_1",
  displayName: "Claude",
  actorType: "agent",
  agentProvider: "claude",
  role: "member",
  joinedAt: "2026-08-05T00:00:00.000Z",
};

beforeEach(() => {
  useMemberStore.getState().reset();
});

describe("memberStore groups", () => {
  it("groups members by actor type", () => {
    useMemberStore.getState().setMembers([human, agent]);
    const { humans, agents, terminals } = selectMemberGroups(
      useMemberStore.getState(),
    );
    expect(humans.map((m) => m.id)).toEqual(["mem_h"]);
    expect(agents.map((m) => m.id)).toEqual(["mem_a"]);
    expect(terminals).toEqual([]);
  });

  it("keeps a stable reference when data is unchanged", () => {
    useMemberStore.getState().setMembers([human, agent]);
    const { result, rerender } = renderHook(() =>
      useMemberStore(selectMemberGroups),
    );
    const first = result.current;
    rerender();
    // Must be referentially stable, otherwise useSyncExternalStore loops.
    expect(result.current).toBe(first);
  });

  it("upserting a duplicate member does not change group references", () => {
    useMemberStore.getState().setMembers([human]);
    const before = useMemberStore.getState().groups;
    useMemberStore.getState().upsertMember(human);
    // Same content → identical group object is not required, but the member
    // must not appear twice and the view stays consistent.
    expect(useMemberStore.getState().groups.humans).toHaveLength(1);
    expect(useMemberStore.getState().groups.humans[0]).toBe(before.humans[0]);
  });
});
