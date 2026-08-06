import { describe, expect, it } from "vitest";
import { createInstallerCommands } from "./installer-commands";

describe("ConnectPanel installer commands", () => {
  it("builds copyable commands from backend-provided installer URLs", () => {
    expect(
      createInstallerCommands({
        manifestUrl:
          "https://try-status.online/api/downloads/cli/manifest.json",
        macosLinuxUrl: "https://try-status.online/api/downloads/cli/install.sh",
        windowsUrl: "https://try-status.online/api/downloads/cli/install.ps1",
      }),
    ).toEqual({
      macosLinux:
        "curl -fL -o agentroom-install.sh 'https://try-status.online/api/downloads/cli/install.sh' && sh agentroom-install.sh",
      windowsPowerShell:
        "Invoke-WebRequest 'https://try-status.online/api/downloads/cli/install.ps1' -OutFile agentroom-install.ps1; powershell -ExecutionPolicy Bypass -File .\\agentroom-install.ps1",
      windowsCmd:
        "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-WebRequest 'https://try-status.online/api/downloads/cli/install.ps1' -OutFile agentroom-install.ps1; powershell -ExecutionPolicy Bypass -File .\\agentroom-install.ps1\"",
    });
  });

  it("resolves relative installer URLs against the web origin", () => {
    expect(
      createInstallerCommands({
        manifestUrl: "/api/downloads/cli/manifest.json",
        macosLinuxUrl: "/api/downloads/cli/install.sh",
        windowsUrl: "/api/downloads/cli/install.ps1",
      }),
    ).toEqual({
      macosLinux:
        "curl -fL -o agentroom-install.sh 'http://localhost:3000/api/downloads/cli/install.sh' && sh agentroom-install.sh",
      windowsPowerShell:
        "Invoke-WebRequest 'http://localhost:3000/api/downloads/cli/install.ps1' -OutFile agentroom-install.ps1; powershell -ExecutionPolicy Bypass -File .\\agentroom-install.ps1",
      windowsCmd:
        "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-WebRequest 'http://localhost:3000/api/downloads/cli/install.ps1' -OutFile agentroom-install.ps1; powershell -ExecutionPolicy Bypass -File .\\agentroom-install.ps1\"",
    });
  });
});
