import { useState } from "react";
import { ApiError } from "../api/client";
import { useAgentAccess, useRemoveMember } from "../api/hooks";
import type { Member } from "../api/types";
import { providerLabel } from "../lib/provider";
import { selectMemberGroups, useMemberStore } from "../stores/memberStore";
import { Avatar } from "./Avatar";
import { Icon } from "./ui/Icon";

interface MemberPanelProps {
  isOwner: boolean;
  roomId: string;
  onDispatchTask?: (memberId: string) => void;
}

export function MemberPanel({
  roomId,
  isOwner,
  onDispatchTask,
}: MemberPanelProps) {
  const { humans, agents, terminals } = useMemberStore(selectMemberGroups);
  const onlineById = useMemberStore((state) => state.onlineById);
  const access = useAgentAccess(roomId);
  const dispatchable = new Set(
    (access.data?.agents ?? [])
      .filter((entry) => entry.canDispatch)
      .map((entry) => entry.agentMemberId),
  );
  const removeMember = useRemoveMember(roomId);
  const [confirmMemberId, setConfirmMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const kick = async (memberId: string) => {
    if (confirmMemberId !== memberId) {
      setConfirmMemberId(memberId);
      setError(null);
      return;
    }
    try {
      await removeMember.mutateAsync(memberId);
      setConfirmMemberId(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "移出成员失败");
    }
  };

  const shared = {
    isOwner,
    onDispatchTask,
    confirmMemberId,
    removingMemberId: removeMember.isPending
      ? (removeMember.variables ?? null)
      : null,
    onKick: kick,
    onlineById,
    dispatchable,
  };
  const onlineCount = Object.values(onlineById).filter(Boolean).length;
  return (
    <div className="space-y-6 p-4">
      <div className="grid grid-cols-2 gap-px border border-border bg-border">
        <div className="bg-surface p-3">
          <p className="eyebrow text-[8px]">Members</p>
          <p className="font-data mt-2 text-lg text-text">
            {humans.length + agents.length + terminals.length}
          </p>
        </div>
        <div className="bg-surface p-3">
          <p className="eyebrow text-[8px]">Online</p>
          <p className="font-data mt-2 text-lg text-primary">{onlineCount}</p>
        </div>
      </div>
      {error && (
        <p className="border-l-2 border-danger bg-danger/5 px-3 py-2 text-[11px] text-danger">
          {error}
        </p>
      )}
      <MemberGroup
        title="人类"
        code="HUMAN"
        color="human"
        members={humans}
        {...shared}
      />
      <MemberGroup
        title="Agent"
        code="AGENT"
        color="agent"
        members={agents}
        {...shared}
      />
      <MemberGroup
        title="终端"
        code="TERM"
        color="terminal"
        members={terminals}
        {...shared}
      />
    </div>
  );
}

interface MemberGroupProps {
  title: string;
  code: string;
  color: "human" | "agent" | "terminal";
  members: Member[];
  isOwner: boolean;
  onDispatchTask?: (memberId: string) => void;
  confirmMemberId: string | null;
  removingMemberId: string | null;
  onKick: (memberId: string) => void;
  onlineById: Record<string, boolean>;
  dispatchable: Set<string>;
}

function MemberGroup({
  title,
  code,
  color,
  members,
  isOwner,
  onDispatchTask,
  confirmMemberId,
  removingMemberId,
  onKick,
  onlineById,
  dispatchable,
}: MemberGroupProps) {
  if (!members.length) return null;
  const colorClass =
    color === "human"
      ? "text-human"
      : color === "agent"
        ? "text-agent"
        : "text-terminal";
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h4 className={`eyebrow text-[9px] ${colorClass}`}>
          {code} / {title}
        </h4>
        <span className="font-data text-[9px] text-muted">
          {members.length}
        </span>
      </div>
      <ul className="space-y-1.5">
        {members.map((member) => {
          const online = Boolean(onlineById[member.id]);
          const canDispatch =
            member.actorType === "agent" && dispatchable.has(member.id);
          return (
            <li
              key={member.id}
              className="group border border-transparent bg-bg/35 p-2.5 transition-colors hover:border-border hover:bg-surface-raised"
            >
              <div className="flex items-start gap-2.5">
                <div className="relative">
                  <Avatar
                    displayName={member.displayName}
                    actorType={member.actorType}
                    agentProvider={member.agentProvider}
                    size="sm"
                  />
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 size-2.5 border-2 border-surface ${online ? "animate-pulse-signal bg-primary" : "bg-border-strong"}`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-text">
                    {member.displayName}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 font-data text-[8px] uppercase text-muted">
                    <span>{online ? "online" : "offline"}</span>
                    {member.role === "owner" && (
                      <span className="text-primary">owner</span>
                    )}
                    {member.actorType === "agent" && (
                      <span className="text-agent">
                        {providerLabel(member.agentProvider)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {canDispatch && onDispatchTask && (
                  <button
                    type="button"
                    onClick={() => onDispatchTask(member.id)}
                    className="border border-agent/30 px-2 py-1 text-[9px] text-agent hover:bg-agent/10"
                  >
                    <Icon name="send" size={10} className="mr-1 inline" />
                    派发
                  </button>
                )}
                {member.actorType === "agent" && !canDispatch && (
                  <span className="border border-border px-2 py-1 text-[8px] text-muted">
                    未授权
                  </span>
                )}
                {isOwner && member.role !== "owner" && (
                  <button
                    type="button"
                    onClick={() => onKick(member.id)}
                    disabled={removingMemberId === member.id}
                    className={`border px-2 py-1 text-[9px] ${confirmMemberId === member.id ? "border-danger bg-danger/10 text-danger" : "border-border text-muted hover:text-danger"}`}
                  >
                    {removingMemberId === member.id
                      ? "移出中"
                      : confirmMemberId === member.id
                        ? "确认移出"
                        : "移出"}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
