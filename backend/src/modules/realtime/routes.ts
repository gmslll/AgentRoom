import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { createId } from "../../lib/secrets.js";
import type { EventBus } from "./event-bus.js";
import type { RealtimeTicketService } from "./tickets.js";

const RealtimeQuery = Type.Object(
  { ticket: Type.String({ minLength: 10, maxLength: 200 }) },
  { additionalProperties: false },
);

export function registerRealtimeRoutes(
  app: FastifyInstance,
  ticketService: RealtimeTicketService,
  eventBus: EventBus,
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

      const unsubscribe = eventBus.subscribe(
        member.roomId,
        member.id,
        (event) => {
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
            socket.send(JSON.stringify({ type: "pong" }));
            return;
          }
          socket.close(1003, "Only ping client messages are supported");
        } catch {
          socket.close(1007, "Client messages must be valid JSON");
        }
      });
      socket.once("close", unsubscribe);
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
}
