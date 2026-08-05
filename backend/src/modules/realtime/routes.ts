import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { createId } from "../../lib/secrets.js";
import { readBearerToken } from "../../lib/auth.js";
import type { RoomService } from "../rooms/service.js";
import type { EventBus } from "./event-bus.js";
import type { PresenceService } from "./presence.js";
import type { RealtimeTicketService } from "./tickets.js";

const RealtimeQuery = Type.Object(
  { ticket: Type.String({ minLength: 10, maxLength: 200 }) },
  { additionalProperties: false },
);

const RoomParams = Type.Object(
  { roomId: Type.String({ minLength: 8, maxLength: 80 }) },
  { additionalProperties: false },
);

export function registerRealtimeRoutes(
  app: FastifyInstance,
  ticketService: RealtimeTicketService,
  eventBus: EventBus,
  presence: PresenceService,
  roomService: RoomService,
): void {
  app.get<{ Querystring: Static<typeof RealtimeQuery> }>(
    "/v1/realtime",
    {
      websocket: true,
      schema: { querystring: RealtimeQuery },
    },
    (socket, request) => {
      const member = ticketService.consume(request.query.ticket);
      if (!member) {
        socket.close(1008, "Invalid or expired realtime ticket");
        return;
      }
      // The ticket may be up to 60s old; reject members removed in the
      // meantime (their token is already invalid, so the socket must not
      // keep receiving room events).
      void roomService.isActiveMember(member.roomId, member.id).then((active) => {
        if (!active) {
          socket.close(1008, "Membership revoked");
        }
      });

      const publishPresence = (online: boolean) => {
        eventBus.publish({
          version: 1,
          eventId: createId("evt"),
          type: "member.presence",
          roomId: member.roomId,
          occurredAt: new Date().toISOString(),
          data: {
            memberId: member.id,
            online,
            lastSeenAt: online ? new Date().toISOString() : null,
          },
        });
      };

      void presence.markOnline(member.roomId, member.id).catch(() => undefined);
      publishPresence(true);

      const unsubscribe = eventBus.subscribe(
        member.roomId,
        member.id,
        (event) => {
          // A kicked member's socket must stop receiving room events: close
          // it so the close handler clears presence and releases the socket.
          if (
            event.type === "member.removed" &&
            event.data.memberId === member.id
          ) {
            socket.close(1008, "Removed from room");
            return;
          }
          if (socket.readyState === 1) {
            if (socket.bufferedAmount > 1024 * 1024) {
              socket.close(1013, "Realtime client is too slow");
              return;
            }
            socket.send(JSON.stringify(event));
          }
        },
      );

      socket.on("message", (payload) => {
        try {
          const input: unknown = JSON.parse(payload.toString());
          if (
            typeof input === "object" &&
            input !== null &&
            "type" in input &&
            input.type === "ping"
          ) {
            // Refresh the presence TTL while the connection is alive.
            void presence.markOnline(member.roomId, member.id).catch(
              () => undefined,
            );
            socket.send(JSON.stringify({ type: "pong" }));
            return;
          }
          socket.close(1003, "Only ping client messages are supported");
        } catch {
          socket.close(1007, "Client messages must be valid JSON");
        }
      });
      socket.once("close", () => {
        unsubscribe();
        void presence.markOffline(member.roomId, member.id).catch(() => undefined);
        eventBus.publish({
          version: 1,
          eventId: createId("evt"),
          type: "member.presence",
          roomId: member.roomId,
          occurredAt: new Date().toISOString(),
          data: { memberId: member.id, online: false, lastSeenAt: null },
        });
      });
      socket.once("error", unsubscribe);

      socket.send(
        JSON.stringify({
          version: 1,
          eventId: createId("evt"),
          type: "session.ready",
          roomId: member.roomId,
          occurredAt: new Date().toISOString(),
          data: { member },
        }),
      );
    },
  );

  app.get<{ Params: Static<typeof RoomParams> }>(
    "/v1/rooms/:roomId/presence",
    { schema: { params: RoomParams } },
    async (request) => {
      const accessToken = readBearerToken(request.headers.authorization);
      const members = await roomService.listMembers({
        roomId: request.params.roomId,
        accessToken,
      });
      const items = await presence.list(
        request.params.roomId,
        members.map((member) => member.id),
      );
      return { items };
    },
  );
}
