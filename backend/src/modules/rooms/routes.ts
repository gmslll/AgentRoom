import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { readBearerToken } from "../../lib/auth.js";
import { AppError } from "../../lib/errors.js";
import type { AuthService } from "../auth/service.js";
import type { RealtimeTicketService } from "../realtime/tickets.js";
import type { RoomService } from "./service.js";

const RoomParams = Type.Object(
  { roomId: Type.String({ minLength: 8, maxLength: 80 }) },
  { additionalProperties: false },
);

const CreateRoomBody = Type.Object(
  {
    name: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 100,
        pattern: "\\S",
        default: "Untitled room",
      }),
    ),
    displayName: Type.Optional(
      Type.String({ minLength: 1, maxLength: 64, pattern: "\\S" }),
    ),
    visibility: Type.Optional(
      Type.Union([Type.Literal("private"), Type.Literal("public")]),
    ),
  },
  { additionalProperties: false },
);

const JoinRoomBody = Type.Object(
  {
    inviteCode: Type.Optional(
      Type.String({ minLength: 8, maxLength: 100 }),
    ),
    displayName: Type.String({ minLength: 1, maxLength: 64, pattern: "\\S" }),
    actorType: Type.Union([
      Type.Literal("human"),
      Type.Literal("agent"),
      Type.Literal("terminal"),
    ]),
    agentProvider: Type.Optional(
      Type.Union([
        Type.Literal("claude"),
        Type.Literal("codex"),
        Type.Literal("other"),
      ]),
    ),
  },
  { additionalProperties: false },
);

const SendMessageBody = Type.Object(
  {
    kind: Type.Union([Type.Literal("text"), Type.Literal("agent.task")]),
    text: Type.String({ minLength: 1, maxLength: 8_000, pattern: "\\S" }),
    targetMemberIds: Type.Optional(
      Type.Array(Type.String({ minLength: 8, maxLength: 80 }), {
        minItems: 1,
        maxItems: 10,
      }),
    ),
    idempotencyKey: Type.Optional(
      Type.String({ minLength: 8, maxLength: 100 }),
    ),
    attachmentIds: Type.Optional(
      Type.Array(Type.String({ minLength: 8, maxLength: 80 }), {
        maxItems: 10,
      }),
    ),
  },
  { additionalProperties: false },
);

const DeliveryParams = Type.Object(
  {
    roomId: Type.String({ minLength: 8, maxLength: 80 }),
    deliveryId: Type.String({ minLength: 8, maxLength: 80 }),
  },
  { additionalProperties: false },
);

const UpdateDeliveryBody = Type.Union([
  Type.Object(
    { status: Type.Literal("received") },
    { additionalProperties: false },
  ),
  Type.Object(
    { status: Type.Literal("running") },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      status: Type.Literal("failed"),
      error: Type.String({ minLength: 1, maxLength: 2_000, pattern: "\\S" }),
    },
    { additionalProperties: false },
  ),
]);

const ReplyDeliveryBody = Type.Object(
  {
    text: Type.String({ minLength: 1, maxLength: 8_000, pattern: "\\S" }),
    attachmentIds: Type.Optional(
      Type.Array(Type.String({ minLength: 8, maxLength: 80 }), {
        maxItems: 10,
      }),
    ),
    relay: Type.Optional(
      Type.Object(
        {
          targetMemberIds: Type.Array(
            Type.String({ minLength: 8, maxLength: 80 }),
            { minItems: 1, maxItems: 10 },
          ),
          idempotencyKey: Type.String({ minLength: 8, maxLength: 100 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

const MemberParams = Type.Object(
  {
    roomId: Type.String({ minLength: 8, maxLength: 80 }),
    memberId: Type.String({ minLength: 8, maxLength: 80 }),
  },
  { additionalProperties: false },
);

const AgentGrantParams = Type.Object(
  {
    roomId: Type.String({ minLength: 8, maxLength: 80 }),
    agentId: Type.String({ minLength: 8, maxLength: 80 }),
    grantId: Type.String({ minLength: 8, maxLength: 80 }),
  },
  { additionalProperties: false },
);

const AgentParams = Type.Object(
  {
    roomId: Type.String({ minLength: 8, maxLength: 80 }),
    agentId: Type.String({ minLength: 8, maxLength: 80 }),
  },
  { additionalProperties: false },
);

const ClaimAgentBody = Type.Object(
  { claimCode: Type.String({ minLength: 12, maxLength: 100 }) },
  { additionalProperties: false },
);

const CreateAgentGrantBody = Type.Object(
  { granteeMemberId: Type.String({ minLength: 8, maxLength: 80 }) },
  { additionalProperties: false },
);

const CreateCollaborationBody = Type.Object(
  {
    requesterAgentMemberId: Type.String({ minLength: 8, maxLength: 80 }),
    targetAgentMemberId: Type.String({ minLength: 8, maxLength: 80 }),
  },
  { additionalProperties: false },
);

const CollaborationParams = Type.Object(
  {
    roomId: Type.String({ minLength: 8, maxLength: 80 }),
    collaborationId: Type.String({ minLength: 8, maxLength: 80 }),
  },
  { additionalProperties: false },
);

const RespondCollaborationBody = Type.Object(
  { action: Type.Union([Type.Literal("accept"), Type.Literal("reject")]) },
  { additionalProperties: false },
);

const RuleParams = Type.Object(
  {
    roomId: Type.String({ minLength: 8, maxLength: 80 }),
    ruleId: Type.String({ minLength: 8, maxLength: 80 }),
  },
  { additionalProperties: false },
);

const CreateRuleBody = Type.Object(
  {
    pattern: Type.String({ minLength: 1, maxLength: 200 }),
    action: Type.Union([Type.Literal("flag"), Type.Literal("reject")]),
  },
  { additionalProperties: false },
);

const ListMessagesQuery = Type.Object(
  {
    afterSequence: Type.Optional(
      Type.Integer({ minimum: 0, default: 0 }),
    ),
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 200, default: 50 }),
    ),
  },
  { additionalProperties: false },
);

const ListPublicRoomsQuery = Type.Object(
  {
    limit: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 100, default: 50 }),
    ),
  },
  { additionalProperties: false },
);

const UpdateRoomBody = Type.Object(
  {
    name: Type.Optional(
      Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
    ),
    visibility: Type.Optional(
      Type.Union([Type.Literal("private"), Type.Literal("public")]),
    ),
  },
  { additionalProperties: false, minProperties: 1 },
);

export function registerRoomRoutes(
  app: FastifyInstance,
  roomService: RoomService,
  ticketService: RealtimeTicketService,
  authService: AuthService,
): void {
  app.get("/v1/rooms", async (request) => {
    const user = await authService.authenticate(
      readBearerToken(request.headers.authorization),
    );
    return { items: await roomService.listRoomsForUser(user.id) };
  });

  app.get<{ Querystring: Static<typeof ListPublicRoomsQuery> }>(
    "/v1/public-rooms",
    { schema: { querystring: ListPublicRoomsQuery } },
    async (request) => ({
      items: await roomService.listPublicRooms(request.query.limit ?? 50),
    }),
  );

  app.post<{ Body: Static<typeof CreateRoomBody> }>(
    "/v1/rooms",
    { schema: { body: CreateRoomBody } },
    async (request, reply) => {
      const user = request.headers.authorization
        ? await authService.authenticate(
            readBearerToken(request.headers.authorization),
          )
        : undefined;
      const displayName = request.body.displayName ?? user?.displayName;
      if (!displayName) {
        throw new AppError(
          400,
          "DISPLAY_NAME_REQUIRED",
          "A display name is required for guest room creation",
        );
      }
      const result = await roomService.createRoom({
        name: request.body.name ?? "Untitled room",
        displayName,
        ownerUserId: user?.id ?? null,
        visibility: request.body.visibility ?? "private",
      });
      return reply.status(201).send(result);
    },
  );

  app.patch<{
    Params: Static<typeof RoomParams>;
    Body: Static<typeof UpdateRoomBody>;
  }>(
    "/v1/rooms/:roomId",
    { schema: { params: RoomParams, body: UpdateRoomBody } },
    async (request) => ({
      room: await roomService.updateRoom({
        roomId: request.params.roomId,
        accessToken: readBearerToken(request.headers.authorization),
        ...(request.body.name !== undefined
          ? { name: request.body.name }
          : {}),
        ...(request.body.visibility !== undefined
          ? { visibility: request.body.visibility }
          : {}),
      }),
    }),
  );

  app.delete<{ Params: Static<typeof RoomParams> }>(
    "/v1/rooms/:roomId",
    { schema: { params: RoomParams } },
    async (request, reply) => {
      await roomService.dissolveRoom({
        roomId: request.params.roomId,
        accessToken: readBearerToken(request.headers.authorization),
      });
      return reply.status(204).send();
    },
  );

  app.post<{
    Params: Static<typeof RoomParams>;
    Body: Static<typeof JoinRoomBody>;
  }>(
    "/v1/rooms/:roomId/members",
    { schema: { params: RoomParams, body: JoinRoomBody } },
    async (request, reply) => {
      const user =
        request.body.actorType === "human" && request.headers.authorization
          ? await authService.authenticate(
              readBearerToken(request.headers.authorization),
            )
          : undefined;
      const result = await roomService.joinRoom({
        roomId: request.params.roomId,
        ...(request.body.inviteCode
          ? { inviteCode: request.body.inviteCode }
          : {}),
        displayName: request.body.displayName,
        actorType: request.body.actorType,
        agentProvider: request.body.agentProvider ?? null,
        userId: user?.id ?? null,
      });
      return reply.status(201).send(result);
    },
  );

  app.get<{ Params: Static<typeof RoomParams> }>(
    "/v1/rooms/:roomId/members",
    { schema: { params: RoomParams } },
    async (request) => ({
      items: await roomService.listMembers({
        roomId: request.params.roomId,
        accessToken: readBearerToken(request.headers.authorization),
      }),
    }),
  );

  app.get<{ Params: Static<typeof RoomParams> }>(
    "/v1/rooms/:roomId/agent-access",
    { schema: { params: RoomParams } },
    async (request) =>
      roomService.getAgentAccess({
        roomId: request.params.roomId,
        accessToken: readBearerToken(request.headers.authorization),
      }),
  );

  app.post<{ Params: Static<typeof AgentParams> }>(
    "/v1/rooms/:roomId/agents/:agentId/claim-code",
    { schema: { params: AgentParams } },
    async (request, reply) =>
      reply.status(201).send({
        agentClaim: await roomService.reissueAgentClaim({
          roomId: request.params.roomId,
          agentMemberId: request.params.agentId,
          accessToken: readBearerToken(request.headers.authorization),
        }),
      }),
  );

  app.post<{
    Params: Static<typeof AgentParams>;
    Body: Static<typeof ClaimAgentBody>;
  }>(
    "/v1/rooms/:roomId/agents/:agentId/claim",
    { schema: { params: AgentParams, body: ClaimAgentBody } },
    async (request, reply) =>
      reply.status(201).send({
        ownership: await roomService.claimAgent({
          roomId: request.params.roomId,
          agentMemberId: request.params.agentId,
          accessToken: readBearerToken(request.headers.authorization),
          claimCode: request.body.claimCode,
        }),
      }),
  );

  app.post<{
    Params: Static<typeof AgentParams>;
    Body: Static<typeof CreateAgentGrantBody>;
  }>(
    "/v1/rooms/:roomId/agents/:agentId/grants",
    { schema: { params: AgentParams, body: CreateAgentGrantBody } },
    async (request, reply) =>
      reply.status(201).send({
        grant: await roomService.grantAgentToUser({
          roomId: request.params.roomId,
          agentMemberId: request.params.agentId,
          granteeMemberId: request.body.granteeMemberId,
          accessToken: readBearerToken(request.headers.authorization),
        }),
      }),
  );

  app.delete<{ Params: Static<typeof AgentGrantParams> }>(
    "/v1/rooms/:roomId/agents/:agentId/grants/:grantId",
    { schema: { params: AgentGrantParams } },
    async (request, reply) => {
      await roomService.revokeAgentUserGrant({
        roomId: request.params.roomId,
        agentMemberId: request.params.agentId,
        grantId: request.params.grantId,
        accessToken: readBearerToken(request.headers.authorization),
      });
      return reply.status(204).send();
    },
  );

  app.post<{
    Body: Static<typeof CreateCollaborationBody>;
    Params: Static<typeof RoomParams>;
  }>(
    "/v1/rooms/:roomId/agent-collaborations",
    { schema: { params: RoomParams, body: CreateCollaborationBody } },
    async (request, reply) =>
      reply.status(201).send({
        collaboration: await roomService.requestAgentCollaboration({
          roomId: request.params.roomId,
          requesterAgentMemberId: request.body.requesterAgentMemberId,
          targetAgentMemberId: request.body.targetAgentMemberId,
          accessToken: readBearerToken(request.headers.authorization),
        }),
      }),
  );

  app.post<{
    Params: Static<typeof CollaborationParams>;
    Body: Static<typeof RespondCollaborationBody>;
  }>(
    "/v1/rooms/:roomId/agent-collaborations/:collaborationId/respond",
    { schema: { params: CollaborationParams, body: RespondCollaborationBody } },
    async (request) => ({
      collaboration: await roomService.respondToAgentCollaboration({
        roomId: request.params.roomId,
        collaborationId: request.params.collaborationId,
        accessToken: readBearerToken(request.headers.authorization),
        accept: request.body.action === "accept",
      }),
    }),
  );

  app.delete<{ Params: Static<typeof CollaborationParams> }>(
    "/v1/rooms/:roomId/agent-collaborations/:collaborationId",
    { schema: { params: CollaborationParams } },
    async (request) => ({
      collaboration: await roomService.revokeAgentCollaboration({
        roomId: request.params.roomId,
        collaborationId: request.params.collaborationId,
        accessToken: readBearerToken(request.headers.authorization),
      }),
    }),
  );

  app.post<{ Params: Static<typeof RoomParams> }>(
    "/v1/rooms/:roomId/invite-code/rotate",
    { schema: { params: RoomParams } },
    async (request) =>
      roomService.rotateInviteCode({
        roomId: request.params.roomId,
        accessToken: readBearerToken(request.headers.authorization),
      }),
  );

  app.get<{ Params: Static<typeof RoomParams> }>(
    "/v1/rooms/:roomId/connector",
    { schema: { params: RoomParams } },
    async (request) =>
      roomService.getConnectorInfo({
        roomId: request.params.roomId,
        accessToken: readBearerToken(request.headers.authorization),
      }),
  );

  app.get<{
    Params: Static<typeof RoomParams>;
    Querystring: Static<typeof ListMessagesQuery>;
  }>(
    "/v1/rooms/:roomId/messages",
    { schema: { params: RoomParams, querystring: ListMessagesQuery } },
    async (request) => {
      const afterSequence = request.query.afterSequence ?? 0;
      const items = await roomService.listMessages({
        roomId: request.params.roomId,
        accessToken: readBearerToken(request.headers.authorization),
        afterSequence,
        limit: request.query.limit ?? 50,
      });

      return {
        items,
        nextAfterSequence: items.at(-1)?.sequence ?? afterSequence,
      };
    },
  );

  app.post<{
    Params: Static<typeof RoomParams>;
    Body: Static<typeof SendMessageBody>;
  }>(
    "/v1/rooms/:roomId/messages",
    { schema: { params: RoomParams, body: SendMessageBody } },
    async (request, reply) => {
      const accessToken = readBearerToken(request.headers.authorization);
      if (
        request.body.kind === "agent.task" &&
        (!request.body.targetMemberIds || !request.body.idempotencyKey)
      ) {
        throw new AppError(
          400,
          "INVALID_AGENT_TASK",
          "Agent tasks require targetMemberIds and idempotencyKey",
        );
      }
      if (
        request.body.kind === "text" &&
        (request.body.targetMemberIds || request.body.idempotencyKey)
      ) {
        throw new AppError(
          400,
          "INVALID_TEXT_MESSAGE",
          "Text messages cannot target or trigger agents",
        );
      }
      const result =
        request.body.kind === "agent.task"
          ? await roomService.sendMessage({
              kind: "agent.task",
              roomId: request.params.roomId,
              accessToken,
              text: request.body.text,
              targetMemberIds: request.body.targetMemberIds!,
              idempotencyKey: request.body.idempotencyKey!,
              attachmentIds: request.body.attachmentIds ?? [],
            })
          : await roomService.sendMessage({
              kind: "text",
              roomId: request.params.roomId,
              accessToken,
              text: request.body.text,
              attachmentIds: request.body.attachmentIds ?? [],
            });
      return reply.status(result.created ? 201 : 200).send({
        message: result.message,
        deliveries: result.deliveries,
      });
    },
  );

  app.get<{ Params: Static<typeof RoomParams> }>(
    "/v1/rooms/:roomId/deliveries/pending",
    { schema: { params: RoomParams } },
    async (request) => ({
      items: await roomService.listPendingDeliveries({
        roomId: request.params.roomId,
        accessToken: readBearerToken(request.headers.authorization),
      }),
    }),
  );

  app.post<{
    Params: Static<typeof DeliveryParams>;
    Body: Static<typeof UpdateDeliveryBody>;
  }>(
    "/v1/rooms/:roomId/deliveries/:deliveryId/status",
    { schema: { params: DeliveryParams, body: UpdateDeliveryBody } },
    async (request) => ({
      delivery: await roomService.updateDeliveryStatus({
        roomId: request.params.roomId,
        deliveryId: request.params.deliveryId,
        accessToken: readBearerToken(request.headers.authorization),
        status: request.body.status,
        error: request.body.status === "failed" ? request.body.error : null,
      }),
    }),
  );

  app.post<{
    Params: Static<typeof DeliveryParams>;
    Body: Static<typeof ReplyDeliveryBody>;
  }>(
    "/v1/rooms/:roomId/deliveries/:deliveryId/reply",
    { schema: { params: DeliveryParams, body: ReplyDeliveryBody } },
    async (request, reply) =>
      reply.status(201).send(
        await roomService.replyToDelivery({
          roomId: request.params.roomId,
          deliveryId: request.params.deliveryId,
          accessToken: readBearerToken(request.headers.authorization),
          text: request.body.text,
          attachmentIds: request.body.attachmentIds ?? [],
          ...(request.body.relay
            ? {
                relay: {
                  targetMemberIds: request.body.relay.targetMemberIds,
                  idempotencyKey: request.body.relay.idempotencyKey,
                },
              }
            : {}),
        }),
      ),
  );

  app.delete<{ Params: Static<typeof MemberParams> }>(
    "/v1/rooms/:roomId/members/:memberId",
    { schema: { params: MemberParams } },
    async (request, reply) => {
      await roomService.removeMember({
        roomId: request.params.roomId,
        memberId: request.params.memberId,
        accessToken: readBearerToken(request.headers.authorization),
      });
      return reply.status(204).send();
    },
  );

  app.get<{ Params: Static<typeof RoomParams> }>(
    "/v1/rooms/:roomId/moderation/rules",
    { schema: { params: RoomParams } },
    async (request) => ({
      items: await roomService.listModerationRules({
        roomId: request.params.roomId,
        accessToken: readBearerToken(request.headers.authorization),
      }),
    }),
  );

  app.post<{
    Params: Static<typeof RoomParams>;
    Body: Static<typeof CreateRuleBody>;
  }>(
    "/v1/rooms/:roomId/moderation/rules",
    { schema: { params: RoomParams, body: CreateRuleBody } },
    async (request, reply) =>
      reply.status(201).send(
        await roomService.createModerationRule({
          roomId: request.params.roomId,
          accessToken: readBearerToken(request.headers.authorization),
          pattern: request.body.pattern,
          action: request.body.action,
        }),
      ),
  );

  app.delete<{ Params: Static<typeof RuleParams> }>(
    "/v1/rooms/:roomId/moderation/rules/:ruleId",
    { schema: { params: RuleParams } },
    async (request, reply) => {
      await roomService.deleteModerationRule({
        roomId: request.params.roomId,
        ruleId: request.params.ruleId,
        accessToken: readBearerToken(request.headers.authorization),
      });
      return reply.status(204).send();
    },
  );

  app.post<{ Params: Static<typeof RoomParams> }>(
    "/v1/rooms/:roomId/realtime-tickets",
    { schema: { params: RoomParams } },
    async (request, reply) => {
      const member = await roomService.authenticate(
        request.params.roomId,
        readBearerToken(request.headers.authorization),
      );
      return reply.status(201).send(ticketService.issue(member));
    },
  );
}
