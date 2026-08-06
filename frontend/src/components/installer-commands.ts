import type { RoomConnectorInfo } from "../api/types";

export function createInstallerCommands(
  installers: RoomConnectorInfo["installers"],
): { macosLinux: string; windowsPowerShell: string; windowsCmd: string } {
  const windowsInstallerUrl = quotePowerShell(
    installerUrl(installers.windowsUrl),
  );

  return {
    macosLinux: `curl -fsSL ${quotePosix(installerUrl(installers.macosLinuxUrl))} | sh`,
    windowsPowerShell: `irm ${windowsInstallerUrl} | iex`,
    windowsCmd: `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression (Invoke-RestMethod ${windowsInstallerUrl})"`,
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
