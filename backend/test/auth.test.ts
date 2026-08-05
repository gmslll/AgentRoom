import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

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

async function register(
  app: Awaited<ReturnType<typeof buildApp>>,
  email = "grace@example.com",
  displayName = "Grace",
) {
  return app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, displayName, password: "correct horse battery staple" },
  });
}

describe("account authentication", () => {
  it("registers, logs in without account enumeration, and revokes logout", async () => {
    const app = await makeApp();
    const registeredResponse = await register(app, "Grace@Example.COM");

    expect(registeredResponse.statusCode).toBe(201);
    const registered = registeredResponse.json();
    expect(registered.user).toMatchObject({
      email: "grace@example.com",
      displayName: "Grace",
    });
    expect(registered.user).not.toHaveProperty("passwordHash");
    expect(registered.accessToken).toMatch(/^ars_/);
    expect(new Date(registered.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const duplicate = await register(app, "GRACE@example.com");
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("EMAIL_ALREADY_REGISTERED");

    for (const payload of [
      { email: "missing@example.com", password: "wrong password" },
      { email: "grace@example.com", password: "wrong password" },
    ]) {
      const invalid = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload,
      });
      expect(invalid.statusCode).toBe(401);
      expect(invalid.json().error.code).toBe("INVALID_CREDENTIALS");
      expect(invalid.json().error.message).toBe(
        "The email or password is invalid",
      );
    }

    const loginResponse = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "GRACE@example.com",
        password: "correct horse battery staple",
      },
    });
    expect(loginResponse.statusCode).toBe(200);
    const login = loginResponse.json();
    expect(login.accessToken).not.toBe(registered.accessToken);

    const me = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.id).toBe(registered.user.id);

    const logout = await app.inject({
      method: "POST",
      url: "/v1/auth/logout",
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    expect(logout.statusCode).toBe(204);

    const afterLogout = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    expect(afterLogout.statusCode).toBe(401);
    expect(afterLogout.json().error.code).toBe("INVALID_SESSION");
  });

  it("restores account-linked room access after a new login", async () => {
    const app = await makeApp();
    const registered = (await register(app)).json();
    const createdResponse = await app.inject({
      method: "POST",
      url: "/v1/rooms",
      headers: { authorization: `Bearer ${registered.accessToken}` },
      payload: { name: "Persistent identity" },
    });

    expect(createdResponse.statusCode).toBe(201);
    const created = createdResponse.json();
    expect(created.member.displayName).toBe("Grace");

    const stranger = (await register(app, "stranger@example.com", "Stranger")).json();
    const forbidden = await app.inject({
      method: "GET",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${stranger.accessToken}` },
    });
    expect(forbidden.statusCode).toBe(401);
    expect(forbidden.json().error.code).toBe("INVALID_TOKEN");

    const login = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "grace@example.com",
          password: "correct horse battery staple",
        },
      })
    ).json();
    const rooms = await app.inject({
      method: "GET",
      url: "/v1/rooms",
      headers: { authorization: `Bearer ${login.accessToken}` },
    });
    expect(rooms.statusCode).toBe(200);
    expect(rooms.json().items).toEqual([
      {
        room: created.room,
        member: created.member,
      },
    ]);

    const message = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${login.accessToken}` },
      payload: { kind: "text", text: "I am back" },
    });
    expect(message.statusCode).toBe(201);
    expect(message.json().message.author.memberId).toBe(created.member.id);
  });

  it("links an authenticated human invite join to the account", async () => {
    const app = await makeApp();
    const owner = (await register(app, "owner@example.com", "Owner")).json();
    const guest = (await register(app, "guest@example.com", "Guest")).json();
    const created = (
      await app.inject({
        method: "POST",
        url: "/v1/rooms",
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: { name: "Shared room" },
      })
    ).json();

    const joined = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/members`,
      headers: { authorization: `Bearer ${guest.accessToken}` },
      payload: {
        inviteCode: created.inviteCode,
        displayName: "Guest in room",
        actorType: "human",
      },
    });
    expect(joined.statusCode).toBe(201);

    const rooms = await app.inject({
      method: "GET",
      url: "/v1/rooms",
      headers: { authorization: `Bearer ${guest.accessToken}` },
    });
    expect(rooms.json().items).toEqual([
      expect.objectContaining({
        room: created.room,
        member: expect.objectContaining({ displayName: "Guest in room" }),
      }),
    ]);

    const duplicate = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/members`,
      headers: { authorization: `Bearer ${guest.accessToken}` },
      payload: {
        inviteCode: created.inviteCode,
        displayName: "Guest twice",
        actorType: "human",
      },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("ACCOUNT_ALREADY_MEMBER");
  });
});
