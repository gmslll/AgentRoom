import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Member } from "../api/types";
import { useMemberStore } from "../stores/memberStore";
import { MemberPanel } from "./MemberPanel";

const mocks = vi.hoisted(() => ({
  removeMember: {
    isPending: false,
    variables: null as string | null,
    mutateAsync: vi.fn(),
  },
}));

vi.mock("../api/hooks", () => ({
  useAgentAccess: () => ({ data: { agents: [] }, isPending: false }),
  useRemoveMember: () => mocks.removeMember,
}));

function member(
  id: string,
  displayName: string,
  role: "owner" | "member",
  actorType: "human" | "agent" = "human",
): Member {
  return {
    id,
    roomId: "room_example",
    displayName,
    actorType,
    agentProvider: actorType === "agent" ? "codex" : null,
    role,
    joinedAt: "2026-08-06T00:00:00.000Z",
  };
}

beforeEach(() => {
  mocks.removeMember.mutateAsync.mockReset();
  mocks.removeMember.variables = null;
  useMemberStore.getState().reset();
  useMemberStore.getState().setMembers([
    member("mem_owner", "Owner", "owner"),
    member("mem_guest", "Guest", "member"),
  ]);
});

describe("MemberPanel kick", () => {
  it("requires a second click to confirm removing a member", async () => {
    const user = userEvent.setup();
    render(<MemberPanel roomId="room_example" isOwner={true} />);

    await user.click(screen.getByRole("button", { name: "移出" }));
    // First click only arms the confirm state; no API call yet.
    expect(mocks.removeMember.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "确认移出" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "确认移出" }));
    expect(mocks.removeMember.mutateAsync).toHaveBeenCalledWith("mem_guest");
  });

  it("never offers removing the owner or shows controls to non-owners", () => {
    render(<MemberPanel roomId="room_example" isOwner={false} />);
    expect(screen.queryByRole("button", { name: /移出/ })).not.toBeInTheDocument();
  });
});
