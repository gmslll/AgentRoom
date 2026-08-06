import { useState } from "react";
import type { ConnectorResponse, RotateInviteResponse } from "../api/types";
import { useRotateInvite } from "../api/hooks";
import { CopyButton } from "./CopyButton";
import { createInstallerCommands } from "./installer-commands";

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
  const installerCommands = connector
    ? createInstallerCommands(connector.connector.installers)
    : null;

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
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs text-muted">
                ① 第一次使用，复制对应系统的安装命令：
              </p>
              <span className="shrink-0 rounded-full border border-terminal/20 bg-terminal/5 px-2 py-0.5 text-[10px] text-terminal">
                只需安装一次
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <InstallerCard
                platform="macOS / Linux"
                prompt="$"
                command={installerCommands!.macosLinux}
                installerUrl={connector.connector.installers.macosLinuxUrl}
              />
              <InstallerCard
                platform="Windows PowerShell"
                prompt="PS>"
                command={installerCommands!.windows}
                installerUrl={connector.connector.installers.windowsUrl}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted">
              安装器会校验 CLI 的 SHA-256。安装完成后重新打开终端，运行{" "}
              <code className="font-mono text-text">agentroom --version</code>{" "}
              验证。
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted">
              ② 在目标项目目录中复制并运行加入命令：
            </p>
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
            <p className="text-xs text-muted">
              ③ 获取邀请码（CLI 会交互式询问）：
            </p>
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
        Claude Code 与 Codex 共用这份用户级安装；Provider MCP 启动时会自动检查并
        更新 AgentRoom。
      </p>
    </div>
  );
}

function InstallerCard({
  platform,
  prompt,
  command,
  installerUrl,
}: {
  platform: string;
  prompt: string;
  command: string;
  installerUrl: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface p-2.5 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text">{platform}</span>
        <a
          href={installerUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[10px] text-muted underline decoration-border-strong underline-offset-2 transition-colors hover:text-text"
        >
          查看脚本
        </a>
      </div>
      <div className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5">
        <span className="shrink-0 font-mono text-[10px] text-terminal">
          {prompt}
        </span>
        <code
          className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-text"
          title={command}
        >
          {command}
        </code>
        <CopyButton text={command} label="复制" className="shrink-0" />
      </div>
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
