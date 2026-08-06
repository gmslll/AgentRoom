import { describe, expect, it } from "vitest";
import { createInstallerCommands } from "./installer-commands";

describe("ConnectPanel installer commands", () => {
  it("builds copyable commands from backend-provided installer URLs", () => {
    expect(
      createInstallerCommands({
        manifestUrl: "https://try-status.online/api/downloads/cli/manifest.json",
        macosLinuxUrl:
          "https://try-status.online/api/downloads/cli/install.sh",
        windowsUrl:
          "https://try-status.online/api/downloads/cli/install.ps1",
      }),
    ).toEqual({
      macosLinux:
        "curl -fsSL 'https://try-status.online/api/downloads/cli/install.sh' | sh",
      windows:
        "irm 'https://try-status.online/api/downloads/cli/install.ps1' | iex",
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
        "curl -fsSL 'http://localhost:3000/api/downloads/cli/install.sh' | sh",
      windows:
        "irm 'http://localhost:3000/api/downloads/cli/install.ps1' | iex",
    });
  });
});
