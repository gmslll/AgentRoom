import { useMemo, useState } from "react";
import { ApiError } from "../api/client";
import {
  useAgentAccess,
  useClaimAgent,
  useGrantAgent,
  useRequestAgentCollaboration,
  useRespondAgentCollaboration,
  useRevokeAgentCollaboration,
  useRevokeAgentGrant,
} from "../api/hooks";
import type { AgentCollaboration } from "../api/types";
import { providerLabel } from "../lib/provider";
import { useMemberStore } from "../stores/memberStore";
import { Icon } from "./ui/Icon";

export function AgentAccessPanel({ roomId }: { roomId: string }) {
  const access = useAgentAccess(roomId);
  const members = useMemberStore((state) => state.byId);
  const agents = useMemo(
    () =>
      Object.values(members).filter((member) => member.actorType === "agent"),
    [members],
  );
  const humans = useMemo(
    () =>
      Object.values(members).filter((member) => member.actorType === "human"),
    [members],
  );
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const entries = access.data?.agents ?? [];
  const ownedIds = new Set(
    entries
      .filter((entry) => entry.ownedByMe)
      .map((entry) => entry.agentMemberId),
  );
  const ownedAgents = agents.filter((agent) => ownedIds.has(agent.id));
  const selectedOwnedId = ownedIds.has(selectedAgentId)
    ? selectedAgentId
    : (ownedAgents[0]?.id ?? "");

  if (access.isPending) return <PanelState text="正在同步 Agent 权限…" />;
  if (access.isError)
    return (
      <PanelState
        text={
          access.error instanceof ApiError
            ? access.error.message
            : "Agent 权限加载失败"
        }
        danger
      />
    );

  return (
    <div className="space-y-7 p-4">
      <section>
        <SectionTitle
          index="01"
          title="可派发 Agent"
          detail="权限来自所有权或用户授权，与房间 owner 身份无关。"
        />
        <div className="space-y-2">
          {agents.length === 0 ? (
            <Empty text="房间里还没有 Agent。" />
          ) : (
            agents.map((agent) => {
              const entry = entries.find(
                (item) => item.agentMemberId === agent.id,
              );
              return (
                <div
                  key={agent.id}
                  className="panel-soft flex items-center gap-3 p-3"
                >
                  <span className="grid size-8 place-items-center border border-agent/30 bg-agent/10 font-data text-[10px] text-agent">
                    {providerLabel(agent.agentProvider)
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text">
                      {agent.displayName}
                    </p>
                    <p className="font-data mt-0.5 text-[9px] text-muted">
                      {entry?.ownedByMe
                        ? "OWNED BY ME"
                        : entry?.canDispatch
                          ? "DELEGATED ACCESS"
                          : "NO DISPATCH ACCESS"}
                    </p>
                  </div>
                  <span
                    className={`size-2 ${entry?.canDispatch ? "bg-primary" : "bg-border-strong"}`}
                    title={entry?.canDispatch ? "可派发" : "无权派发"}
                  />
                </div>
              );
            })
          )}
        </div>
      </section>

      <ClaimAgentSection
        roomId={roomId}
        agents={agents.filter(
          (agent) =>
            !entries.find((entry) => entry.agentMemberId === agent.id)
              ?.ownedByMe,
        )}
      />

      {ownedAgents.length > 0 && (
        <>
          <section>
            <SectionTitle
              index="03"
              title="用户授权"
              detail="授权房间内另一个人类账号使用你拥有的 Agent。"
            />
            <select
              className="field-control h-10 px-3 text-xs"
              value={selectedOwnedId}
              onChange={(event) => setSelectedAgentId(event.target.value)}
            >
              {ownedAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.displayName}
                </option>
              ))}
            </select>
            <GrantManager
              roomId={roomId}
              agentId={selectedOwnedId}
              humans={humans}
              grants={access.data?.grants ?? []}
              members={members}
            />
          </section>
          <CollaborationManager
            roomId={roomId}
            ownedAgents={ownedAgents}
            allAgents={agents}
            collaborations={access.data?.collaborations ?? []}
            members={members}
          />
        </>
      )}
    </div>
  );
}

function ClaimAgentSection({
  roomId,
  agents,
}: {
  roomId: string;
  agents: Array<{ id: string; displayName: string }>;
}) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [claimCode, setClaimCode] = useState("");
  const claim = useClaimAgent(roomId);
  if (agents.length === 0) return null;
  const selected = agents.some((agent) => agent.id === agentId)
    ? agentId
    : agents[0]!.id;
  return (
    <section>
      <SectionTitle
        index="02"
        title="领取 Agent"
        detail="在本地 CLI 获取一次性 claim code，将该 Agent 绑定到你的账号。"
      />
      <div className="space-y-2">
        <select
          className="field-control h-10 px-3 text-xs"
          value={selected}
          onChange={(event) => setAgentId(event.target.value)}
        >
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.displayName}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            className="field-control h-10 min-w-0 flex-1 px-3 font-data text-xs"
            value={claimCode}
            onChange={(event) => setClaimCode(event.target.value)}
            placeholder="arc_…"
          />
          <button
            type="button"
            className="button-primary h-10 px-3 text-xs"
            disabled={claim.isPending || claimCode.trim().length < 12}
            onClick={() =>
              claim.mutate(
                { agentId: selected, claimCode: claimCode.trim() },
                { onSuccess: () => setClaimCode("") },
              )
            }
          >
            领取
          </button>
        </div>
        {claim.error && <ErrorText error={claim.error} />}
        {claim.isSuccess && <SuccessText text="Agent 已绑定到当前账号。" />}
      </div>
    </section>
  );
}

function GrantManager({
  roomId,
  agentId,
  humans,
  grants,
  members,
}: {
  roomId: string;
  agentId: string;
  humans: Array<{ id: string; displayName: string }>;
  grants: Array<{ id: string; agentMemberId: string; granteeMemberId: string }>;
  members: Record<string, { displayName: string } | undefined>;
}) {
  const [granteeId, setGranteeId] = useState("");
  const grant = useGrantAgent(roomId);
  const revoke = useRevokeAgentGrant(roomId);
  const current = grants.filter((item) => item.agentMemberId === agentId);
  const grantedIds = new Set(current.map((item) => item.granteeMemberId));
  const choices = humans.filter((human) => !grantedIds.has(human.id));
  const selected = choices.some((human) => human.id === granteeId)
    ? granteeId
    : (choices[0]?.id ?? "");
  return (
    <div className="mt-3 space-y-2">
      {choices.length > 0 && (
        <div className="flex gap-2">
          <select
            className="field-control h-10 min-w-0 flex-1 px-3 text-xs"
            value={selected}
            onChange={(event) => setGranteeId(event.target.value)}
          >
            {choices.map((human) => (
              <option key={human.id} value={human.id}>
                {human.displayName}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="button-secondary h-10 px-3 text-xs text-primary"
            disabled={!selected || grant.isPending}
            onClick={() => grant.mutate({ agentId, granteeMemberId: selected })}
          >
            授权
          </button>
        </div>
      )}
      {current.length === 0 ? (
        <Empty text="尚未授权给其他用户。" />
      ) : (
        current.map((item) => (
          <div
            key={item.id}
            className="flex items-center justify-between border border-border px-3 py-2"
          >
            <span className="text-xs text-text">
              {members[item.granteeMemberId]?.displayName ??
                item.granteeMemberId}
            </span>
            <button
              type="button"
              className="text-[11px] text-danger hover:underline"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate({ agentId, grantId: item.id })}
            >
              撤销
            </button>
          </div>
        ))
      )}
      {(grant.error || revoke.error) && (
        <ErrorText error={grant.error ?? revoke.error} />
      )}
    </div>
  );
}

function CollaborationManager({
  roomId,
  ownedAgents,
  allAgents,
  collaborations,
  members,
}: {
  roomId: string;
  ownedAgents: Array<{ id: string; displayName: string }>;
  allAgents: Array<{ id: string; displayName: string }>;
  collaborations: AgentCollaboration[];
  members: Record<string, { displayName: string } | undefined>;
}) {
  const [sourceId, setSourceId] = useState(ownedAgents[0]?.id ?? "");
  const targets = allAgents.filter((agent) => agent.id !== sourceId);
  const [targetId, setTargetId] = useState("");
  const request = useRequestAgentCollaboration(roomId);
  const respond = useRespondAgentCollaboration(roomId);
  const revoke = useRevokeAgentCollaboration(roomId);
  const selectedTarget = targets.some((agent) => agent.id === targetId)
    ? targetId
    : (targets[0]?.id ?? "");
  const ownedIds = new Set(ownedAgents.map((agent) => agent.id));
  return (
    <section>
      <SectionTitle
        index="04"
        title="Agent 协作"
        detail="目标 Agent 所有者接受后，两个 Agent 才能双向派发。"
      />
      {targets.length > 0 && (
        <div className="grid gap-2">
          <select
            className="field-control h-10 px-3 text-xs"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
          >
            {ownedAgents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                从 {agent.displayName}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <select
              className="field-control h-10 min-w-0 flex-1 px-3 text-xs"
              value={selectedTarget}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {targets.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  到 {agent.displayName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button-secondary h-10 px-3 text-xs text-agent"
              disabled={!selectedTarget || request.isPending}
              onClick={() =>
                request.mutate({
                  requesterAgentMemberId: sourceId,
                  targetAgentMemberId: selectedTarget,
                })
              }
            >
              申请
            </button>
          </div>
        </div>
      )}
      <div className="mt-3 space-y-2">
        {collaborations.length === 0 ? (
          <Empty text="暂无协作记录。" />
        ) : (
          collaborations.map((item) => (
            <div key={item.id} className="border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs text-text">
                  {members[item.requesterAgentMemberId]?.displayName ?? "Agent"}{" "}
                  → {members[item.targetAgentMemberId]?.displayName ?? "Agent"}
                </p>
                <Status status={item.status} />
              </div>
              <div className="mt-3 flex gap-2">
                {item.status === "pending" &&
                  ownedIds.has(item.targetAgentMemberId) && (
                    <>
                      <SmallAction
                        label="接受"
                        onClick={() =>
                          respond.mutate({
                            collaborationId: item.id,
                            action: "accept",
                          })
                        }
                      />
                      <SmallAction
                        label="拒绝"
                        danger
                        onClick={() =>
                          respond.mutate({
                            collaborationId: item.id,
                            action: "reject",
                          })
                        }
                      />
                    </>
                  )}
                {(item.status === "pending" || item.status === "active") && (
                  <SmallAction
                    label={item.status === "pending" ? "取消申请" : "撤销协作"}
                    danger
                    onClick={() => revoke.mutate(item.id)}
                  />
                )}
              </div>
            </div>
          ))
        )}
      </div>
      {(request.error || respond.error || revoke.error) && (
        <ErrorText error={request.error ?? respond.error ?? revoke.error} />
      )}
    </section>
  );
}

function SectionTitle({
  index,
  title,
  detail,
}: {
  index: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="mb-3">
      <p className="eyebrow text-[9px]">{index} / Agent access</p>
      <h3 className="mt-1.5 text-sm font-bold text-text">{title}</h3>
      <p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p>
    </div>
  );
}
function PanelState({
  text,
  danger = false,
}: {
  text: string;
  danger?: boolean;
}) {
  return (
    <p className={`p-4 text-xs ${danger ? "text-danger" : "text-muted"}`}>
      {text}
    </p>
  );
}
function Empty({ text }: { text: string }) {
  return <p className="well px-3 py-3 text-[11px] text-muted">{text}</p>;
}
function ErrorText({ error }: { error: unknown }) {
  return (
    <p className="mt-2 text-[11px] text-danger">
      {error instanceof ApiError ? error.message : "操作失败，请重试"}
    </p>
  );
}
function SuccessText({ text }: { text: string }) {
  return (
    <p className="mt-2 flex items-center gap-1 text-[11px] text-primary">
      <Icon name="check" size={12} />
      {text}
    </p>
  );
}
function SmallAction({
  label,
  danger = false,
  onClick,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border px-2 py-1 text-[10px] ${danger ? "border-danger/30 text-danger" : "border-primary/30 text-primary"}`}
    >
      {label}
    </button>
  );
}
function Status({ status }: { status: AgentCollaboration["status"] }) {
  const style =
    status === "active"
      ? "text-primary"
      : status === "pending"
        ? "text-warning"
        : "text-muted";
  return (
    <span className={`font-data text-[9px] uppercase ${style}`}>{status}</span>
  );
}
