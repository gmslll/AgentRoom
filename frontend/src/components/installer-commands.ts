import type { RoomConnectorInfo } from "../api/types";

export function createInstallerCommands(
  installers: RoomConnectorInfo["installers"],
): { macosLinux: string; windows: string } {
  return {
    macosLinux: `curl -fsSL ${quotePosix(installerUrl(installers.macosLinuxUrl))} | sh`,
    windows: `irm ${quotePowerShell(installerUrl(installers.windowsUrl))} | iex`,
  };
}

function installerUrl(value: string): string {
  return new URL(value, window.location.origin).toString();
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
