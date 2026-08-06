import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../../src/api/app.js";

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

  it("persists public discovery and atomically revokes a dissolved room", async () => {
    const app = await buildApp({ databaseUrl: databaseUrl! });
    await app.ready();
    const owner = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "governance-owner@example.com",
          displayName: "Owner",
          password: "correct horse battery staple",
        },
      })
    ).json();
    const guest = (
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: {
          email: "governance-guest@example.com",
          displayName: "Guest",
          password: "correct horse battery staple",
        },
      })
    ).json();
    const created = (
      await app.inject({
        method: "POST",
        url: "/v1/rooms",
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: { name: "Public PostgreSQL room", visibility: "public" },
      })
    ).json();

    const publicRooms = await app.inject({
      method: "GET",
      url: "/v1/public-rooms",
    });
    expect(publicRooms.json().items).toEqual([created.room]);

    const joined = (
      await app.inject({
        method: "POST",
        url: `/v1/rooms/${created.room.id}/members`,
        headers: { authorization: `Bearer ${guest.accessToken}` },
        payload: { displayName: "Guest", actorType: "human" },
      })
    ).json();
    const dissolved = await app.inject({
      method: "DELETE",
      url: `/v1/rooms/${created.room.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(dissolved.statusCode).toBe(204);

    const ownerRooms = await app.inject({
      method: "GET",
      url: "/v1/rooms",
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    const guestRooms = await app.inject({
      method: "GET",
      url: "/v1/rooms",
      headers: { authorization: `Bearer ${guest.accessToken}` },
    });
    expect(ownerRooms.json().items).toEqual([]);
    expect(guestRooms.json().items).toEqual([]);

    const revoked = await app.inject({
      method: "GET",
      url: `/v1/rooms/${created.room.id}/messages`,
      headers: { authorization: `Bearer ${joined.accessToken}` },
    });
    expect(revoked.statusCode).toBe(404);
    await app.close();
  });

  it("keeps task idempotency and replies atomic under database concurrency", async () => {
    const app = await buildApp({ databaseUrl: databaseUrl! });
    await app.ready();
    const owner = (
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
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: {},
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
    const claim = await app.inject({
      method: "POST",
      url: `/v1/rooms/${created.room.id}/agents/${agent.member.id}/claim`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { claimCode: agent.agentClaim.code },
    });
    expect(claim.statusCode).toBe(201);
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

  it("persists Agent ownership, delegated user access, and bilateral collaboration", async () => {
    const app = await buildApp({ databaseUrl: databaseUrl! });
    await app.ready();
    const register = async (email: string, displayName: string) =>
      (
        await app.inject({
          method: "POST",
          url: "/v1/auth/register",
          payload: {
            email,
            displayName,
            password: "correct horse battery staple",
          },
        })
      ).json();
    const owner = await register("access-owner@example.com", "Owner");
    const collaborator = await register(
      "access-collaborator@example.com",
      "Collaborator",
    );
    const room = (
      await app.inject({
        method: "POST",
        url: "/v1/rooms",
        headers: { authorization: `Bearer ${owner.accessToken}` },
        payload: {},
      })
    ).json();
    const collaboratorMember = (
      await app.inject({
        method: "POST",
        url: `/v1/rooms/${room.room.id}/members`,
        headers: { authorization: `Bearer ${collaborator.accessToken}` },
        payload: {
          inviteCode: room.inviteCode,
          displayName: "Collaborator",
          actorType: "human",
        },
      })
    ).json();
    const joinAgent = async (displayName: string) =>
      (
        await app.inject({
          method: "POST",
          url: `/v1/rooms/${room.room.id}/members`,
          payload: {
            inviteCode: room.inviteCode,
            displayName,
            actorType: "agent",
            agentProvider: "codex",
          },
        })
      ).json();
    const agentA = await joinAgent("Agent A");
    const agentB = await joinAgent("Agent B");

    for (const [token, agent] of [
      [owner.accessToken, agentA],
      [collaborator.accessToken, agentB],
    ] as const) {
      const claimed = await app.inject({
        method: "POST",
        url: `/v1/rooms/${room.room.id}/agents/${agent.member.id}/claim`,
        headers: { authorization: `Bearer ${token}` },
        payload: { claimCode: agent.agentClaim.code },
      });
      expect(claimed.statusCode).toBe(201);
    }

    const grant = await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/agents/${agentA.member.id}/grants`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: { granteeMemberId: collaboratorMember.member.id },
    });
    expect(grant.statusCode).toBe(201);
    const delegatedTask = await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/messages`,
      headers: { authorization: `Bearer ${collaborator.accessToken}` },
      payload: {
        kind: "agent.task",
        text: "Delegated PostgreSQL task",
        targetMemberIds: [agentA.member.id],
        idempotencyKey: "postgres_delegated_task_0001",
      },
    });
    expect(delegatedTask.statusCode).toBe(201);

    const requested = await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/agent-collaborations`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
      payload: {
        requesterAgentMemberId: agentA.member.id,
        targetAgentMemberId: agentB.member.id,
      },
    });
    expect(requested.statusCode).toBe(201);
    expect(requested.json().collaboration.status).toBe("pending");
    const collaborationId = requested.json().collaboration.id;
    const accepted = await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/agent-collaborations/${collaborationId}/respond`,
      headers: { authorization: `Bearer ${collaborator.accessToken}` },
      payload: { action: "accept" },
    });
    expect(accepted.statusCode).toBe(200);
    const agentTask = await app.inject({
      method: "POST",
      url: `/v1/rooms/${room.room.id}/messages`,
      headers: { authorization: `Bearer ${agentA.accessToken}` },
      payload: {
        kind: "agent.task",
        text: "Authorized PostgreSQL collaboration",
        targetMemberIds: [agentB.member.id],
        idempotencyKey: "postgres_collaboration_0001",
      },
    });
    expect(agentTask.statusCode).toBe(201);

    const revokedGrant = await app.inject({
      method: "DELETE",
      url: `/v1/rooms/${room.room.id}/agents/${agentA.member.id}/grants/${grant.json().grant.id}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(revokedGrant.statusCode).toBe(204);
    const revokedCollaboration = await app.inject({
      method: "DELETE",
      url: `/v1/rooms/${room.room.id}/agent-collaborations/${collaborationId}`,
      headers: { authorization: `Bearer ${owner.accessToken}` },
    });
    expect(revokedCollaboration.statusCode).toBe(200);
    await app.close();
  });
});
