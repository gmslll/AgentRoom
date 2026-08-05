import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/api/app.js";

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function makeApp() {
  const app = await buildApp({
    moderationEnabled: true,
    mcpEnabled: true,
  });
  apps.push(app);
  await app.ready();
  return app;
}

async function registerOwner(app: Awaited<ReturnType<typeof buildApp>>) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: {
      email: "owner@example.com",
      displayName: "Owner",
      password: "correct horse battery staple",
    },
  });
  return response.json();
}

async function createRoom(
  app: Awaited<ReturnType<typeof buildApp>>,
  accessToken: string,
) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/rooms",
    headers: { authorization: `Bearer ${accessToken}` },
    payload: { name: "Extended room" },
  });
  return response.json();
}

async function joinAgent(
  app: Awaited<ReturnType<typeof buildApp>>,
  roomId: string,
  inviteCode: string,
  name: string,
) {
  const response = await app.inject({
    method: "POST",
    url: `/v1/rooms/${roomId}/members`,
    payload: {
      inviteCode,
      displayName: name,
      actorType: "agent",
      agentProvider: "claude",
    },
  });
  return response.json();
}

describe("room management extensions", () => {
  it("lets the owner remove a member and revokes their token", async () => {
    const app = await makeApp();
    const owner = await registerOwner(app);
    const room = await createRoom(app, owner.accessToken);
    const agent = await joinAgent(app, room.room.id, room.inviteCode, "Claude A");

    const removed = await app.inject({
      method: "DELETE",
      url: `/v1/rooms/${room.room.id}/members/${agent.member.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(removed.statusCode).toBe(204);

    const afterRemoval = await app.inject({
      method: "GET",
      url: `/v1/rooms/${room.room.id}/messages`,
      headers: { authorization: `Bearer ${agent.accessToken}` },
    });
    expect(afterRemoval.statusCode).toBe(401);
    expect(afterRemoval.json().error.code).toBe("INVALID_TOKEN");

    const members = await app.inject({
      method: "GET",
      url: `/v1/rooms/${room.room.id}/members`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(members.json().items.map((item: { id: string }) => item.id)).toEqual([
      owner.member ? owner.member.id : room.member.id,
    ]);
  });

  it("forbids removing the owner", async () => {
    const app = await makeApp();
    const owner = await registerOwner(app);
    const room = await createRoom(app, owner.accessToken);
    const response = await app.inject({
      method: "DELETE",
      url: `/v1/rooms/${room.room.id}/members/${room.member.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("CANNOT_REMOVE_OWNER");
  });

  it("enforces owner-only moderation rule management", async () => {
    const app = await makeApp();
    const owner = await registerOwner(app);
    const room = await createRoom(app, owner.accessToken);
    const agent = await joinAgent(app, room.room.id, room.inviteCode, "Claude A");

    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/moderation/rules`,
      headers: { authorization: `Bearer ${agent.accessToken}` },
      payload: { pattern: "spam", action: "reject" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe("OWNER_REQUIRED");

    const created = await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/moderation/rules`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { pattern: "urgent", action: "flag" },
    });
    expect(created.statusCode).toBe(201);
    const rule = created.json();
    expect(rule.pattern).toBe("urgent");

    const listed = await app.inject({
      method: "GET",
      url: `/v1/rooms/${room.room.id}/moderation/rules`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(listed.json().items).toHaveLength(1);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/v1/rooms/${room.room.id}/moderation/rules/${rule.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("flags and rejects messages according to moderation rules", async () => {
    const app = await makeApp();
    const owner = await registerOwner(app);
    const room = await createRoom(app, owner.accessToken);

    await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/moderation/rules`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { pattern: "urgent", action: "flag" },
    });
    await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/moderation/rules`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { pattern: "blocked word", action: "reject" },
    });

    const flagged = await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/messages`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { kind: "text", text: "This is URGENT" },
    });
    expect(flagged.statusCode).toBe(201);
    expect(flagged.json().message.moderation).toEqual({
      state: "flagged",
      reason: "urgent",
    });

    const rejected = await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/messages`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { kind: "text", text: "contains blocked word inside" },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json().error.code).toBe("MODERATION_REJECTED");
  });

  it("relays an agent reply into a new task for other agents", async () => {
    const app = await makeApp();
    const owner = await registerOwner(app);
    const room = await createRoom(app, owner.accessToken);
    const agentA = await joinAgent(app, room.room.id, room.inviteCode, "Claude A");
    const agentB = await joinAgent(app, room.room.id, room.inviteCode, "Codex B");

    const task = await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/messages`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: {
        kind: "agent.task",
        text: "Design the schema",
        targetMemberIds: [agentA.member.id],
        idempotencyKey: "task_0000000000000001",
      },
    });
    expect(task.statusCode).toBe(201);
    const taskMessage = task.json().message;
    const deliveryId = task.json().deliveries[0].id;

    const reply = await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/deliveries/${deliveryId}/reply`,
      headers: { authorization: `Bearer ${agentA.accessToken}` },
      payload: {
        text: "Schema designed; handing off to Codex",
        relay: {
          targetMemberIds: [agentB.member.id],
          idempotencyKey: "relay_0000000000000001",
        },
      },
    });
    expect(reply.statusCode).toBe(201);
    const body = reply.json();
    expect(body.delivery.status).toBe("replied");
    expect(body.relay).toBeDefined();
    expect(body.relay.message.kind).toBe("agent.task");
    expect(body.relay.message.author.memberId).toBe(agentA.member.id);
    expect(body.relay.deliveries).toHaveLength(1);

    const pending = await app.inject({
      method: "GET",
      url: `/v1/rooms/${room.room.id}/deliveries/pending`,
      headers: { authorization: `Bearer ${agentB.accessToken}` },
    });
    expect(pending.json().items).toHaveLength(1);
    expect(pending.json().items[0].task.text).toBe("Schema designed; handing off to Codex");
  });

  it("exposes presence and reports members as offline without sockets", async () => {
    const app = await makeApp();
    const owner = await registerOwner(app);
    const room = await createRoom(app, owner.accessToken);
    const response = await app.inject({
      method: "GET",
      url: `/v1/rooms/${room.room.id}/presence`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([
      { memberId: room.member.id, online: false, lastSeenAt: null },
    ]);
  });
});

describe("account extensions", () => {
  it("requests email verification and password resets", async () => {
    const app = await makeApp();
    const owner = await registerOwner(app);

    const verification = await app.inject({
      method: "POST",
      url: "/v1/auth/email/verification",
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(verification.statusCode).toBe(202);

    // Repeated requests issue fresh codes until the email is verified.
    const repeated = await app.inject({
      method: "POST",
      url: "/v1/auth/email/verification",
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(repeated.statusCode).toBe(202);

    const resetRequest = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset-request",
      payload: { email: "owner@example.com" },
    });
    expect(resetRequest.statusCode).toBe(202);

    const unknownReset = await app.inject({
      method: "POST",
      url: "/v1/auth/password/reset-request",
      payload: { email: "nobody@example.com" },
    });
    expect(unknownReset.statusCode).toBe(202);
  });

  it("changes the password and keeps the current session valid", async () => {
    const app = await makeApp();
    const owner = await registerOwner(app);

    const changed = await app.inject({
      method: "POST",
      url: "/v1/auth/password/change",
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: {
        currentPassword: "correct horse battery staple",
        newPassword: "a brand new passphrase",
      },
    });
    expect(changed.statusCode).toBe(204);

    const oldLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "owner@example.com",
        password: "correct horse battery staple",
      },
    });
    expect(oldLogin.statusCode).toBe(401);

    const newLogin = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "owner@example.com", password: "a brand new passphrase" },
    });
    expect(newLogin.statusCode).toBe(200);
  });

  it("rejects OAuth when providers are not configured", async () => {
    const app = await makeApp();
    const response = await app.inject({
      method: "GET",
      url: "/v1/auth/oauth/google/authorize",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("OAUTH_NOT_CONFIGURED");
  });
});
