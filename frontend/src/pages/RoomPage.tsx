import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  useConnector,
  useJoinRoom,
  useMembers,
  useMessageHistory,
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
import { TaskComposer } from "../components/TaskComposer";
import { formatDate } from "../lib/time";

export default function RoomPage() {
  const { roomId = "" } = useParams();
  const token = useTokenStore((state) => state.token);
  const user = useTokenStore((state) => state.user);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [waitingForAgent, setWaitingForAgent] = useState(false);
  const [rightTab, setRightTab] = useState<"members" | "connect">("members");

  // Store actions.
  const upsertMessages = useMessageStore((state) => state.upsertMessages);
  const resetMessages = useMessageStore((state) => state.reset);
  const hasOlder = useMessageStore((state) => state.hasOlder);
  const upsertMember = useMemberStore((state) => state.upsertMember);
  const removeMember = useMemberStore((state) => state.removeMember);
  const resetMembers = useMemberStore((state) => state.reset);
  const upsertDelivery = useDeliveryStore((state) => state.upsertDelivery);
  const resetDeliveries = useDeliveryStore((state) => state.reset);

  const rooms = useRooms();
  const membership = rooms.data?.items.find(
    (item) => item.room.id === roomId,
  );
  const isOwner = membership?.member.role === "owner";
  const joined = Boolean(membership);

  const hasAgents = useMemberStore(
    (state) => Object.values(state.byId).some((m) => m.actorType === "agent"),
  );

  useMembers(roomId);
  useMessageHistory(roomId);
  const connectorQuery = useConnector(roomId);

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
        onMemberRemoved: (memberId) => removeMember(memberId),
      },
    });
    client.connect();
    return () => client.disconnect();
  }, [
    token,
    roomId,
    joined,
    queryClient,
    upsertMessages,
    upsertMember,
    upsertDelivery,
    removeMember,
  ]);

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-full bg-bg">
      {/* Left rail: my rooms + account. */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface/40">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-sm font-bold text-text">AgentRoom</h1>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">
            我的聊天室
          </p>
          {rooms.data?.items.map(({ room }) => (
            <button
              key={room.id}
              type="button"
              onClick={() => navigate(`/rooms/${room.id}`)}
              className={`mb-0.5 block w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                room.id === roomId
                  ? "bg-surface-raised font-medium text-text"
                  : "text-muted hover:bg-surface hover:text-text"
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
            className="mt-1 text-primary hover:text-primary-hover"
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
                  />
                </div>
                <TaskComposer roomId={roomId} isOwner={Boolean(isOwner)} />
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
          <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-surface/40">
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
                <MemberPanel isOwner={Boolean(isOwner)} />
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
        className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-surface p-6"
      >
        <h2 className="text-lg font-semibold text-text">通过邀请码加入房间</h2>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">邀请码</span>
          <input
            type="text"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="ari_xxx"
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted/60 focus:border-primary focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-muted">房间内昵称</span>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text focus:border-primary focus:outline-none"
          />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={joinRoom.isPending}
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {joinRoom.isPending ? "加入中…" : "加入房间"}
        </button>
      </form>
    </main>
  );
}
