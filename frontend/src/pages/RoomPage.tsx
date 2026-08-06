import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  useConnector,
  useJoinRoom,
  useMembers,
  useMessageHistory,
  usePresence,
  useRemoveMember,
  useRooms,
} from "../api/hooks";
import { getRealtimeTicket } from "../api/rooms";
import { RealTimeClient } from "../realtime/RealTimeClient";
import { useDeliveryStore } from "../stores/deliveryStore";
import { useMemberStore } from "../stores/memberStore";
import { useMessageStore } from "../stores/messageStore";
import { useTokenStore } from "../stores/tokenStore";
import { ConnectPanel } from "../components/ConnectPanel";
import { MemberPanel } from "../components/MemberPanel";
import { MessageList } from "../components/MessageList";
import { TaskComposer, type TaskComposerPreset } from "../components/TaskComposer";
import { formatDate } from "../lib/time";
import { toastError } from "../stores/toastStore";
import type { Message } from "../api/types";

export default function RoomPage() {
  const { roomId = "" } = useParams();
  const token = useTokenStore((state) => state.token);
  const user = useTokenStore((state) => state.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [waitingForAgent, setWaitingForAgent] = useState(false);
  const [rightTab, setRightTab] = useState<"members" | "connect">("members");
  const [taskPreset, setTaskPreset] = useState<TaskComposerPreset | null>(null);

  // Store actions.
  const upsertMessages = useMessageStore((state) => state.upsertMessages);
  const resetMessages = useMessageStore((state) => state.reset);
  const hasOlder = useMessageStore((state) => state.hasOlder);
  const upsertMember = useMemberStore((state) => state.upsertMember);
  const removeMember = useMemberStore((state) => state.removeMember);
  const setPresence = useMemberStore((state) => state.setPresence);
  const resetMembers = useMemberStore((state) => state.reset);
  const upsertDelivery = useDeliveryStore((state) => state.upsertDelivery);
  const resetDeliveries = useDeliveryStore((state) => state.reset);

  const rooms = useRooms();
  const membership = rooms.data?.items.find(
    (item) => item.room.id === roomId,
  );
  const myMemberId = membership?.member.id ?? "";
  const isOwner = membership?.member.role === "owner";
  const joined = Boolean(membership);

  const hasAgents = useMemberStore(
    (state) => Object.values(state.byId).some((m) => m.actorType === "agent"),
  );

  useMembers(roomId);
  usePresence(roomId);
  useMessageHistory(roomId);
  const connectorQuery = useConnector(roomId);
  const removeMemberMutation = useRemoveMember(roomId);

  const handleRemoveMember = (memberId: string) => {
    if (
      !window.confirm(
        "确认移除该成员?其访问令牌将立即失效,被移除后需重新邀请才能加入。",
      )
    ) {
      return;
    }
    removeMemberMutation.mutate(memberId, {
      onError: (error) => toastError(error, "移除成员失败"),
    });
  };

  /** Opens dispatch mode pre-selecting one agent (member panel action). */
  const handleDispatchTo = (memberId: string) => {
    setTaskPreset({
      key: `member-${memberId}-${Date.now()}`,
      targetMemberIds: [memberId],
    });
  };

  /** Opens dispatch mode pre-filling the reply as context ("re-dispatch"). */
  const handleDispatchReply = (message: Message) => {
    setTaskPreset({
      key: `reply-${message.id}-${Date.now()}`,
      text: `将以下结果转派给下一个 AI 继续处理:\n\n${message.text}`,
    });
  };

  // Reset per-room state when switching rooms.
  useEffect(() => {
    return () => {
      resetMessages();
      resetMembers();
      resetDeliveries();
    };
  }, [roomId, resetMessages, resetMembers, resetDeliveries]);

  // Realtime connection: ticket → connect → heartbeat → backoff reconnect.
  useEffect(() => {
    if (!token || !joined) return;
    const client = new RealTimeClient({
      getTicket: () => getRealtimeTicket(token, roomId),
      handlers: {
        onSessionReady: () => {
          // Backfill any gap since the local watermark.
          void queryClient.invalidateQueries({
            queryKey: ["rooms", roomId, "messages"],
          });
        },
        onMemberJoined: (member) => {
          upsertMember(member);
          if (member.actorType === "agent") setWaitingForAgent(false);
        },
        onMessageCreated: (message) => upsertMessages([message]),
        onDeliveryUpdated: (delivery) => upsertDelivery(delivery),
        onMemberRemoved: (memberId) => {
          if (memberId === myMemberId) {
            // We were removed: leave the room cleanly and go back to the list.
            resetMessages();
            resetMembers();
            resetDeliveries();
            navigate("/rooms", { replace: true });
            return;
          }
          removeMember(memberId);
        },
        onMemberPresence: (memberId, online) => setPresence(memberId, online),
      },
    });
    client.connect();
    return () => client.disconnect();
  }, [
    token,
    roomId,
    joined,
    myMemberId,
    queryClient,
    upsertMessages,
    upsertMember,
    upsertDelivery,
    removeMember,
    setPresence,
    resetMessages,
    resetMembers,
    resetDeliveries,
    navigate,
  ]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-full bg-bg">
      {/* Left rail: my rooms + account. */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface/60">
        <div className="border-b border-border px-4 py-3">
          <p className="font-data text-[11px] uppercase tracking-[0.2em] text-muted">
            agentroom
          </p>
          <h1 className="font-data text-lg font-bold tracking-tight text-text">
            AgentRoom
          </h1>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          <p className="font-data px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            ~/rooms
          </p>
          {rooms.data?.items.map(({ room }) => (
            <button
              key={room.id}
              type="button"
              onClick={() => navigate(`/rooms/${room.id}`)}
              className={`mb-0.5 block w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                room.id === roomId
                  ? "border-l-2 border-primary bg-primary/10 font-medium text-text"
                  : "border-l-2 border-transparent text-muted hover:bg-surface hover:text-text"
              }`}
            >
              {room.name}
            </button>
          ))}
        </nav>
        <div className="border-t border-border p-3 text-xs text-muted">
          <p className="truncate">{user?.displayName ?? user?.email ?? ""}</p>
          <button
            type="button"
            onClick={() => navigate("/rooms")}
            className="mt-1 text-primary transition-colors hover:text-primary-hover"
          >
            管理聊天室
          </button>
        </div>
      </aside>

      {joined ? (
        <>
          {/* Center: onboarding or message stream + composer. */}
          <main className="flex min-w-0 flex-1 flex-col">
            {hasAgents ? (
              <>
                <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
                  <h2 className="truncate text-sm font-semibold text-text">
                    {membership?.room.name}
                  </h2>
                  <span className="text-xs text-muted">
                    {formatDate(membership?.room.createdAt ?? "")}
                  </span>
                </header>
                <div className="min-h-0 flex-1">
                  <MessageList
                    roomId={roomId}
                    hasOlder={hasOlder}
                    loadingOlder={false}
                    onLoadOlder={() => undefined}
                    onDispatchReply={handleDispatchReply}
                  />
                </div>
                <TaskComposer
                  roomId={roomId}
                  isOwner={Boolean(isOwner)}
                  preset={taskPreset}
                />
              </>
            ) : (
              <div className="flex-1 overflow-y-auto">
                <ConnectPanel
                  roomId={roomId}
                  connector={connectorQuery.data}
                  loading={connectorQuery.isLoading}
                  isOwner={Boolean(isOwner)}
                  waitingForAgent={waitingForAgent}
                  onCommandCopied={() => setWaitingForAgent(true)}
                />
              </div>
            )}
          </main>

          {/* Right rail: members / connect. */}
          <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-surface/60">
            <div className="flex border-b border-border text-sm">
              {(
                [
                  ["members", "成员"],
                  ["connect", "接入"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRightTab(key)}
                  className={`flex-1 px-3 py-2 transition-colors ${
                    rightTab === key
                      ? "border-b-2 border-primary font-medium text-text"
                      : "text-muted hover:text-text"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {rightTab === "members" ? (
                <MemberPanel
                  isOwner={Boolean(isOwner)}
                  myMemberId={myMemberId}
                  onDispatchTask={handleDispatchTo}
                  onRemoveMember={handleRemoveMember}
                />
              ) : (
                <ConnectPanel
                  roomId={roomId}
                  connector={connectorQuery.data}
                  loading={connectorQuery.isLoading}
                  isOwner={Boolean(isOwner)}
                  waitingForAgent={waitingForAgent}
                  onCommandCopied={() => setWaitingForAgent(true)}
                />
              )}
            </div>
          </aside>
        </>
      ) : (
        <JoinRoomForm roomId={roomId} />
      )}
    </div>
  );
}

/** Invite-code join form shown when the account is not yet a room member. */
function JoinRoomForm({ roomId }: { roomId: string }) {
  const joinRoom = useJoinRoom(roomId);
  const defaultName = useTokenStore((state) => state.user?.displayName ?? "");
  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = inviteCode.trim();
    const name = displayName.trim();
    if (!code || !name) return;
    setError(null);
    try {
      await joinRoom.mutateAsync({ inviteCode: code, displayName: name });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "ACCOUNT_ALREADY_MEMBER") {
          setError("你已经是这个房间的成员,请刷新重试");
          return;
        }
        if (err.status === 404) {
          setError("房间不存在或已被删除");
          return;
        }
        if (err.status === 503) {
          setError("服务暂不可用,请稍后重试");
          return;
        }
        if (err.status === 429) {
          setError("尝试过于频繁,请稍后再试");
          return;
        }
        setError(err.message);
      } else {
        setError("加入失败,请重试");
      }
    }
  };

  return (
    <main className="flex flex-1 items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="surface-panel-raised animate-rise-in w-full max-w-sm space-y-4 rounded-lg p-6"
      >
        <p className="font-data text-[11px] uppercase tracking-[0.2em] text-muted">
          $ agentroom join
        </p>
        <h2 className="text-lg font-semibold text-text">通过邀请码加入房间</h2>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">邀请码</span>
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="ari_xxx"
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted/60 focus:border-primary focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">房间内昵称</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={joinRoom.isPending}
          className="press w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-60"
        >
          {joinRoom.isPending ? "加入中…" : "加入房间"}
        </button>
      </form>
    </main>
  );
}
