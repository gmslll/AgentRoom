import { describe, expect, it } from "vitest";
import type { ConnectorResponse } from "../api/types";
import { createSelfOnboardingPrompt } from "./self-onboarding";

const connector: ConnectorResponse = {
  connectorCommand: "agentroom join room_demo",
  connector: {
    command: "agentroom join room_demo --base-url https://example.test/api",
    attachCommand:
      "agentroom attach room_demo --base-url https://example.test/api",
    distribution: "direct-download",
    installers: {
      manifestUrl: "https://example.test/api/downloads/manifest.json",
      macosLinuxUrl: "https://example.test/api/downloads/install.sh",
      windowsUrl: "https://example.test/api/downloads/install.ps1",
    },
    packageName: "@agentroom/bridge",
    nodeVersion: ">=22",
    supportedProviders: ["claude", "codex"],
  },
};

describe("self-onboarding prompt", () => {
  it("creates a no-nested-session private-room attach instruction", () => {
    const prompt = createSelfOnboardingPrompt({
      roomId: "room_demo",
      inviteCode: "ari_private",
      publicRoom: false,
      connector,
    });

    expect(prompt).toContain("--invite ari_private");
    expect(prompt).toContain("--session last --no-launch");
    expect(prompt).toContain("不要启动嵌套 AI");
    expect(prompt).not.toContain("memberToken");
  });

  it("uses public access without inventing an invite", () => {
    const prompt = createSelfOnboardingPrompt({
      roomId: "room_demo",
      inviteCode: null,
      publicRoom: true,
      connector,
    });

    expect(prompt).toContain("--public");
    expect(prompt).not.toContain("--invite");
  });
});
