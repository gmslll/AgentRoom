import { useState } from "react";
import type { ConnectorResponse, RotateInviteResponse } from "../api/types";
import { useRotateInvite } from "../api/hooks";
import { CopyButton } from "./CopyButton";

interface ConnectPanelProps {
  roomId: string;
  connector: ConnectorResponse | undefined;
  loading: boolean;
  /** True when the current user is the room owner. */
  isOwner: boolean;
  /** True while waiting for an agent to join after copying a command. */
  waitingForAgent: boolean;
  /** Called after the user copies a join command (enters "waiting for agent"). */
  onCommandCopied?: () => void;
}

/**
 * "Connect your agent" onboarding for the room owner: installers, copyable CLI
 * commands, and the invite code. Commands come from the backend connector
 * object and are never assembled in the frontend.
 */
export function ConnectPanel({
  roomId,
  connector,
  loading,
  isOwner,
  waitingForAgent,
  onCommandCopied,
}: ConnectPanelProps) {
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const rotate = useRotateInvite(roomId);

  const handleShowInvite = async () => {
    if (inviteCode) return;
    const result = await rotate.mutateAsync();
    setInviteCode(result.inviteCode);
  };

  const handleRotate = async () => {
    let result: RotateInviteResponse;
    try {
      result = await rotate.mutateAsync();
    } catch {
      return;
    }
    setInviteCode(result.inviteCode);
  };

  if (!isOwner) {
    return (
      <div className="space-y-3 p-4 text-sm text-muted">
        <p>只有房间 owner 可以接入 Agent 或查看邀请码。</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 text-sm">
      <div>
        <h3 className="mb-1 text-sm font-semibold text-text">连接本地 Agent</h3>
        <p className="text-xs leading-relaxed text-muted">
          需要 Node.js 22+ 和已登录的 Claude Code 或 Codex CLI。先在终端{" "}
          <code className="font-mono">cd</code> 到希望 AI 操作的项目目录,再在
          终端里运行下面的命令。
        </p>
      </div>

      {loading || !connector ? (
        <p className="text-xs text-muted">正在获取连接信息…</p>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-xs text-muted">① 安装 AgentRoom CLI(二选一):</p>
            <div className="flex gap-2">
              <a
                href={connector.connector.installers.macosLinuxUrl}
                className="rounded-md border border-border px-2 py-1 text-xs text-text transition-colors hover:border-border-strong hover:bg-surface-raised"
              >
                macOS / Linux 安装器
              </a>
              <a
                href={connector.connector.installers.windowsUrl}
                className="rounded-md border border-border px-2 py-1 text-xs text-text transition-colors hover:border-border-strong hover:bg-surface-raised"
              >
                Windows 安装器
              </a>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted">② 复制并运行加入命令:</p>
            <CommandRow
              label="新会话加入"
              command={connector.connector.command}
              onCopied={onCommandCopied}
            />
            <CommandRow
              label="已有会话加入"
              command={connector.connector.attachCommand}
              onCopied={onCommandCopied}
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted">③ 邀请码(CLI 会交互式询问):</p>
            {inviteCode ? (
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-text">
                  {inviteCode}
                </code>
                <CopyButton text={inviteCode} label="复制" />
                <button
                  type="button"
                  onClick={handleRotate}
                  disabled={rotate.isPending}
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted transition-colors hover:border-border-strong hover:text-text disabled:opacity-50"
                  title="旧邀请码将立即失效"
                >
                  重新生成
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleShowInvite}
                disabled={rotate.isPending}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-text transition-colors hover:border-border-strong hover:bg-surface-raised disabled:opacity-50"
              >
                显示邀请码
              </button>
            )}
            {rotate.isSuccess && (
              <p className="text-xs text-warning">
                新邀请码已生成,旧邀请码立即失效。
              </p>
            )}
            <div className="flex items-center gap-2">
              <CopyButton
                text={`${window.location.origin}/rooms/${roomId}`}
                label="复制邀请链接"
              />
              <span className="text-xs text-muted">
                分享给他人:打开链接后用上面的邀请码加入
              </span>
            </div>
          </div>

          {waitingForAgent && (
            <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
              等待 Agent 加入…复制命令后,在终端运行并完成交互式询问即可。
            </div>
          )}
        </>
      )}

      <p className="text-xs text-muted">
        ⚠ 开发预览:<code className="font-mono">@agentroom/bridge</code> 尚未发布
        npm,当前通过后端直接分发安装器。
      </p>
    </div>
  );
}

function CommandRow({
  label,
  command,
  onCopied,
}: {
  label: string;
  command: string;
  onCopied?: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-text">
        {command}
      </code>
      <CopyButton text={command} label={label} onCopied={onCopied} />
    </div>
  );
}
