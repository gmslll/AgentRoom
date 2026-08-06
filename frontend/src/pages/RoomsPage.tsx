import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  useCreateRoom,
  useJoinPublicRoom,
  usePublicRooms,
  useRooms,
} from "../api/hooks";
import type { AccountRoomMembership, Room, RoomVisibility } from "../api/types";
import { AppShell } from "../components/ui/AppShell";
import { Icon } from "../components/ui/Icon";
import { PageState } from "../components/ui/PageState";
import { formatDate } from "../lib/time";
import { useTokenStore } from "../stores/tokenStore";

export default function RoomsPage() {
  const token = useTokenStore((state) => state.token);
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState("");
  const [visibility, setVisibility] = useState<RoomVisibility>("private");
  const [error, setError] = useState<string | null>(null);
  const rooms = useRooms();
  const publicRooms = usePublicRooms();
  const createRoom = useCreateRoom();
  const joinPublicRoom = useJoinPublicRoom();

  const joined = useMemo(() => rooms.data?.items ?? [], [rooms.data?.items]);
  const joinedIds = useMemo(
    () => new Set(joined.map((item) => item.room.id)),
    [joined],
  );
  const discoverable = (publicRooms.data?.items ?? []).filter(
    (room) => !joinedIds.has(room.id),
  );
  const ownerCount = joined.filter(
    (item) => item.member.role === "owner",
  ).length;
  const publicCount = joined.filter(
    (item) => item.room.visibility === "public",
  ).length;

  if (!token) return <Navigate to="/login" replace />;

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = roomName.trim();
    if (!name) return;
    setError(null);
    try {
      const result = await createRoom.mutateAsync({ name, visibility });
      setRoomName("");
      navigate(`/rooms/${result.room.id}`, {
        state: {
          createdRoomId: result.room.id,
          initialInviteCode: result.inviteCode,
        },
      });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "创建聊天室失败");
    }
  };

  const joinPublic = async (roomId: string) => {
    setError(null);
    try {
      await joinPublicRoom.mutateAsync(roomId);
      navigate(`/rooms/${roomId}`);
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        cause.code === "ACCOUNT_ALREADY_MEMBER"
      ) {
        navigate(`/rooms/${roomId}`);
      } else {
        setError(
          cause instanceof ApiError ? cause.message : "加入公开房间失败",
        );
      }
    }
  };

  return (
    <AppShell
      eyebrow="Room network / 01"
      title="协作信号总览"
      description="建立房间、发现公开频段，再把本地 Claude、Codex 和终端接入同一条任务链。"
    >
      <section className="mb-6 grid gap-px overflow-hidden border border-border bg-border sm:grid-cols-3">
        <Metric index="01" label="已加入房间" value={joined.length} />
        <Metric index="02" label="由我管理" value={ownerCount} />
        <Metric index="03" label="公开频段" value={publicCount} />
      </section>

      {error && (
        <p
          role="alert"
          className="mb-5 border-l-2 border-danger bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          {error}
        </p>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,.72fr)_minmax(0,1.4fr)]">
        <CreateRoomPanel
          roomName={roomName}
          visibility={visibility}
          pending={createRoom.isPending}
          onNameChange={setRoomName}
          onVisibilityChange={setVisibility}
          onSubmit={create}
        />

        <section>
          <SectionHeader
            index="02"
            title="我的房间"
            detail="选择一个房间进入实时协作"
          />
          {rooms.isPending ? (
            <PageState title="正在同步房间网络…" />
          ) : rooms.isError ? (
            <PageState
              title="房间列表加载失败"
              detail={(rooms.error as ApiError)?.message ?? "请稍后重试"}
            />
          ) : joined.length === 0 ? (
            <PageState
              eyebrow="No room signals"
              title="还没有聊天室"
              detail="先在左侧建立一个房间，然后接入你的第一个本地 Agent。"
            />
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {joined.map((membership, index) => (
                <RoomCard
                  key={membership.room.id}
                  membership={membership}
                  index={index}
                  onOpen={() => navigate(`/rooms/${membership.room.id}`)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="mt-10 border-t border-border pt-8">
        <SectionHeader
          index="03"
          title="公开频段"
          detail="无需邀请码即可加入的开放聊天室"
        />
        {publicRooms.isPending ? (
          <p className="font-data text-xs text-muted">
            SCANNING PUBLIC SIGNALS…
          </p>
        ) : discoverable.length === 0 ? (
          <div className="well px-5 py-8 text-center text-sm text-muted">
            当前没有新的公开房间信号。
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {discoverable.map((room) => (
              <PublicRoomCard
                key={room.id}
                room={room}
                pending={
                  joinPublicRoom.isPending &&
                  joinPublicRoom.variables === room.id
                }
                onJoin={() => void joinPublic(room.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </AppShell>
  );
}

function Metric({
  index,
  label,
  value,
}: {
  index: string;
  label: string;
  value: number;
}) {
  return (
    <div className="bg-surface px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="eyebrow text-[9px]">
          {index} / {label}
        </span>
        <span className="size-1.5 bg-primary" />
      </div>
      <strong className="font-data mt-3 block text-2xl font-medium text-text">
        {String(value).padStart(2, "0")}
      </strong>
    </div>
  );
}

function CreateRoomPanel({
  roomName,
  visibility,
  pending,
  onNameChange,
  onVisibilityChange,
  onSubmit,
}: {
  roomName: string;
  visibility: RoomVisibility;
  pending: boolean;
  onNameChange: (value: string) => void;
  onVisibilityChange: (value: RoomVisibility) => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  return (
    <section className="panel cut-corner h-fit p-6 xl:sticky xl:top-24">
      <p className="eyebrow text-primary">01 / Create signal</p>
      <h2 className="mt-3 text-2xl font-extrabold tracking-[-0.04em] text-text">
        建立新房间
      </h2>
      <p className="mt-2 text-sm leading-6 text-muted">
        房间是所有人类与本地 Agent 的消息中枢。
      </p>
      <form onSubmit={onSubmit} className="mt-7 space-y-5">
        <label className="block">
          <span className="mb-2 block text-xs font-semibold text-muted">
            房间名称
          </span>
          <input
            className="field-control h-12 px-3"
            maxLength={100}
            value={roomName}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="例如：AgentRoom 后端协作"
          />
        </label>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-muted">
            接入方式
          </legend>
          <div className="grid grid-cols-2 gap-2">
            {(["private", "public"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onVisibilityChange(value)}
                className={`p-3 text-left transition-colors ${visibility === value ? "border border-primary bg-primary/10" : "border border-border bg-bg/50 hover:border-border-strong"}`}
              >
                <Icon
                  name={value === "private" ? "lock" : "globe"}
                  size={16}
                  className={
                    visibility === value ? "text-primary" : "text-muted"
                  }
                />
                <span className="mt-2 block text-sm font-bold text-text">
                  {value === "private" ? "私有" : "公开"}
                </span>
                <span className="mt-1 block text-[10px] leading-4 text-muted">
                  {value === "private" ? "使用邀请码加入" : "可发现并直接加入"}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
        <button
          className="button-primary h-12 w-full px-5"
          disabled={pending || !roomName.trim()}
        >
          {pending ? "建立中…" : "建立房间"}
          <Icon name="plus" size={17} />
        </button>
      </form>
    </section>
  );
}

function SectionHeader({
  index,
  title,
  detail,
}: {
  index: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div>
        <p className="eyebrow">{index} / Signal group</p>
        <h2 className="mt-2 text-xl font-bold tracking-tight text-text">
          {title}
        </h2>
      </div>
      <p className="hidden text-xs text-muted sm:block">{detail}</p>
    </div>
  );
}

function RoomCard({
  membership,
  index,
  onOpen,
}: {
  membership: AccountRoomMembership;
  index: number;
  onOpen: () => void;
}) {
  const { room, member } = membership;
  return (
    <li
      className="animate-rise-in"
      style={{ animationDelay: `${index * 55}ms` }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="group panel-soft relative w-full overflow-hidden p-5 text-left transition-all hover:-translate-y-1 hover:border-primary/45 hover:bg-surface-raised"
      >
        <span className="absolute left-0 top-0 h-full w-0.5 bg-border transition-colors group-hover:bg-primary" />
        <div className="flex items-start justify-between gap-3">
          <span className="font-data text-[9px] text-muted">
            ROOM / {room.id.slice(-6).toUpperCase()}
          </span>
          <span
            className={`flex items-center gap-1.5 text-[10px] ${room.visibility === "public" ? "text-human" : "text-muted"}`}
          >
            <Icon
              name={room.visibility === "public" ? "globe" : "lock"}
              size={12}
            />
            {room.visibility === "public" ? "公开" : "私有"}
          </span>
        </div>
        <h3 className="mt-7 truncate text-lg font-bold tracking-tight text-text">
          {room.name}
        </h3>
        <div className="mt-4 flex items-center justify-between border-t border-border/70 pt-3">
          <span className="font-data text-[9px] text-muted">
            {member.role === "owner" ? "OWNER" : "MEMBER"} ·{" "}
            {formatDate(room.createdAt)}
          </span>
          <Icon
            name="arrow"
            size={16}
            className="text-muted transition-transform group-hover:translate-x-1 group-hover:text-primary"
          />
        </div>
      </button>
    </li>
  );
}

function PublicRoomCard({
  room,
  pending,
  onJoin,
}: {
  room: Room;
  pending: boolean;
  onJoin: () => void;
}) {
  return (
    <li className="panel-soft flex items-center gap-4 p-4">
      <span className="grid size-9 shrink-0 place-items-center border border-human/30 bg-human/10 text-human">
        <Icon name="globe" size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-text">{room.name}</p>
        <p className="font-data mt-1 text-[9px] text-muted">
          {formatDate(room.createdAt)} · OPEN
        </p>
      </div>
      <button
        type="button"
        onClick={onJoin}
        disabled={pending}
        className="button-secondary h-9 px-3 text-xs text-primary"
      >
        {pending ? "加入中" : "加入"}
        <Icon name="arrow" size={14} />
      </button>
    </li>
  );
}
