import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/api/app.js";
import { InMemoryRoomRepository } from "../../src/modules/rooms/memory-repository.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp() {
  const app = await buildApp();
  apps.push(app);
  await app.ready();
  return app;
}

describe("health", () => {
  it("reports service health", async () => {
    const app = await makeApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "agentroom-backend",
    });
  });

  it("reports unavailable when its repository is not ready", async () => {
    class UnhealthyRepository extends InMemoryRoomRepository {
      async healthCheck(): Promise<void> {
        throw new Error("database unavailable");
      }
    }
    const app = await buildApp({ repository: new UnhealthyRepository() });
    apps.push(app);
    await app.ready();

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "unavailable" });
  });
});

describe("API documentation", () => {
  it("serves the shared OpenAPI contract and Swagger UI", async () => {
    const app = await buildApp({
      publicBaseUrl: "https://try-status.online/api",
    });
    apps.push(app);
    await app.ready();

    const yaml = await app.inject({ method: "GET", url: "/openapi.yaml" });
    expect(yaml.statusCode).toBe(200);
    expect(yaml.headers["content-type"]).toContain("application/yaml");
    expect(yaml.body).toContain("openapi: 3.1.0");
    expect(yaml.body).toContain("https://try-status.online/api");

    const json = await app.inject({ method: "GET", url: "/docs/json" });
    expect(json.statusCode).toBe(200);
    expect(json.json()).toMatchObject({
      openapi: "3.1.0",
      info: { title: "AgentRoom HTTP API" },
    });

    const ui = await app.inject({ method: "GET", url: "/docs" });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers["content-type"]).toContain("text/html");
    expect(ui.body).toContain("/api/docs/static/swagger-ui.css");
  });
});

describe("room messaging", () => {
  it("rejects whitespace-only names and messages", async () => {
    const app = await makeApp();
    const invalidRoom = await app.inject({
      method: "POST",
      url: "/v1/rooms",
      payload: { displayName: "   " },
    });
    expect(invalidRoom.statusCode).toBe(400);

    const created = (
      await app.inject({
        method: "POST",
        url: "/v1/rooms",
        payload: { displayName: "Owner" },
      })
    ).json();
    const invalidMessage = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${created.accessToken}` },
      payload: { kind: "text", text: " \n\t " },
    });
    expect(invalidMessage.statusCode).toBe(400);
  });

  it("creates a room, joins an agent, and exchanges ordered messages", async () => {
    const app = await makeApp();
    const createdResponse = await app.inject({
      method: "POST",
      url: "/v1/rooms",
      payload: { name: "Build room", displayName: "Grace" },
    });

    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json();
    expect(created.room.name).toBe("Build room");
    expect(created.room.visibility).toBe("private");
    expect(created.member.actorType).toBe("human");
    expect(created.accessToken).toMatch(/^art_/);
    expect(created.inviteCode).toMatch(/^ari_/);
    expect(created.connectorCommand).toContain("agentroom join");
    expect(created.connectorCommand).toContain(
      '--base-url "http://127.0.0.1:8787"',
    );
    expect(created.connectorCommand).not.toContain(created.inviteCode);
    expect(created.connector.attachCommand).not.toContain(created.inviteCode);
    expect(created.connector).toEqual({
      command: created.connectorCommand,
      attachCommand:
        `agentroom attach ${created.room.id}` +
        ' --base-url "http://127.0.0.1:8787"',
      distribution: "direct-download",
      installers: {
        manifestUrl:
          "http://127.0.0.1:8787/downloads/cli/manifest.json",
        macosLinuxUrl: "http://127.0.0.1:8787/downloads/cli/install.sh",
        windowsUrl: "http://127.0.0.1:8787/downloads/cli/install.ps1",
      },
      packageName: "@agentroom/bridge",
      nodeVersion: ">=22",
      supportedProviders: ["claude", "codex"],
    });

    const joinedResponse = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/members`,
      payload: {
        inviteCode: created.inviteCode,
        displayName: "Codex",
        actorType: "agent",
        agentProvider: "codex",
      },
    });

    expect(joinedResponse.statusCode).toBe(201);
    const joined = joinedResponse.json();
    expect(joined.member).toMatchObject({
      actorType: "agent",
      agentProvider: "codex",
    });

    const membersResponse = await app.inject({
      method: "GET",
      url: `/v1/rooms/${created.room.id}/members`,
      headers: { authorization: `Bearer ${created.accessToken}` },
    });
    expect(membersResponse.statusCode).toBe(200);
    expect(membersResponse.json().items).toEqual([
      expect.objectContaining({ id: created.member.id, role: "owner" }),
      expect.objectContaining({ id: joined.member.id, agentProvider: "codex" }),
    ]);

    const firstMessage = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${created.accessToken}` },
      payload: { kind: "text", text: "Ship the protocol first" },
    });
    const secondMessage = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${joined.accessToken}` },
      payload: { kind: "text", text: "Acknowledged" },
    });

    expect(firstMessage.statusCode).toBe(201);
    expect(secondMessage.statusCode).toBe(201);
    expect(firstMessage.json().message.sequence).toBe(1);
    expect(secondMessage.json().message.sequence).toBe(2);

    const history = await app.inject({
      method: "GET",
      url: `/v1/rooms/${created.room.id}/messages?afterSequence=1`,
      headers: { authorization: `Bearer ${created.accessToken}` },
    });

    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      nextAfterSequence: 2,
      items: [{ sequence: 2, text: "Acknowledged" }],
    });
  });

  it("does not treat a room ID as authorization", async () => {
    const app = await makeApp();
    const created = (
      await app.inject({
        method: "POST",
        url: "/v1/rooms",
        payload: { displayName: "Grace" },
      })
    ).json();

    const history = await app.inject({
      method: "GET",
      url: `/v1/rooms/${created.room.id}/messages`,
    });

    expect(history.statusCode).toBe(401);
    expect(history.json().error.code).toBe("AUTH_REQUIRED");
  });

  it("lets only the owner rotate and invalidate the room invite", async () => {
    const app = await makeApp();
    const created = (
      await app.inject({
        method: "POST",
        url: "/v1/rooms",
        payload: { displayName: "Owner" },
      })
    ).json();
    const guest = (
      await app.inject({
        method: "POST",
        url: `/v1/rooms/${created.room.id}/members`,
        payload: {
          inviteCode: created.inviteCode,
          displayName: "Guest",
          actorType: "human",
        },
      })
    ).json();
    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/invite-code/rotate`,
      headers: { authorization: `Bearer ${guest.accessToken}` },
    });
    expect(forbidden.statusCode).toBe(403);

    const hiddenConnector = await app.inject({
      method: "GET",
      url: `/v1/rooms/${created.room.id}/connector`,
      headers: { authorization: `Bearer ${guest.accessToken}` },
    });
    expect(hiddenConnector.statusCode).toBe(403);

    const connector = await app.inject({
      method: "GET",
      url: `/v1/rooms/${created.room.id}/connector`,
      headers: { authorization: `Bearer ${created.accessToken}` },
    });
    expect(connector.statusCode).toBe(200);
    expect(connector.json().connectorCommand).toBe(
      connector.json().connector.command,
    );
    expect(connector.json().connector.attachCommand).toContain(
      `agentroom attach ${created.room.id}`,
    );

    const rotated = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/invite-code/rotate`,
      headers: { authorization: `Bearer ${created.accessToken}` },
    });
    expect(rotated.statusCode).toBe(200);
    const nextInvite = rotated.json().inviteCode;
    expect(nextInvite).not.toBe(created.inviteCode);
    expect(rotated.json().connectorCommand).toBe(
      rotated.json().connector.command,
    );
    expect(rotated.json().connectorCommand).not.toContain(nextInvite);
    expect(rotated.json().connector.attachCommand).not.toContain(nextInvite);

    const oldInvite = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/members`,
      payload: {
        inviteCode: created.inviteCode,
        displayName: "Old invite",
        actorType: "human",
      },
    });
    expect(oldInvite.statusCode).toBe(403);
    const newInvite = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/members`,
      payload: {
        inviteCode: nextInvite,
        displayName: "New invite",
        actorType: "human",
      },
    });
    expect(newInvite.statusCode).toBe(201);
  });

  it("puts the deployment public URL in copyable CLI commands", async () => {
    const app = await buildApp({
      publicBaseUrl: "https://api.example.com/agentroom/",
    });
    apps.push(app);
    await app.ready();

    const created = (
      await app.inject({
        method: "POST",
        url: "/v1/rooms",
        payload: { displayName: "Owner" },
      })
    ).json();
    expect(created.connectorCommand).toContain(
      '--base-url "https://api.example.com/agentroom"',
    );
    expect(created.connector.attachCommand).toContain(
      '--base-url "https://api.example.com/agentroom"',
    );
    expect(created.connector.installers).toEqual({
      manifestUrl:
        "https://api.example.com/agentroom/downloads/cli/manifest.json",
      macosLinuxUrl:
        "https://api.example.com/agentroom/downloads/cli/install.sh",
      windowsUrl:
        "https://api.example.com/agentroom/downloads/cli/install.ps1",
    });
  });
});

describe("realtime", () => {
  it("delivers newly created messages over a single-use ticket", async () => {
    const app = await makeApp();
    const created = (
      await app.inject({
        method: "POST",
        url: "/v1/rooms",
        payload: { displayName: "Grace" },
      })
    ).json();
    const ticket = (
      await app.inject({
        method: "POST",
        url: `/v1/rooms/${created.room.id}/realtime-tickets`,
        headers: { authorization: `Bearer ${created.accessToken}` },
      })
    ).json();

    const socket = await app.injectWS(
      `/v1/realtime?ticket=${encodeURIComponent(ticket.ticket)}`,
    );
    const received: Array<Record<string, unknown>> = [];
    socket.on("message", (data) => {
      received.push(JSON.parse(data.toString()));
    });

    await expect
      .poll(async () => {
        const response = await app.inject({
          method: "GET",
          url: `/v1/rooms/${created.room.id}/presence`,
          headers: { authorization: `Bearer ${created.accessToken}` },
        });
        return response.json().items[0]?.online;
      })
      .toBe(true);

    const joined = (
      await app.inject({
        method: "POST",
        url: `/v1/rooms/${created.room.id}/members`,
        payload: {
          inviteCode: created.inviteCode,
          displayName: "Claude",
          actorType: "agent",
          agentProvider: "claude",
        },
      })
    ).json();

    await expect
      .poll(() => received.find((event) => event.type === "member.joined"))
      .toMatchObject({ data: { member: { id: joined.member.id } } });

    await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${created.accessToken}` },
      payload: { kind: "text", text: "Realtime hello" },
    });

    await expect
      .poll(() => received.some((event) => event.type === "message.created"))
      .toBe(true);
    expect(received).toContainEqual(
      expect.objectContaining({
        version: 1,
        type: "message.created",
        roomId: created.room.id,
      }),
    );
    socket.terminate();
    await expect
      .poll(async () => {
        const response = await app.inject({
          method: "GET",
          url: `/v1/rooms/${created.room.id}/presence`,
          headers: { authorization: `Bearer ${created.accessToken}` },
        });
        return response.json().items[0]?.online;
      })
      .toBe(false);
  });
});

describe("agent task delivery", () => {
  it("targets one agent, deduplicates the task, and tracks its reply", async () => {
    const app = await makeApp();
    const ownerAccount = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "task-owner@example.com",
          displayName: "Owner",
          password: "correct horse battery staple",
        },
      })
    ).json();
    const created = (
      await app.inject({
        method: "POST",
        url: "/v1/rooms",
        headers: { authorization: `Bearer ${ownerAccount.accessToken}` },
        payload: { name: "Agent room" },
      })
    ).json();
    const claude = (
      await app.inject({
        method: "POST",
        url: `/v1/rooms/${created.room.id}/members`,
        payload: {
          inviteCode: created.inviteCode,
          displayName: "Claude",
          actorType: "agent",
          agentProvider: "claude",
        },
      })
    ).json();
    const codex = (
      await app.inject({
        method: "POST",
        url: `/v1/rooms/${created.room.id}/members`,
        payload: {
          inviteCode: created.inviteCode,
          displayName: "Codex",
          actorType: "agent",
          agentProvider: "codex",
        },
      })
    ).json();
    const taskPayload = {
      kind: "agent.task",
      text: "Inspect the failing test",
      targetMemberIds: [claude.member.id],
      idempotencyKey: "request-0001",
    };
    const claim = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/agents/${claude.member.id}/claim`,
      headers: { authorization: `Bearer ${ownerAccount.accessToken}` },
      payload: { claimCode: claude.agentClaim.code },
    });
    expect(claim.statusCode).toBe(201);

    const taskResponse = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${created.accessToken}` },
      payload: taskPayload,
    });
    const duplicateResponse = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${created.accessToken}` },
      payload: taskPayload,
    });

    expect(taskResponse.statusCode).toBe(201);
    expect(duplicateResponse.statusCode).toBe(200);
    const task = taskResponse.json();
    expect(duplicateResponse.json().message.id).toBe(task.message.id);
    expect(duplicateResponse.json().deliveries[0].id).toBe(
      task.deliveries[0].id,
    );

    const claudePending = await app.inject({
      method: "GET",
      url: `/v1/rooms/${created.room.id}/deliveries/pending`,
      headers: { authorization: `Bearer ${claude.accessToken}` },
    });
    const codexPending = await app.inject({
      method: "GET",
      url: `/v1/rooms/${created.room.id}/deliveries/pending`,
      headers: { authorization: `Bearer ${codex.accessToken}` },
    });

    expect(claudePending.json().items).toHaveLength(1);
    expect(codexPending.json().items).toHaveLength(0);

    for (const status of ["received", "running"] as const) {
      const response = await app.inject({
        method: "POST",
        url: `/v1/rooms/${created.room.id}/deliveries/${task.deliveries[0].id}/status`,
        headers: { authorization: `Bearer ${claude.accessToken}` },
        payload: { status },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().delivery.status).toBe(status);
    }

    const reply = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/deliveries/${task.deliveries[0].id}/reply`,
      headers: { authorization: `Bearer ${claude.accessToken}` },
      payload: { text: "The failure is fixed" },
    });

    expect(reply.statusCode).toBe(201);
    expect(reply.json()).toMatchObject({
      delivery: { status: "replied" },
      message: {
        kind: "agent.reply",
        inReplyToMessageId: task.message.id,
        text: "The failure is fixed",
      },
    });
    const noLongerPending = await app.inject({
      method: "GET",
      url: `/v1/rooms/${created.room.id}/deliveries/pending`,
      headers: { authorization: `Bearer ${claude.accessToken}` },
    });
    expect(noLongerPending.json().items).toHaveLength(0);
  });

  it("lets only an owner-authorized room user trigger an agent", async () => {
    const app = await makeApp();
    const ownerAccount = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "grant-owner@example.com",
          displayName: "Owner",
          password: "correct horse battery staple",
        },
      })
    ).json();
    const guestAccount = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "grantee@example.com",
          displayName: "Guest",
          password: "correct horse battery staple",
        },
      })
    ).json();
    const created = (
      await app.inject({
        method: "POST",
        url: "/v1/rooms",
        headers: { authorization: `Bearer ${ownerAccount.accessToken}` },
        payload: {},
      })
    ).json();
    const member = (
      await app.inject({
        method: "POST",
        url: `/v1/rooms/${created.room.id}/members`,
        headers: { authorization: `Bearer ${guestAccount.accessToken}` },
        payload: {
          inviteCode: created.inviteCode,
          displayName: "Guest",
          actorType: "human",
        },
      })
    ).json();
    const claude = (
      await app.inject({
        method: "POST",
        url: `/v1/rooms/${created.room.id}/members`,
        payload: {
          inviteCode: created.inviteCode,
          displayName: "Claude",
          actorType: "agent",
          agentProvider: "claude",
        },
      })
    ).json();

    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${member.accessToken}` },
      payload: {
        kind: "agent.task",
        text: "Run this",
        targetMemberIds: [claude.member.id],
        idempotencyKey: "request-before-grant-0002",
      },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("AGENT_ACCESS_REQUIRED");

    const claim = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/agents/${claude.member.id}/claim`,
      headers: { authorization: `Bearer ${ownerAccount.accessToken}` },
      payload: { claimCode: claude.agentClaim.code },
    });
    expect(claim.statusCode).toBe(201);
    const grant = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/agents/${claude.member.id}/grants`,
      headers: { authorization: `Bearer ${ownerAccount.accessToken}` },
      payload: { granteeMemberId: member.member.id },
    });
    expect(grant.statusCode).toBe(201);

    const response = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${member.accessToken}` },
      payload: {
        kind: "agent.task",
        text: "Run this",
        targetMemberIds: [claude.member.id],
        idempotencyKey: "request-0002",
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().message.kind).toBe("agent.task");
    expect(response.json().deliveries).toHaveLength(1);
  });
});
