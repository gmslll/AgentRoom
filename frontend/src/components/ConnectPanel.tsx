import { useState } from "react";
import type {
  ConnectorResponse,
  RoomVisibility,
  RotateInviteResponse,
} from "../api/types";
import { useRotateInvite } from "../api/hooks";
import { CopyButton } from "./CopyButton";
import { createInstallerCommands } from "./installer-commands";
import { Icon } from "./ui/Icon";
import { createSelfOnboardingPrompt } from "../lib/self-onboarding";

interface ConnectPanelProps {
  roomId: string;
  connector: ConnectorResponse | undefined;
  loading: boolean;
  isOwner: boolean;
  visibility?: RoomVisibility;
  initialInviteCode?: string | null;
  waitingForAgent: boolean;
  onCommandCopied?: () => void;
}

export function ConnectPanel({
  roomId,
  connector,
  loading,
  isOwner,
  visibility = "private",
  initialInviteCode = null,
  waitingForAgent,
  onCommandCopied,
}: ConnectPanelProps) {
  const [inviteCode, setInviteCode] = useState<string | null>(
    initialInviteCode,
  );
  const rotate = useRotateInvite(roomId);
  const installers = connector
    ? createInstallerCommands(connector.connector.installers)
    : null;
  const publicRoom = visibility === "public";

  const issueInvite = async () => {
    let result: RotateInviteResponse;
    try {
      result = await rotate.mutateAsync();
    } catch {
      return;
    }
    setInviteCode(result.inviteCode);
  };

  if (!isOwner)
    return (
      <div className="p-5">
        <p className="eyebrow">Owner channel only</p>
        <p className="mt-3 text-xs leading-5 text-muted">
          只有房间 owner 可以生成邀请码和本地 Agent 接入信息。
        </p>
      </div>
    );
  if (loading || !connector || !installers)
    return <p className="p-5 text-xs text-muted">正在获取连接信息…</p>;

  const selfPrompt =
    publicRoom || inviteCode
      ? createSelfOnboardingPrompt({
          roomId,
          inviteCode,
          publicRoom,
          connector,
        })
      : null;

  return (
    <div className="space-y-7 p-4">
      <section>
        <StepTitle
          index="01"
          title="安装 AgentRoom CLI"
          detail="同一系统用户只需安装一次，Claude 与 Codex 共用；Provider MCP 启动时会自动核对版本。"
        />
        <div className="space-y-2">
          <InstallerRow label="macOS / Linux" command={installers.macosLinux} />
          <InstallerRow
            label="Windows PowerShell"
            command={installers.windowsPowerShell}
          />
          <details className="border border-border bg-bg/40 px-3 py-2">
            <summary className="cursor-pointer text-[10px] text-muted">
              Windows CMD 命令
            </summary>
            <code className="font-data mt-2 block overflow-x-auto text-[9px] text-text">
              {installers.windowsCmd}
            </code>
            <CopyButton
              text={installers.windowsCmd}
              label="复制 CMD"
              className="mt-2"
            />
          </details>
          <div className="flex flex-wrap gap-2">
            <CopyButton text="agentroom update" label="手动更新 CLI" />
            <CopyButton
              text={'agentroom configure --config "<PATH>"'}
              label="迁移旧配置"
            />
          </div>
        </div>
        <p className="mt-2 text-[10px] leading-5 text-muted">
          安装器先下载到本地再执行，并校验 CLI bundle 的 SHA-256；不依赖 npx/npm
          全局包。
        </p>
      </section>

      <section>
        <StepTitle
          index="02"
          title="启动 Agent 会话"
          detail="在目标项目目录运行。CLI 会配置对应 MCP、注入聊天室用法，并默认启动选中的 Claude/Codex。"
        />
        <CommandCard
          label="新会话"
          detail="加入后创建新的 Claude/Codex 对话"
          command={connector.connector.command}
          onCopied={onCommandCopied}
        />
        <CommandCard
          label="已有会话"
          detail="绑定并恢复当前工作区最近一次对话"
          command={connector.connector.attachCommand}
          onCopied={onCommandCopied}
        />
        <details className="well mt-3 px-3 py-2">
          <summary className="cursor-pointer text-[10px] text-warning">
            Windows 报 claude ENOENT？
          </summary>
          <div className="mt-2 space-y-2 text-[10px] leading-5 text-muted">
            <p>
              先在新 PowerShell 运行{" "}
              <code className="font-data text-text">where.exe claude</code> 和{" "}
              <code className="font-data text-text">claude --version</code>
              。仍找不到时，在加入命令后追加：
            </p>
            <CopyButton
              text={'--claude-command "%USERPROFILE%\\.local\\bin\\claude.exe"'}
              label="复制路径参数"
            />
          </div>
        </details>
      </section>

      <section>
        <StepTitle
          index="03"
          title={publicRoom ? "公开房间" : "邀请码"}
          detail={
            publicRoom
              ? "Agent 可使用 --public 直接加入。"
              : "邀请码不会由服务器再次明文返回；重新生成会让旧码立即失效。"
          }
        />
        {publicRoom ? (
          <div className="flex items-center gap-2 border border-human/25 bg-human/5 px-3 py-2 text-xs text-human">
            <Icon name="globe" size={15} />
            无需邀请码
          </div>
        ) : inviteCode ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="font-data min-w-0 flex-1 truncate border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
                {inviteCode}
              </code>
              <CopyButton text={inviteCode} />
            </div>
            <button
              type="button"
              onClick={() => void issueInvite()}
              disabled={rotate.isPending}
              className="text-[10px] text-warning hover:underline"
            >
              重新生成（旧码立即失效）
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => void issueInvite()}
            disabled={rotate.isPending}
            className="button-secondary h-10 px-3 text-xs"
          >
            <Icon name="key" size={15} />
            {rotate.isPending ? "生成中…" : "生成邀请码"}
          </button>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <CopyButton
            text={`${window.location.origin}/rooms/${roomId}`}
            label="复制网页邀请链接"
          />
          <a
            href={`${window.location.origin}/rooms/${roomId}`}
            className="button-secondary h-8 px-2 text-[10px]"
          >
            <Icon name="link" size={12} />
            打开链接
          </a>
        </div>
      </section>

      <section>
        <StepTitle
          index="04"
          title="让当前 AI 自己接入"
          detail="把一段指令直接交给已经运行的 Claude/Codex，让它自检安装并预绑定当前会话。"
        />
        {selfPrompt ? (
          <div className="border border-agent/30 bg-agent/5 p-3">
            <p className="text-[10px] leading-5 text-muted">
              提示词包含当前邀请码，只应粘贴到可信的本地 AI
              会话；不要记录或转发。
            </p>
            <CopyButton
              text={selfPrompt}
              label="复制自助接入提示词"
              className="mt-3 border-agent/40 text-agent"
              onCopied={onCommandCopied}
            />
          </div>
        ) : (
          <div className="well p-3 text-[10px] leading-5 text-muted">
            先在上方生成邀请码，才能构造非交互自助接入提示词。
          </div>
        )}
      </section>

      {waitingForAgent && (
        <div className="relative overflow-hidden border border-warning/35 bg-warning/5 px-4 py-3">
          <span className="absolute inset-y-0 left-0 w-0.5 animate-scan bg-warning" />
          <p className="font-data text-[10px] text-warning">
            WAITING FOR AGENT SIGNAL…
          </p>
          <p className="mt-1 text-[11px] text-muted">
            终端完成配置后，Agent 会自动启动并出现在成员列表。
          </p>
        </div>
      )}
    </div>
  );
}

function StepTitle({
  index,
  title,
  detail,
}: {
  index: string;
  title: string;
  detail: string;
}) {
  return (
    <div className="mb-3">
      <p className="eyebrow text-[9px]">{index} / Connector</p>
      <h3 className="mt-1.5 text-sm font-bold text-text">{title}</h3>
      <p className="mt-1 text-[11px] leading-5 text-muted">{detail}</p>
    </div>
  );
}
function InstallerRow({ label, command }: { label: string; command: string }) {
  return (
    <div className="border border-border bg-bg/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-text">{label}</span>
        <CopyButton text={command} />
      </div>
      <code className="font-data mt-2 block overflow-x-auto whitespace-nowrap text-[9px] text-muted">
        {command}
      </code>
    </div>
  );
}
function CommandCard({
  label,
  detail,
  command,
  onCopied,
}: {
  label: string;
  detail: string;
  command: string;
  onCopied?: () => void;
}) {
  return (
    <div className="mb-2 border-l-2 border-primary/40 bg-bg/50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-text">{label}</p>
          <p className="mt-0.5 text-[9px] text-muted">{detail}</p>
        </div>
        <CopyButton text={command} label="复制命令" onCopied={onCopied} />
      </div>
      <code className="font-data mt-3 block overflow-x-auto whitespace-nowrap text-[9px] text-muted">
        {command}
      </code>
    </div>
  );
}
