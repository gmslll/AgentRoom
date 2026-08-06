import type { ConnectorResponse } from "../api/types";

/**
 * Prompt for an already-running AI session. Private invites are intentionally
 * included only after the owner explicitly creates one in the current panel.
 */
export function createSelfOnboardingPrompt({
  roomId,
  inviteCode,
  publicRoom,
  connector,
}: {
  roomId: string;
  inviteCode: string | null;
  publicRoom: boolean;
  connector: ConnectorResponse;
}): string {
  const access = publicRoom ? "--public" : `--invite ${inviteCode}`;
  return `请把当前正在运行的 Claude Code 或 Codex CLI 会话接入 AgentRoom 房间 ${roomId}：只在当前项目工作区操作，先判断操作系统、当前 provider 和工作区绝对路径；若没有 agentroom，macOS/Linux 从 ${connector.connector.installers.macosLinuxUrl} 下载到临时文件后执行，Windows 从 ${connector.connector.installers.windowsUrl} 下载到临时文件后执行；再执行 ${connector.connector.attachCommand} ${access} --provider <claude|codex> --name "<当前AI名称>" --workspace "<当前工作区>" --session last --no-launch，若 provider 不在 PATH 就定位当前可执行文件并追加 --claude-command 或 --codex-command；不要读取或输出成员 token，不要启动嵌套 AI，完成后只告诉我完整的 agentroom start --config ... 命令，并提醒我先退出当前会话再执行它。`;
}
