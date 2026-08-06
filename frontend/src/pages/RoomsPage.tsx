import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import {
  useCreateRoom,
  useJoinPublicRoom,
  useLogout,
  usePublicRooms,
  useRooms,
} from "../api/hooks";
import type { RoomVisibility } from "../api/types";
import { useTokenStore } from "../stores/tokenStore";
import { formatDate } from "../lib/time";

export default function RoomsPage() {
  const token = useTokenStore((state) => state.token);
  const user = useTokenStore((state) => state.user);
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState("");
  const [visibility, setVisibility] = useState<RoomVisibility>("private");
  const [createError, setCreateError] = useState<string | null>(null);
  const [publicError, setPublicError] = useState<string | null>(null);

  const rooms = useRooms();
  const createRoom = useCreateRoom();
  const publicRooms = usePublicRooms();
  const joinPublicRoom = useJoinPublicRoom();
  const logout = useLogout();

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = roomName.trim();
    if (!name || createRoom.isPending) return;
    setCreateError(null);
    try {
      const result = await createRoom.mutateAsync({ name, visibility });
      setRoomName("");
      navigate(`/rooms/${result.room.id}`);
    } catch (error) {
      setCreateError(
        error instanceof ApiError ? error.message : "创建失败,请重试",
      );
    }
  };

  const handleJoinPublic = async (roomId: string) => {
    setPublicError(null);
    try {
      await joinPublicRoom.mutateAsync(roomId);
      navigate(`/rooms/${roomId}`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "ACCOUNT_ALREADY_MEMBER") {
        navigate(`/rooms/${roomId}`);
        return;
      }
      setPublicError(
        error instanceof ApiError ? error.message : "加入公开房间失败",
      );
    }
  };

  const joinedRoomIds = new Set(
    (rooms.data?.items ?? []).map(({ room }) => room.id),
  );
  const discoverableRooms = (publicRooms.data?.items ?? []).filter(
    (room) => !joinedRoomIds.has(room.id),
  );

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col bg-bg p-6">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <p className="font-data mb-1 text-[11px] uppercase tracking-[0.2em] text-muted">
            ~/rooms
          </p>
          <h1 className="text-2xl font-bold tracking-tight text-text">
            我的聊天室
          </h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted">
            {user?.displayName ?? user?.email ?? ""}
          </span>
          <button
            type="button"
            onClick={() => logout.mutate()}
            disabled={logout.isPending}
            className="rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
          >
            退出登录
          </button>
        </div>
      </header>

      <form
        onSubmit={handleCreate}
        className="mb-6 rounded-xl border border-border bg-surface p-3"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="新聊天室名称"
            maxLength={100}
            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-3 py-2 text-sm text-text placeholder:text-muted/60 focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={createRoom.isPending || roomName.trim().length === 0}
            className="press rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover disabled:opacity-50"
          >
            {createRoom.isPending ? "创建中…" : "创建聊天室"}
          </button>
        </div>
        <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={visibility === "public"}
            onChange={(event) =>
              setVisibility(event.target.checked ? "public" : "private")
            }
            className="accent-primary"
          />
          设为公开聊天室(可被发现并免邀请码加入)
        </label>
      </form>
      {createError && <p className="mb-4 text-sm text-danger">{createError}</p>}

      {rooms.isPending ? (
        <p className="text-sm text-muted">加载中…</p>
      ) : rooms.isError ? (
        <p className="text-sm text-danger">
          {(rooms.error as ApiError)?.message ?? "加载失败"}
        </p>
      ) : rooms.data && rooms.data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted">
          还没有聊天室。创建一个,然后接入你的本地 Agent 开始协作。
        </div>
      ) : (
        <ul className="space-y-2">
          {(rooms.data?.items ?? []).map(({ room, member }, index) => (
            <li
              key={room.id}
              className="animate-rise-in"
              style={{ animationDelay: `${index * 45}ms` }}
            >
              <button
                type="button"
                onClick={() => navigate(`/rooms/${room.id}`)}
                className="press group flex w-full items-center justify-between rounded-lg border border-border-strong bg-surface px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-px hover:border-primary/50 hover:shadow-md"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-text">
                    {room.name}
                  </span>
                  <span className="font-data block text-[11px] text-muted">
                    {member.role === "owner" ? "owner · " : ""}
                    {formatDate(room.createdAt)} 创建
                  </span>
                </span>
                <span className="font-data text-xs text-muted transition-transform duration-150 group-hover:translate-x-0.5">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8 border-t border-border pt-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-text">发现公开聊天室</h2>
            <p className="mt-0.5 text-xs text-muted">公开房间无需邀请码即可加入</p>
          </div>
          {publicRooms.isFetching && (
            <span className="text-xs text-muted">刷新中…</span>
          )}
        </div>
        {publicError && <p className="mb-3 text-sm text-danger">{publicError}</p>}
        {discoverableRooms.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted">
            暂时没有可加入的公开聊天室
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {discoverableRooms.map((room) => (
              <li
                key={room.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-text">{room.name}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {formatDate(room.createdAt)} 创建
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleJoinPublic(room.id)}
                  disabled={
                    joinPublicRoom.isPending &&
                    joinPublicRoom.variables === room.id
                  }
                  className="shrink-0 rounded-md border border-primary/40 px-2.5 py-1 text-xs text-primary hover:bg-primary/10 disabled:opacity-50"
                >
                  {joinPublicRoom.isPending && joinPublicRoom.variables === room.id
                    ? "加入中…"
                    : "加入"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
