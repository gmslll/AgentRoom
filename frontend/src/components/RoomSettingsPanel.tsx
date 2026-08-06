import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { useDissolveRoom, useUpdateRoom } from "../api/hooks";
import type { Room, RoomVisibility } from "../api/types";

interface RoomSettingsPanelProps {
  room: Room;
  onDissolved: () => void;
}

export function RoomSettingsPanel({ room, onDissolved }: RoomSettingsPanelProps) {
  const updateRoom = useUpdateRoom(room.id);
  const dissolveRoom = useDissolveRoom(room.id);
  const [name, setName] = useState(room.name);
  const [error, setError] = useState<string | null>(null);
  const [dissolveOpen, setDissolveOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => setName(room.name), [room.name]);

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || nextName === room.name) return;
    setError(null);
    try {
      await updateRoom.mutateAsync({ name: nextName });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "保存房间名称失败");
    }
  };

  const setVisibility = async (visibility: RoomVisibility) => {
    if (visibility === room.visibility || updateRoom.isPending) return;
    setError(null);
    try {
      await updateRoom.mutateAsync({ visibility });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "更新公开状态失败");
    }
  };

  const dissolve = async () => {
    if (confirmation !== room.name || dissolveRoom.isPending) return;
    setError(null);
    try {
      await dissolveRoom.mutateAsync();
      onDissolved();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "解散聊天室失败");
    }
  };

  return (
    <div className="space-y-6 p-4">
      {error && (
        <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          房间名称
        </h3>
        <form onSubmit={saveName} className="flex gap-2">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2.5 py-1.5 text-sm text-text focus:border-primary focus:outline-none"
          />
          <button
            type="submit"
            disabled={
              updateRoom.isPending ||
              !name.trim() ||
              name.trim() === room.name
            }
            className="rounded-md border border-border px-2.5 py-1.5 text-xs text-muted hover:border-primary/50 hover:text-primary disabled:opacity-40"
          >
            保存
          </button>
        </form>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          可见性
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ["private", "私有", "需要邀请码加入"],
              ["public", "公开", "可发现并直接加入"],
            ] as const
          ).map(([value, label, description]) => (
            <button
              key={value}
              type="button"
              onClick={() => void setVisibility(value)}
              disabled={updateRoom.isPending}
              className={`rounded-lg border p-2 text-left transition-colors disabled:opacity-50 ${
                room.visibility === value
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-border-strong"
              }`}
            >
              <span className="block text-sm font-medium text-text">{label}</span>
              <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                {description}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="border-t border-danger/20 pt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-danger">
          危险操作
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          解散后所有成员和 Agent 会立即掉线，历史数据不再可访问。此操作不可从网页恢复。
        </p>
        {!dissolveOpen ? (
          <button
            type="button"
            onClick={() => setDissolveOpen(true)}
            className="mt-3 rounded-md border border-danger/40 px-3 py-1.5 text-xs text-danger hover:bg-danger/10"
          >
            解散聊天室
          </button>
        ) : (
          <div className="mt-3 space-y-2 rounded-lg border border-danger/30 bg-danger/5 p-3">
            <p className="text-xs text-text">
              输入房间名 <strong>{room.name}</strong> 确认：
            </p>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="w-full rounded-md border border-danger/30 bg-bg px-2.5 py-1.5 text-sm text-text focus:border-danger focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void dissolve()}
                disabled={confirmation !== room.name || dissolveRoom.isPending}
                className="rounded-md bg-danger px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
              >
                {dissolveRoom.isPending ? "解散中…" : "永久解散"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDissolveOpen(false);
                  setConfirmation("");
                }}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
