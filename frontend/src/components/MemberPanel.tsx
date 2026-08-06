import type { Member } from "../api/types";
import {
  selectMemberGroups,
  useMemberStore,
} from "../stores/memberStore";
import { providerLabel } from "../lib/provider";
import { Avatar } from "./Avatar";

interface MemberPanelProps {
  /** Whether the current user is the room owner (controls management affordances). */
  isOwner: boolean;
  /** Current user's member id inside this room. */
  myMemberId: string;
  /** Called when the user wants to dispatch a task to a specific agent. */
  onDispatchTask?: (memberId: string) => void;
  /** Called when the owner removes another member (never the owner themselves). */
  onRemoveMember?: (memberId: string) => void;
}

/**
 * Squad view: members grouped by type (humans / agents / terminals).
 * Online state is presence-driven, never guessed from the member list.
 */
export function MemberPanel({
  isOwner,
  myMemberId,
  onDispatchTask,
  onRemoveMember,
}: MemberPanelProps) {
  const { humans, agents, terminals } = useMemberStore(selectMemberGroups);
  const onlineById = useMemberStore((state) => state.onlineById);

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <MemberGroup
        title={`人类 (${humans.length})`}
        members={humans}
        isOwner={isOwner}
        myMemberId={myMemberId}
        onlineById={onlineById}
        onDispatchTask={onDispatchTask}
        onRemoveMember={onRemoveMember}
      />
      <MemberGroup
        title={`Agent (${agents.length})`}
        members={agents}
        isOwner={isOwner}
        myMemberId={myMemberId}
        onlineById={onlineById}
        onDispatchTask={onDispatchTask}
        onRemoveMember={onRemoveMember}
      />
      <MemberGroup
        title={`终端 (${terminals.length})`}
        members={terminals}
        isOwner={isOwner}
        myMemberId={myMemberId}
        onlineById={onlineById}
        onDispatchTask={onDispatchTask}
        onRemoveMember={onRemoveMember}
      />
    </div>
  );
}

interface MemberGroupProps {
  title: string;
  members: Member[];
  isOwner: boolean;
  myMemberId: string;
  onlineById: Record<string, boolean>;
  onDispatchTask?: (memberId: string) => void;
  onRemoveMember?: (memberId: string) => void;
}

function MemberGroup({
  title,
  members,
  isOwner,
  myMemberId,
  onlineById,
  onDispatchTask,
  onRemoveMember,
}: MemberGroupProps) {
  if (members.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h4>
      <ul className="space-y-1">
        {members.map((member) => {
          const canRemove =
            isOwner &&
            member.id !== myMemberId &&
            member.role !== "owner" &&
            Boolean(onRemoveMember);
          return (
            <li
              key={member.id}
              className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface"
            >
              <Avatar
                displayName={member.displayName}
                actorType={member.actorType}
                agentProvider={member.agentProvider}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm text-text">
                  <span className="truncate">{member.displayName}</span>
                  {onlineById[member.id] && (
                    <span
                      className="inline-block size-1.5 shrink-0 rounded-full bg-terminal"
                      title="在线"
                    />
                  )}
                </p>
                {member.actorType === "agent" && (
                  <p className="text-[10px] uppercase tracking-wide text-agent">
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
              {canRemove && (
                <button
                  type="button"
                  onClick={() => onRemoveMember?.(member.id)}
                  className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors hover:border-danger/50 hover:text-danger"
                  title="移除该成员并撤销其令牌"
                >
                  移除
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
