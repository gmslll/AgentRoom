import { useState } from "react";
import type { Member } from "../api/types";
import { ApiError } from "../api/client";
import { useRemoveMember } from "../api/hooks";
import {
  selectMemberGroups,
  useMemberStore,
} from "../stores/memberStore";
import { providerLabel } from "../lib/provider";
import { Avatar } from "./Avatar";

interface MemberPanelProps {
  /** Whether the current user is the room owner (controls management affordances). */
  isOwner: boolean;
  roomId: string;
  /** Called when the user wants to dispatch a task to a specific agent. */
  onDispatchTask?: (memberId: string) => void;
}

/**
 * Squad view: members grouped by type (humans / agents / terminals).
 * Membership and online presence are separate: every member stays listed,
 * while the status dot follows the presence snapshot and realtime events.
 */
export function MemberPanel({
  roomId,
  isOwner,
  onDispatchTask,
}: MemberPanelProps) {
  const { humans, agents, terminals } = useMemberStore(selectMemberGroups);
  const onlineById = useMemberStore((state) => state.onlineById);
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
      setError(
        cause instanceof ApiError ? cause.message : "移出成员失败,请重试",
      );
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
  };

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {error && (
        <p className="rounded-md border border-danger/30 bg-danger/5 px-2 py-1.5 text-xs text-danger">
          {error}
        </p>
      )}
      <MemberGroup title={`人类 (${humans.length})`} members={humans} {...shared} />
      <MemberGroup title={`Agent (${agents.length})`} members={agents} {...shared} />
      <MemberGroup
        title={`终端 (${terminals.length})`}
        members={terminals}
        {...shared}
      />
    </div>
  );
}

interface MemberGroupProps {
  title: string;
  members: Member[];
  isOwner: boolean;
  onDispatchTask?: (memberId: string) => void;
  confirmMemberId: string | null;
  removingMemberId: string | null;
  onKick: (memberId: string) => void;
  onlineById: Record<string, boolean>;
}

function MemberGroup({
  title,
  members,
  isOwner,
  onDispatchTask,
  confirmMemberId,
  removingMemberId,
  onKick,
  onlineById,
}: MemberGroupProps) {
  if (members.length === 0) return null;
  return (
    <div>
      <h4 className="font-data mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h4>
      <ul className="space-y-1">
        {members.map((member) => (
          <li
            key={member.id}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface"
          >
            <div className="relative shrink-0">
              <Avatar
                displayName={member.displayName}
                actorType={member.actorType}
                agentProvider={member.agentProvider}
                size="sm"
              />
              <span
                title={onlineById[member.id] ? "在线" : "离线"}
                className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg ${
                  onlineById[member.id] ? "bg-terminal" : "bg-muted"
                }`}
              />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-text">{member.displayName}</p>
              <p
                className={`font-data text-[10px] uppercase tracking-[0.14em] ${
                  onlineById[member.id] ? "text-terminal" : "text-muted"
                }`}
              >
                {onlineById[member.id] ? "在线" : "离线"}
              </p>
              {member.role === "owner" && (
                <p className="font-data text-[10px] uppercase tracking-[0.14em] text-primary">
                  房主
                </p>
              )}
              {member.actorType === "agent" && (
                <p className="font-data text-[10px] uppercase tracking-[0.14em] text-agent">
                  {providerLabel(member.agentProvider)}
                </p>
              )}
            </div>
            {member.actorType === "agent" && isOwner && onDispatchTask && (
              <button
                type="button"
                onClick={() => onDispatchTask(member.id)}
                className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:border-primary/50 hover:text-primary"
              >
                派发任务
              </button>
            )}
            {isOwner && member.role !== "owner" && (
              <button
                type="button"
                onClick={() => onKick(member.id)}
                disabled={removingMemberId === member.id}
                className={`rounded border px-1.5 py-0.5 text-[11px] transition-colors disabled:opacity-50 ${
                  confirmMemberId === member.id
                    ? "border-danger bg-danger/10 text-danger"
                    : "border-border text-muted hover:border-danger/50 hover:text-danger"
                }`}
              >
                {removingMemberId === member.id
                  ? "移出中…"
                  : confirmMemberId === member.id
                    ? "确认移出"
                    : "移出"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
