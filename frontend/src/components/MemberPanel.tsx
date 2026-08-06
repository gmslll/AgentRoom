import type { Member } from "../api/types";
import {
  selectMemberGroups,
  useMemberStore,
} from "../stores/memberStore";
import { providerLabel } from "../lib/provider";
import { Avatar } from "./Avatar";

interface MemberPanelProps {
  /** Whether the current user is the room owner (controls task dispatch affordances). */
  isOwner: boolean;
  /** Called when the user wants to dispatch a task to a specific agent. */
  onDispatchTask?: (memberId: string) => void;
}

/**
 * Squad view: members grouped by type (humans / agents / terminals).
 * Membership means "joined", never "online" (no presence in this MVP).
 */
export function MemberPanel({ isOwner, onDispatchTask }: MemberPanelProps) {
  const { humans, agents, terminals } = useMemberStore(selectMemberGroups);

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <MemberGroup
        title={`人类 (${humans.length})`}
        members={humans}
        isOwner={isOwner}
        onDispatchTask={onDispatchTask}
      />
      <MemberGroup
        title={`Agent (${agents.length})`}
        members={agents}
        isOwner={isOwner}
        onDispatchTask={onDispatchTask}
      />
      <MemberGroup
        title={`终端 (${terminals.length})`}
        members={terminals}
        isOwner={isOwner}
        onDispatchTask={onDispatchTask}
      />
    </div>
  );
}

interface MemberGroupProps {
  title: string;
  members: Member[];
  isOwner: boolean;
  onDispatchTask?: (memberId: string) => void;
}

function MemberGroup({
  title,
  members,
  isOwner,
  onDispatchTask,
}: MemberGroupProps) {
  if (members.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {title}
      </h4>
      <ul className="space-y-1">
        {members.map((member) => (
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
              <p className="truncate text-sm text-text">{member.displayName}</p>
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
          </li>
        ))}
      </ul>
    </div>
  );
}
