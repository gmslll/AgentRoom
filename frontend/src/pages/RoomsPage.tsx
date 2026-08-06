import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useCreateRoom, useLogout, useRooms } from "../api/hooks";
import { useTokenStore } from "../stores/tokenStore";
import { formatDate } from "../lib/time";

export default function RoomsPage() {
  const token = useTokenStore((state) => state.token);
  const user = useTokenStore((state) => state.user);
  const navigate = useNavigate();
  const [roomName, setRoomName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const rooms = useRooms();
  const createRoom = useCreateRoom();
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
      const result = await createRoom.mutateAsync(name);
      setRoomName("");
      navigate(`/rooms/${result.room.id}`);
    } catch (error) {
      setCreateError(
        error instanceof ApiError ? error.message : "创建失败,请重试",
      );
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col bg-bg p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-gradient text-2xl font-extrabold tracking-tight">
          我的聊天室
        </h1>
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

      <form onSubmit={handleCreate} className="mb-6 flex gap-2">
        <input
          type="text"
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          placeholder="新聊天室名称"
          maxLength={100}
          className="min-w-0 flex-1 rounded-md border border-border bg-black/25 px-3 py-2 text-sm text-text placeholder:text-muted/60 transition-shadow focus:border-primary/70 focus:shadow-[0_0_0_3px_rgba(91,140,255,0.15)] focus:outline-none"
        />
        <button
          type="submit"
          disabled={createRoom.isPending || roomName.trim().length === 0}
          className="press rounded-md bg-gradient-to-r from-primary to-[#7c6cff] px-4 py-2 text-sm font-medium text-white shadow-[0_4px_16px_rgba(91,140,255,0.35)] transition-shadow hover:shadow-[0_6px_22px_rgba(91,140,255,0.45)] disabled:opacity-50 disabled:shadow-none"
        >
          {createRoom.isPending ? "创建中…" : "创建聊天室"}
        </button>
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
                className="card-hover glass group flex w-full items-center justify-between rounded-xl px-4 py-3 text-left"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-text">
                    {room.name}
                  </span>
                  <span className="block text-xs text-muted">
                    {member.role === "owner" ? "owner · " : ""}
                    {formatDate(room.createdAt)} 创建
                  </span>
                </span>
                <span className="text-muted transition-transform duration-150 group-hover:translate-x-0.5">
                  →
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
