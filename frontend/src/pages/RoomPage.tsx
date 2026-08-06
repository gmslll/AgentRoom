import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Navigate,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { ApiError } from "../api/client";
import {
  useConnector,
  useJoinRoom,
  useMembers,
  useMessageHistory,
  usePresence,
  usePublicRooms,
  useRooms,
} from "../api/hooks";
import { getRealtimeTicket } from "../api/rooms";
import type { Message } from "../api/types";
import {
  RealTimeClient,
  type RealTimeConnectionState,
} from "../realtime/RealTimeClient";
import { useDeliveryStore } from "../stores/deliveryStore";
import { useMemberStore } from "../stores/memberStore";
import { useMessageStore } from "../stores/messageStore";
import { useTokenStore } from "../stores/tokenStore";
import { AgentAccessPanel } from "../components/AgentAccessPanel";
import { ConnectPanel } from "../components/ConnectPanel";
import { MemberPanel } from "../components/MemberPanel";
import { MessageList } from "../components/MessageList";
import { RoomSettingsPanel } from "../components/RoomSettingsPanel";
import {
  TaskComposer,
  type TaskComposerPreset,
} from "../components/TaskComposer";
import { BrandMark } from "../components/ui/BrandMark";
import { Icon, type IconName } from "../components/ui/Icon";
import { formatDate } from "../lib/time";

type DockTab = "members" | "connect" | "agents" | "settings";

export default function RoomPage() {
  const { roomId = "" } = useParams();
  const token = useTokenStore((state) => state.token);
  const user = useTokenStore((state) => state.user);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [initialInvite, setInitialInvite] = useState<{
    roomId: string;
    code: string;
  } | null>(() => {
    const state = location.state as {
      createdRoomId?: string;
      initialInviteCode?: string;
    } | null;
    return state?.createdRoomId === roomId && state.initialInviteCode
      ? { roomId, code: state.initialInviteCode }
      : null;
  });

  const [waitingForAgent, setWaitingForAgent] = useState(false);
  const [rightTab, setRightTab] = useState<DockTab>("members");
  const [taskPreset, setTaskPreset] = useState<TaskComposerPreset | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [connectionState, setConnectionState] =
    useState<RealTimeConnectionState>("connecting");

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
  const publicRooms = usePublicRooms();
  const membership = rooms.data?.items.find((item) => item.room.id === roomId);
  const isOwner = membership?.member.role === "owner";
  const joined = Boolean(membership);
  const isPublic = publicRooms.data?.items.some((room) => room.id === roomId);
  const hasAgents = useMemberStore((state) =>
    Object.values(state.byId).some((member) => member.actorType === "agent"),
  );
  const onlineCount = useMemberStore(
    (state) => Object.values(state.onlineById).filter(Boolean).length,
  );

  useMembers(roomId, joined);
  usePresence(roomId, joined);
  const history = useMessageHistory(roomId, joined);
  const connectorQuery = useConnector(roomId, Boolean(isOwner));

  const openDock = (tab: DockTab) => {
    setRightTab(tab);
    setDockOpen(true);
  };

  const handleDispatchTo = (memberId: string) => {
    setTaskPreset({
      key: `member-${memberId}-${Date.now()}`,
      targetMemberIds: [memberId],
    });
    setDockOpen(false);
  };

  const handleDispatchReply = (message: Message) => {
    setTaskPreset({
      key: `reply-${message.id}-${Date.now()}`,
      text: `将以下结果转派给下一个 AI 继续处理:\n\n${message.text}`,
    });
  };

  useEffect(() => {
    setNavigationOpen(false);
    setDockOpen(false);
    setConnectionState("connecting");
    setInitialInvite((current) =>
      current?.roomId === roomId ? current : null,
    );
    return () => {
      resetMessages();
      resetMembers();
      resetDeliveries();
    };
  }, [roomId, resetMessages, resetMembers, resetDeliveries]);

  // The one-time invite survives the create → room transition in component
  // memory, but is removed from browser history immediately.
  useEffect(() => {
    if (location.state) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!token || !joined) return;
    const invalidateAccess = () =>
      queryClient.invalidateQueries({
        queryKey: ["rooms", roomId, "agent-access"],
      });
    const client = new RealTimeClient({
      getTicket: () => getRealtimeTicket(token, roomId),
      handlers: {
        onConnectionState: setConnectionState,
        onSessionReady: () => {
          if (membership?.member.id) setPresence(membership.member.id, true);
          void queryClient.invalidateQueries({
            queryKey: ["rooms", roomId, "messages"],
          });
          void queryClient.invalidateQueries({
            queryKey: ["rooms", roomId, "presence"],
          });
          void invalidateAccess();
        },
        onMemberJoined: (member) => {
          upsertMember(member);
          if (member.actorType === "agent") setWaitingForAgent(false);
          void invalidateAccess();
        },
        onMessageCreated: (message) => upsertMessages([message]),
        onDeliveryUpdated: (delivery) => upsertDelivery(delivery),
        onMemberRemoved: (memberId) => {
          if (memberId === membership?.member.id) {
            void queryClient.invalidateQueries({ queryKey: ["rooms"] });
            navigate("/rooms", { replace: true });
            return;
          }
          removeMember(memberId);
          void invalidateAccess();
        },
        onMemberPresence: (presence) =>
          setPresence(presence.memberId, presence.online),
        onRoomUpdated: () => {
          void queryClient.invalidateQueries({ queryKey: ["rooms"] });
          void queryClient.invalidateQueries({ queryKey: ["public-rooms"] });
        },
        onRoomDissolved: () => {
          void queryClient.invalidateQueries({ queryKey: ["rooms"] });
          void queryClient.invalidateQueries({ queryKey: ["public-rooms"] });
          navigate("/rooms", { replace: true });
        },
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
    setPresence,
    membership?.member.id,
    navigate,
  ]);

  if (!token) return <Navigate to="/login" replace />;

  const dockTabs: Array<{ key: DockTab; label: string; icon: IconName }> = [
    { key: "members", label: "成员", icon: "users" },
    { key: "connect", label: "接入", icon: "terminal" },
    { key: "agents", label: "授权", icon: "shield" },
    ...(isOwner
      ? ([{ key: "settings", label: "设置", icon: "settings" }] as const)
      : []),
  ];

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-bg">
      {(navigationOpen || dockOpen) && (
        <button
          type="button"
          aria-label="关闭面板"
          className="fixed inset-0 z-40 bg-black/65 backdrop-blur-[2px] xl:hidden"
          onClick={() => {
            setNavigationOpen(false);
            setDockOpen(false);
          }}
        />
      )}

      <RoomNavigation
        roomId={roomId}
        open={navigationOpen}
        rooms={rooms.data?.items ?? []}
        userLabel={user?.displayName ?? user?.email ?? "AgentRoom user"}
        onClose={() => setNavigationOpen(false)}
        onNavigate={(path) => {
          navigate(path);
          setNavigationOpen(false);
        }}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <RoomHeader
          roomName={membership?.room.name ?? "加入聊天室"}
          visibility={
            membership?.room.visibility ?? (isPublic ? "public" : "private")
          }
          createdAt={membership?.room.createdAt}
          connectionState={joined ? connectionState : "disconnected"}
          onlineCount={onlineCount}
          onOpenNavigation={() => setNavigationOpen(true)}
          onOpenDock={() => openDock("members")}
        />

        {joined && membership ? (
          <div className="flex min-h-0 flex-1">
            <main className="flex min-w-0 flex-1 flex-col">
              {!hasAgents && (
                <div className="border-b border-warning/20 bg-warning/[0.035] px-4 py-3 sm:px-6">
                  <div className="mx-auto flex max-w-5xl items-center gap-3">
                    <span className="size-2 shrink-0 animate-pulse-signal bg-warning" />
                    <p className="min-w-0 flex-1 text-xs text-muted">
                      <strong className="text-warning">
                        尚无 Agent 信号。
                      </strong>{" "}
                      你仍可发送普通消息，也可以接入 Claude 或 Codex。
                    </p>
                    {isOwner && (
                      <button
                        type="button"
                        onClick={() => openDock("connect")}
                        className="button-secondary h-8 shrink-0 px-2.5 text-[10px] text-warning"
                      >
                        接入 Agent
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className="min-h-0 flex-1">
                <MessageList
                  roomId={roomId}
                  hasOlder={hasOlder}
                  loadingOlder={history.isFetching}
                  onLoadOlder={() => void history.refetch()}
                  onDispatchReply={handleDispatchReply}
                />
              </div>
              <TaskComposer roomId={roomId} preset={taskPreset} />
              <MobileDockBar tabs={dockTabs} onOpen={openDock} />
            </main>

            <RoomDock
              open={dockOpen}
              tab={rightTab}
              tabs={dockTabs}
              onTabChange={setRightTab}
              onClose={() => setDockOpen(false)}
            >
              {rightTab === "members" ? (
                <MemberPanel
                  roomId={roomId}
                  isOwner={Boolean(isOwner)}
                  onDispatchTask={handleDispatchTo}
                />
              ) : rightTab === "connect" ? (
                <ConnectPanel
                  roomId={roomId}
                  connector={connectorQuery.data}
                  loading={connectorQuery.isLoading}
                  isOwner={Boolean(isOwner)}
                  visibility={membership.room.visibility}
                  initialInviteCode={
                    initialInvite?.roomId === roomId ? initialInvite.code : null
                  }
                  waitingForAgent={waitingForAgent}
                  onCommandCopied={() => setWaitingForAgent(true)}
                />
              ) : rightTab === "agents" ? (
                <AgentAccessPanel roomId={roomId} />
              ) : (
                <RoomSettingsPanel
                  room={membership.room}
                  onDissolved={() => navigate("/rooms", { replace: true })}
                />
              )}
            </RoomDock>
          </div>
        ) : (
          <JoinRoomForm roomId={roomId} isPublic={Boolean(isPublic)} />
        )}
      </div>
    </div>
  );
}

function RoomNavigation({
  roomId,
  open,
  rooms,
  userLabel,
  onClose,
  onNavigate,
}: {
  roomId: string;
  open: boolean;
  rooms: Array<{ room: { id: string; name: string } }>;
  userLabel: string;
  onClose: () => void;
  onNavigate: (path: string) => void;
}) {
  const drawerRef = useDrawerFocusTrap(open, onClose);
  return (
    <aside
      ref={drawerRef}
      role={open ? "dialog" : undefined}
      aria-modal={open ? true : undefined}
      aria-label="聊天室导航"
      className={`fixed inset-y-0 left-0 z-50 flex w-[min(84vw,280px)] shrink-0 flex-col border-r border-border bg-bg transition-transform duration-200 lg:static lg:z-auto lg:w-64 lg:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex h-[73px] items-center border-b border-border px-5">
        <button type="button" onClick={() => onNavigate("/rooms")}>
          <BrandMark />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto grid size-8 place-items-center text-muted hover:text-text lg:hidden"
          aria-label="关闭聊天室导航"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="border-b border-border px-4 py-4">
        <button
          type="button"
          onClick={() => onNavigate("/rooms")}
          className="button-primary h-10 w-full px-3 text-xs"
        >
          <Icon name="plus" size={15} />
          创建或发现房间
        </button>
      </div>
      <nav
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
        aria-label="我的聊天室"
      >
        <p className="eyebrow px-2 pb-3">My signal lines / {rooms.length}</p>
        <div className="space-y-1">
          {rooms.map(({ room }, index) => (
            <button
              key={room.id}
              type="button"
              onClick={() => onNavigate(`/rooms/${room.id}`)}
              className={`group flex w-full items-center gap-3 border px-3 py-2.5 text-left transition-colors ${
                room.id === roomId
                  ? "border-primary/40 bg-primary/[0.07] text-text"
                  : "border-transparent text-muted hover:border-border hover:bg-surface hover:text-text"
              }`}
            >
              <span
                className={`font-data grid size-7 shrink-0 place-items-center border text-[9px] ${
                  room.id === roomId
                    ? "border-primary/40 text-primary"
                    : "border-border text-muted"
                }`}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                {room.name}
              </span>
              {room.id === roomId && <span className="size-1.5 bg-primary" />}
            </button>
          ))}
        </div>
      </nav>
      <div className="border-t border-border p-3">
        <button
          type="button"
          onClick={() => onNavigate("/account")}
          className="flex w-full items-center gap-3 border border-transparent p-2 text-left text-muted hover:border-border hover:bg-surface hover:text-text"
        >
          <span className="grid size-8 place-items-center border border-border bg-surface-raised">
            <Icon name="user" size={15} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold">
              {userLabel}
            </span>
            <span className="font-data block text-[8px] uppercase text-muted">
              Account & security
            </span>
          </span>
          <Icon name="chevron" size={13} />
        </button>
      </div>
    </aside>
  );
}

function RoomHeader({
  roomName,
  visibility,
  createdAt,
  connectionState,
  onlineCount,
  onOpenNavigation,
  onOpenDock,
}: {
  roomName: string;
  visibility: "public" | "private";
  createdAt?: string;
  connectionState: RealTimeConnectionState;
  onlineCount: number;
  onOpenNavigation: () => void;
  onOpenDock: () => void;
}) {
  const connected = connectionState === "connected";
  const statusLabel = connected
    ? "LIVE"
    : connectionState === "reconnecting"
      ? "RETRY"
      : connectionState === "disconnected"
        ? "OFFLINE"
        : "LINKING";

  return (
    <header className="z-20 flex min-h-[73px] shrink-0 items-center border-b border-border bg-bg/94 px-3 backdrop-blur-xl sm:px-5">
      <button
        type="button"
        onClick={onOpenNavigation}
        className="button-secondary mr-3 size-9 p-0 lg:hidden"
        aria-label="打开聊天室导航"
      >
        <Icon name="menu" size={17} />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-base font-extrabold tracking-[-0.025em] text-text sm:text-lg">
            {roomName}
          </h1>
          <span className="hidden border border-border px-1.5 py-0.5 font-data text-[8px] uppercase text-muted sm:inline-flex">
            {visibility}
          </span>
        </div>
        <p className="font-data mt-0.5 truncate text-[8px] uppercase tracking-[0.12em] text-muted sm:text-[9px]">
          Room signal{" "}
          {createdAt
            ? `· opened ${formatDate(createdAt)}`
            : "· invitation gate"}
        </p>
      </div>
      <div className="ml-3 flex items-center gap-2">
        <span
          className={`hidden items-center gap-2 border px-2 py-1 font-data text-[8px] sm:flex ${
            connected
              ? "border-primary/30 bg-primary/5 text-primary"
              : connectionState === "reconnecting"
                ? "border-warning/30 bg-warning/5 text-warning"
                : "border-border text-muted"
          }`}
        >
          <span
            className={`size-1.5 ${connected ? "bg-primary" : "bg-current"}`}
          />
          {statusLabel}
        </span>
        <span className="hidden items-center gap-1.5 text-[10px] text-muted md:flex">
          <Icon name="users" size={13} />
          {onlineCount} online
        </span>
        <button
          type="button"
          onClick={onOpenDock}
          className="button-secondary size-9 p-0 xl:hidden"
          aria-label="打开房间控制面板"
        >
          <Icon name="settings" size={16} />
        </button>
      </div>
    </header>
  );
}

function RoomDock({
  open,
  tab,
  tabs,
  onTabChange,
  onClose,
  children,
}: {
  open: boolean;
  tab: DockTab;
  tabs: Array<{ key: DockTab; label: string; icon: IconName }>;
  onTabChange: (tab: DockTab) => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const drawerRef = useDrawerFocusTrap(open, onClose);
  return (
    <aside
      ref={drawerRef}
      role={open ? "dialog" : undefined}
      aria-modal={open ? true : undefined}
      aria-label="房间控制面板"
      className={`fixed inset-y-0 right-0 z-50 flex w-[min(92vw,390px)] shrink-0 flex-col border-l border-border bg-bg shadow-[-24px_0_80px_rgba(0,0,0,.45)] transition-transform duration-200 xl:static xl:z-auto xl:w-[360px] xl:translate-x-0 xl:shadow-none ${
        open ? "translate-x-0" : "translate-x-full"
      }`}
    >
      <div className="flex h-[73px] shrink-0 items-center border-b border-border px-3">
        <div className="flex min-w-0 flex-1">
          {tabs.map(({ key, label, icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => onTabChange(key)}
              className={`relative flex min-w-0 flex-1 flex-col items-center gap-1 px-1 py-2 text-[9px] font-semibold transition-colors ${
                tab === key ? "text-primary" : "text-muted hover:text-text"
              }`}
            >
              <Icon name={icon} size={15} />
              {label}
              {tab === key && (
                <span className="absolute inset-x-2 -bottom-[13px] h-px bg-primary" />
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-2 grid size-8 place-items-center text-muted hover:text-text xl:hidden"
          aria-label="关闭控制面板"
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}

/** Focuses and keyboard-traps mobile drawers while leaving desktop rails alone. */
function useDrawerFocusTrap(
  open: boolean,
  onClose: () => void,
): React.RefObject<HTMLElement | null> {
  const ref = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || !ref.current) return;
    const node = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const selector =
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () =>
      Array.from(node.querySelectorAll<HTMLElement>(selector));
    const frame = requestAnimationFrame(() => focusable()[0]?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      previous?.focus();
    };
  }, [open]);

  return ref;
}

function MobileDockBar({
  tabs,
  onOpen,
}: {
  tabs: Array<{ key: DockTab; label: string; icon: IconName }>;
  onOpen: (tab: DockTab) => void;
}) {
  return (
    <nav
      className="grid shrink-0 border-t border-border bg-bg/95 pb-[max(0px,env(safe-area-inset-bottom))] xl:hidden"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
      aria-label="房间工具"
    >
      {tabs.map(({ key, label, icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onOpen(key)}
          className="flex h-12 flex-col items-center justify-center gap-0.5 text-[8px] text-muted hover:bg-surface hover:text-primary"
        >
          <Icon name={icon} size={14} />
          {label}
        </button>
      ))}
    </nav>
  );
}

function JoinRoomForm({
  roomId,
  isPublic,
}: {
  roomId: string;
  isPublic: boolean;
}) {
  const joinRoom = useJoinRoom(roomId);
  const defaultName = useTokenStore((state) => state.user?.displayName ?? "");
  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState(defaultName);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const code = inviteCode.trim();
    const name = displayName.trim();
    if (!name) return;
    setError(null);
    try {
      await joinRoom.mutateAsync({
        ...(code ? { inviteCode: code } : {}),
        displayName: name,
      });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === "ACCOUNT_ALREADY_MEMBER")
          setError("你已经加入这个房间，请刷新重试");
        else if (err.status === 404) setError("房间不存在或已被解散");
        else if (err.status === 503) setError("服务暂不可用，请稍后重试");
        else if (err.status === 429) setError("尝试过于频繁，请稍后再试");
        else setError(err.message);
      } else setError("加入失败，请重试");
    }
  };

  return (
    <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-4 py-10">
      <div className="pointer-events-none absolute inset-x-[12%] top-1/2 hidden h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent sm:block" />
      <form
        onSubmit={handleSubmit}
        className="panel animate-rise-in relative w-full max-w-md p-5 sm:p-7"
      >
        <div className="mb-6 flex items-start justify-between border-b border-border pb-5">
          <div>
            <p className="eyebrow">Invitation gate / join</p>
            <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.04em] text-text">
              {isPublic ? "接入公开信号线" : "验证房间邀请"}
            </h2>
          </div>
          <span
            className={`grid size-10 place-items-center border ${isPublic ? "border-human/30 text-human" : "border-agent/30 text-agent"}`}
          >
            <Icon name={isPublic ? "globe" : "key"} size={18} />
          </span>
        </div>
        <p className="mb-5 text-xs leading-5 text-muted">
          {isPublic
            ? "这个房间允许已登录用户直接加入；你的昵称会显示在成员与消息记录中。"
            : "输入房主生成的一次性邀请码。邀请码只用于本次加入，不会被浏览器长期保存。"}
        </p>
        {!isPublic && (
          <label className="mb-4 block">
            <span className="eyebrow mb-2 block text-[9px]">
              Room invite code
            </span>
            <input
              type="text"
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="ari_…"
              autoComplete="off"
              className="field-control h-11 px-3 font-data text-xs"
              required
            />
          </label>
        )}
        <label className="block">
          <span className="eyebrow mb-2 block text-[9px]">Display name</span>
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="field-control h-11 px-3 text-sm"
            maxLength={80}
            required
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-xs text-danger">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={joinRoom.isPending}
          className="button-primary mt-6 h-11 w-full px-4 text-xs"
        >
          {joinRoom.isPending ? "正在建立连接…" : "加入房间"}
          {!joinRoom.isPending && <Icon name="arrow" size={15} />}
        </button>
      </form>
    </main>
  );
}
