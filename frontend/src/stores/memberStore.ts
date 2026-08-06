import { create } from "zustand";
import type { Member } from "../api/types";

export interface MemberGroups {
  humans: Member[];
  agents: Member[];
  terminals: Member[];
}

function computeGroups(byId: Record<string, Member>): MemberGroups {
  const humans: Member[] = [];
  const agents: Member[] = [];
  const terminals: Member[] = [];
  for (const member of Object.values(byId)) {
    if (member.actorType === "agent") agents.push(member);
    else if (member.actorType === "terminal") terminals.push(member);
    else humans.push(member);
  }
  return { humans, agents, terminals };
}

const EMPTY_GROUPS: MemberGroups = { humans: [], agents: [], terminals: [] };

interface MemberState {
  /** Members keyed by member.id. */
  byId: Record<string, Member>;
  /**
   * Stable derived groups, rebuilt only when members change. Select this
   * directly (never derive fresh arrays in a selector — that would loop
   * useSyncExternalStore).
   */
  groups: MemberGroups;
  setMembers: (members: Member[]) => void;
  upsertMember: (member: Member) => void;
  removeMember: (memberId: string) => void;
  reset: () => void;
}

export const useMemberStore = create<MemberState>()((set) => ({
  byId: {},
  groups: EMPTY_GROUPS,
  setMembers: (members) => {
    const byId = Object.fromEntries(members.map((m) => [m.id, m]));
    set({ byId, groups: computeGroups(byId) });
  },
  upsertMember: (member) =>
    set((state) => {
      const byId = { ...state.byId, [member.id]: member };
      return { byId, groups: computeGroups(byId) };
    }),
  removeMember: (memberId) =>
    set((state) => {
      const byId = { ...state.byId };
      delete byId[memberId];
      return { byId, groups: computeGroups(byId) };
    }),
  reset: () => set({ byId: {}, groups: EMPTY_GROUPS }),
}));

/** Stable selector: the grouped view reference only changes when members change. */
export const selectMemberGroups = (state: MemberState): MemberGroups =>
  state.groups;
