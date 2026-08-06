import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Member } from "../api/types";
import { useMemberStore } from "../stores/memberStore";
import { TaskComposer } from "./TaskComposer";

const mocks = vi.hoisted(() => ({
  access: {
    data: {
      agents: [
        { agentMemberId: "mem_allowed", ownedByMe: false, canDispatch: true },
        { agentMemberId: "mem_blocked", ownedByMe: false, canDispatch: false },
      ],
    },
    isPending: false,
  },
  mutateAsync: vi.fn(),
}));

vi.mock("../api/hooks", () => ({
  useAgentAccess: () => mocks.access,
  useSendTask: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }),
  useSendText: () => ({ isPending: false, mutateAsync: mocks.mutateAsync }),
  useUploadAttachment: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

const member = (id: string, displayName: string): Member => ({
  id,
  roomId: "room_example",
  displayName,
  actorType: "agent",
  agentProvider: "codex",
  role: "member",
  joinedAt: "2026-08-06T00:00:00.000Z",
});

beforeEach(() => {
  mocks.mutateAsync.mockReset();
  useMemberStore
    .getState()
    .setMembers([
      member("mem_allowed", "可派发 Codex"),
      member("mem_blocked", "未授权 Claude"),
    ]);
});

describe("TaskComposer Agent target access", () => {
  it("shows only agents granted to the current account", async () => {
    const user = userEvent.setup();
    render(<TaskComposer roomId="room_example" />);

    await user.click(screen.getByRole("button", { name: "@ Agent 派发" }));

    expect(screen.getByText(/可派发 Codex/)).toBeInTheDocument();
    expect(screen.queryByText(/未授权 Claude/)).not.toBeInTheDocument();
  });
});
