import { describe, expect, it } from "vitest";
import { parseStoredConfig } from "../../src/connectors/bridge-config.js";

describe("parseStoredConfig", () => {
  it("parses a regular config with a stored token", () => {
    const config = parseStoredConfig({
      version: 1,
      baseUrl: "http://127.0.0.1:8787",
      roomId: "room_1234567890",
      accessToken: "art_secret",
      provider: "claude",
      workspace: "/work/project",
    });
    expect(config.accessToken).toBe("art_secret");
    expect(config.credentialStore).toBeUndefined();
  });

  it("accepts an empty token when the credential store is keychain", () => {
    const config = parseStoredConfig({
      version: 1,
      baseUrl: "http://127.0.0.1:8787",
      roomId: "room_1234567890",
      accessToken: "",
      provider: "codex",
      workspace: "/work/project",
      memberId: "mem_abcdefghij",
      credentialStore: "keychain",
    });
    expect(config.credentialStore).toBe("keychain");
    expect(config.memberId).toBe("mem_abcdefghij");
    expect(config.accessToken).toBe("");
  });

  it("rejects a missing token without the keychain store", () => {
    expect(() =>
      parseStoredConfig({
        version: 1,
        baseUrl: "http://127.0.0.1:8787",
        roomId: "room_1234567890",
        accessToken: "",
        provider: "claude",
        workspace: "/work/project",
      }),
    ).toThrow(/missing accessToken/);
  });

  it("rejects keychain configs without memberId", () => {
    expect(() =>
      parseStoredConfig({
        version: 1,
        baseUrl: "http://127.0.0.1:8787",
        roomId: "room_1234567890",
        accessToken: "",
        provider: "claude",
        workspace: "/work/project",
        credentialStore: "keychain",
      }),
    ).toThrow(/must include memberId/);
  });

  it("accepts only local Codex App Server endpoints", () => {
    const local = parseStoredConfig({
      version: 1,
      baseUrl: "http://127.0.0.1:8787",
      roomId: "room_1234567890",
      accessToken: "art_secret",
      provider: "codex",
      workspace: "/work/project",
      codexAppServerEndpoint: "ws://127.0.0.1:45123",
    });
    expect(local.codexAppServerEndpoint).toBe("ws://127.0.0.1:45123");

    expect(() =>
      parseStoredConfig({
        version: 1,
        baseUrl: "http://127.0.0.1:8787",
        roomId: "room_1234567890",
        accessToken: "art_secret",
        provider: "codex",
        workspace: "/work/project",
        codexAppServerEndpoint: "ws://0.0.0.0:45123",
      }),
    ).toThrow(/must be a local/);
  });
});
