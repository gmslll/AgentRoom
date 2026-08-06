import type { RoomConnectorInfo } from "../api/types";

export function createInstallerCommands(
  installers: RoomConnectorInfo["installers"],
): { macosLinux: string; windowsPowerShell: string; windowsCmd: string } {
  const windowsInstallerUrl = quotePowerShell(
    installerUrl(installers.windowsUrl),
  );

  return {
    macosLinux: `curl -fL -o agentroom-install.sh ${quotePosix(installerUrl(installers.macosLinuxUrl))} && sh agentroom-install.sh`,
    windowsPowerShell: `Invoke-WebRequest ${windowsInstallerUrl} -OutFile agentroom-install.ps1; powershell -ExecutionPolicy Bypass -File .\\agentroom-install.ps1`,
    windowsCmd: `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest ${windowsInstallerUrl} -OutFile agentroom-install.ps1; powershell -ExecutionPolicy Bypass -File .\\agentroom-install.ps1"`,
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
