import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = databaseUrl ? describe : describe.skip;
const maintenancePool = databaseUrl
  ? new Pool({ connectionString: databaseUrl })
  : undefined;

beforeEach(async () => {
  if (maintenancePool) {
    await maintenancePool.query(
      `TRUNCATE agent_deliveries, room_messages, room_members, rooms,
                user_sessions, users CASCADE`,
    );
  }
});

afterAll(async () => {
  await maintenancePool?.end();
});

describeWithPostgres("PostgresRoomRepository", () => {
  it("persists accounts, sessions, and account-linked rooms", async () => {
    const first = await buildApp({ databaseUrl: databaseUrl! });
    await first.ready();
    const registered = (
      await first.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "persistent@example.com",
          displayName: "Persistent user",
          password: "correct horse battery staple",
        },
      })
    ).json();
    const created = (
      await first.inject({
        method: "POST",
        url: "/v1/rooms",
        headers: { authorization: `Bearer ${registered.accessToken}` },
        payload: { name: "Account room" },
      })
    ).json();
    await first.close();

    const second = await buildApp({ databaseUrl: databaseUrl! });
    await second.ready();
    const login = await second.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: {
        email: "PERSISTENT@example.com",
        password: "correct horse battery staple",
      },
    });
    expect(login.statusCode).toBe(200);
    const rooms = await second.inject({
      method: "GET",
      url: "/v1/rooms",
      headers: { authorization: `Bearer ${login.json().accessToken}` },
    });
    expect(rooms.statusCode).toBe(200);
    expect(rooms.json().items).toEqual([
      { room: created.room, member: created.member },
    ]);
    await second.close();
  });

  it("creates only one account under concurrent registration", async () => {
    const app = await buildApp({ databaseUrl: databaseUrl! });
    await app.ready();
    const request = () =>
      app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "race@example.com",
          displayName: "Race",
          password: "correct horse battery staple",
        },
      });
    const responses = await Promise.all(Array.from({ length: 4 }, request));
    expect(responses.filter((response) => response.statusCode === 201)).toHaveLength(
      1,
    );
    expect(responses.filter((response) => response.statusCode === 409)).toHaveLength(
      3,
    );
    await app.close();
  });

  it("persists room access and history across app restarts", async () => {
    const first = await buildApp({ databaseUrl: databaseUrl! });
    await first.ready();
    const created = (
      await first.inject({
        method: "POST",
        url: "/v1/rooms",
        payload: { displayName: "Owner" },
      })
    ).json();
    await first.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${created.accessToken}` },
      payload: { kind: "text", text: "Persistent message" },
    });
    await first.close();

    const second = await buildApp({ databaseUrl: databaseUrl! });
    await second.ready();
    const history = await second.inject({
      method: "GET",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${created.accessToken}` },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().items).toEqual([
      expect.objectContaining({ text: "Persistent message", sequence: 1 }),
    ]);
    await second.close();
  });

  it("keeps task idempotency and replies atomic under database concurrency", async () => {
    const app = await buildApp({ databaseUrl: databaseUrl! });
    await app.ready();
    const created = (
      await app.inject({
        method: "POST",
        url: "/v1/rooms",
        payload: { displayName: "Owner" },
      })
    ).json();
    const agent = (
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
    const request = () =>
      app.inject({
        method: "POST",
        url: `/v1/rooms/${created.room.id}/messages`,
        headers: { authorization: `Bearer ${created.accessToken}` },
        payload: {
          kind: "agent.task",
          text: "Run exactly once",
          targetMemberIds: [agent.member.id],
          idempotencyKey: "postgres-concurrent-0001",
        },
      });

    const taskResponses = await Promise.all(
      Array.from({ length: 20 }, request),
    );
    expect(taskResponses.filter((response) => response.statusCode === 201)).toHaveLength(
      1,
    );
    expect(taskResponses.filter((response) => response.statusCode === 200)).toHaveLength(
      19,
    );
    const task = taskResponses[0]!.json();
    const deliveryId = task.deliveries[0].id;
    await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/deliveries/${deliveryId}/status`,
      headers: { authorization: `Bearer ${agent.accessToken}` },
      payload: { status: "running" },
    });
    const replies = await Promise.all([
      app.inject({
        method: "POST",
        url: `/v1/rooms/${created.room.id}/deliveries/${deliveryId}/reply`,
        headers: { authorization: `Bearer ${agent.accessToken}` },
        payload: { text: "Reply A" },
      }),
      app.inject({
        method: "POST",
        url: `/v1/rooms/${created.room.id}/deliveries/${deliveryId}/reply`,
        headers: { authorization: `Bearer ${agent.accessToken}` },
        payload: { text: "Reply B" },
      }),
    ]);
    expect(replies.map((response) => response.statusCode).sort()).toEqual([
      201,
      409,
    ]);

    const history = await app.inject({
      method: "GET",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${created.accessToken}` },
    });
    expect(
      history.json().items.filter((message: { kind: string }) =>
        message.kind === "agent.reply",
      ),
    ).toHaveLength(1);
    await app.close();
  });
});
