import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  useCreateModerationRule,
  useDeleteModerationRule,
  useDissolveRoom,
  useModerationRules,
  useRoomAttachments,
  useUpdateRoom,
} from "../api/hooks";
import type { ModerationAction, Room, RoomVisibility } from "../api/types";
import { features } from "../config/features";
import { formatBytes } from "../lib/format";
import { formatDate } from "../lib/time";
import { Icon } from "./ui/Icon";

interface RoomSettingsPanelProps {
  room: Room;
  onDissolved: () => void;
}

export function RoomSettingsPanel({
  room,
  onDissolved,
}: RoomSettingsPanelProps) {
  const updateRoom = useUpdateRoom(room.id);
  const dissolveRoom = useDissolveRoom(room.id);
  const [name, setName] = useState(room.name);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [dissolveOpen, setDissolveOpen] = useState(false);
  useEffect(() => setName(room.name), [room.name]);

  const saveName = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = name.trim();
    if (!next || next === room.name) return;
    setError(null);
    try {
      await updateRoom.mutateAsync({ name: next });
    } catch (cause) {
      setError(errorText(cause, "保存房间名称失败"));
    }
  };

  const setVisibility = async (visibility: RoomVisibility) => {
    if (visibility === room.visibility) return;
    setError(null);
    try {
      await updateRoom.mutateAsync({ visibility });
    } catch (cause) {
      setError(errorText(cause, "更新公开状态失败"));
    }
  };

  const dissolve = async () => {
    if (confirmation !== room.name) return;
    setError(null);
    try {
      await dissolveRoom.mutateAsync();
      onDissolved();
    } catch (cause) {
      setError(errorText(cause, "解散聊天室失败"));
    }
  };

  return (
    <div className="space-y-8 p-4">
      {error && (
        <p className="border-l-2 border-danger bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
      <section>
        <SectionTitle index="01" title="房间标识" />
        <form onSubmit={saveName} className="flex gap-2">
          <input
            className="field-control h-10 min-w-0 flex-1 px-3 text-xs"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
          />
          <button
            className="button-secondary h-10 px-3 text-xs"
            disabled={
              updateRoom.isPending || !name.trim() || name.trim() === room.name
            }
          >
            保存
          </button>
        </form>
      </section>
      <section>
        <SectionTitle index="02" title="可见性" />
        <div className="grid grid-cols-2 gap-2">
          {(["private", "public"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => void setVisibility(value)}
              disabled={updateRoom.isPending}
              className={`border p-3 text-left ${room.visibility === value ? "border-primary bg-primary/10" : "border-border bg-bg/50"}`}
            >
              <Icon
                name={value === "private" ? "lock" : "globe"}
                size={15}
                className={
                  room.visibility === value ? "text-primary" : "text-muted"
                }
              />
              <span className="mt-2 block text-xs font-bold text-text">
                {value === "private" ? "私有" : "公开"}
              </span>
              <span className="mt-1 block text-[9px] text-muted">
                {value === "private" ? "邀请码加入" : "公开发现"}
              </span>
            </button>
          ))}
        </div>
      </section>
      {features.moderation && <ModerationManager roomId={room.id} />}
      <AttachmentManager roomId={room.id} />
      <section className="border-t border-danger/25 pt-6">
        <SectionTitle index="05" title="危险操作" danger />
        <p className="text-[11px] leading-5 text-muted">
          解散后全部成员与 Agent 立即掉线，历史不再可访问。
        </p>
        {!dissolveOpen ? (
          <button
            type="button"
            onClick={() => setDissolveOpen(true)}
            className="mt-3 border border-danger/35 px-3 py-2 text-xs text-danger hover:bg-danger/10"
          >
            解散聊天室
          </button>
        ) : (
          <div className="mt-3 border border-danger/30 bg-danger/5 p-3">
            <p className="text-[11px] text-text">
              输入 <strong>{room.name}</strong> 确认：
            </p>
            <input
              className="field-control mt-2 h-10 px-3 text-xs"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void dissolve()}
                disabled={confirmation !== room.name || dissolveRoom.isPending}
                className="h-9 bg-danger px-3 text-xs font-bold text-white disabled:opacity-40"
              >
                {dissolveRoom.isPending ? "解散中…" : "永久解散"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDissolveOpen(false);
                  setConfirmation("");
                }}
                className="button-secondary h-9 px-3 text-xs"
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

function ModerationManager({ roomId }: { roomId: string }) {
  const rules = useModerationRules(roomId, true);
  const create = useCreateModerationRule(roomId);
  const remove = useDeleteModerationRule(roomId);
  const [pattern, setPattern] = useState("");
  const [action, setAction] = useState<ModerationAction>("flag");
  return (
    <section>
      <SectionTitle index="03" title="内容审核" />
      <p className="mb-3 text-[11px] leading-5 text-muted">
        不区分大小写的子串规则；flag 标记消息，reject 直接拒绝发送。
      </p>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pattern.trim()) return;
          create.mutate(
            { pattern: pattern.trim(), action },
            { onSuccess: () => setPattern("") },
          );
        }}
      >
        <input
          className="field-control h-10 px-3 text-xs"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          placeholder="匹配文本"
          maxLength={200}
        />
        <div className="flex gap-2">
          <select
            className="field-control h-10 min-w-0 flex-1 px-3 text-xs"
            value={action}
            onChange={(event) =>
              setAction(event.target.value as ModerationAction)
            }
          >
            <option value="flag">标记但允许</option>
            <option value="reject">直接拒绝</option>
          </select>
          <button
            className="button-secondary h-10 px-3 text-xs text-primary"
            disabled={create.isPending || !pattern.trim()}
          >
            添加
          </button>
        </div>
      </form>
      {rules.isError && (
        <p className="mt-2 text-[10px] text-warning">审核功能当前不可用。</p>
      )}
      <div className="mt-3 space-y-1.5">
        {rules.data?.items.map((rule) => (
          <div
            key={rule.id}
            className="flex items-center gap-2 border border-border px-3 py-2"
          >
            <span
              className={`font-data text-[9px] ${rule.action === "reject" ? "text-danger" : "text-warning"}`}
            >
              {rule.action.toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-text">
              {rule.pattern}
            </span>
            <button
              type="button"
              onClick={() => remove.mutate(rule.id)}
              className="text-[10px] text-muted hover:text-danger"
            >
              删除
            </button>
          </div>
        ))}
      </div>
      {create.error && (
        <p className="mt-2 text-[10px] text-danger">
          {errorText(create.error, "添加规则失败")}
        </p>
      )}
    </section>
  );
}

function AttachmentManager({ roomId }: { roomId: string }) {
  const [open, setOpen] = useState(false);
  const attachments = useRoomAttachments(roomId, open);
  return (
    <section>
      <SectionTitle index="04" title="附件台账" />
      <p className="text-[11px] leading-5 text-muted">
        普通聊天不会全量拉取附件；这里只在你主动打开时请求房间级元数据。
      </p>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="button-secondary mt-3 h-9 px-3 text-xs"
      >
        <Icon name="file" size={14} />
        {open ? "收起台账" : "查看附件台账"}
      </button>
      {open && (
        <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto">
          {attachments.isPending ? (
            <p className="text-[10px] text-muted">加载中…</p>
          ) : (attachments.data?.items ?? []).length === 0 ? (
            <p className="well p-3 text-[10px] text-muted">暂无附件</p>
          ) : (
            attachments.data?.items.map((item) => (
              <div key={item.id} className="border border-border px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs text-text">
                    {item.name}
                  </span>
                  <span
                    className={`font-data text-[9px] ${item.scanState === "flagged" ? "text-danger" : item.scanState === "clean" ? "text-primary" : "text-warning"}`}
                  >
                    {item.scanState}
                  </span>
                </div>
                <p className="font-data mt-1 text-[9px] text-muted">
                  {formatBytes(item.size)} · {formatDate(item.createdAt)}
                </p>
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}

function SectionTitle({
  index,
  title,
  danger = false,
}: {
  index: string;
  title: string;
  danger?: boolean;
}) {
  return (
    <div className="mb-3">
      <p className={`eyebrow text-[9px] ${danger ? "text-danger" : ""}`}>
        {index} / Room control
      </p>
      <h3
        className={`mt-1.5 text-sm font-bold ${danger ? "text-danger" : "text-text"}`}
      >
        {title}
      </h3>
    </div>
  );
}
function errorText(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}
