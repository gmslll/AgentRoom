import { AsyncLocalStorage } from "node:async_hooks";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../lib/errors.js";
import type { FileService } from "../files/service.js";
import type { RoomService } from "../rooms/service.js";

/**
 * Remote MCP server exposed over Streamable HTTP at GET/POST /mcp.
 *
 * Authentication is per-request: every HTTP request carries a room member
 * bearer token (`art_` or an account `ars_` linked to the room), and each tool
 * invocation authenticates that token against the requested room. The
 * transport is stateless (no session IDs) so every request is independently
 * authorized.
 */

const accessTokenStorage = new AsyncLocalStorage<string | undefined>();

function requireToken(): string {
  const token = accessTokenStorage.getStore();
  if (!token) {
    throw new AppError(401, "AUTH_REQUIRED", "A bearer token is required");
  }
  return token;
}

export interface McpRouteOptions {
  enabled: boolean;
}

export function registerMcpRoutes(
  app: FastifyInstance,
  roomService: RoomService,
  fileService: FileService | undefined,
  options: McpRouteOptions,
): void {
  if (!options.enabled) {
    return;
  }

  app.route({
    method: ["GET", "POST"],
    url: "/mcp",
    handler: async (request, reply) => {
      const authorization = request.headers.authorization;
      const token = authorization?.startsWith("Bearer ")
        ? authorization.slice("Bearer ".length).trim()
        : undefined;
      if (!token) {
        return reply.status(401).send({
          error: {
            code: "AUTH_REQUIRED",
            message: "A bearer token is required",
            requestId: request.id,
          },
        });
      }

      // The MCP SDK expects one Protocol instance per connection. Stateless
      // Streamable HTTP requests are independent, so build a fresh server and
      // transport per request; tools are cheap to register and there is no
      // cross-request state to leak.
      const server = new McpServer({
        name: "agentroom",
        version: "0.1.0",
      });
      registerRoomTools(server, roomService);
      if (fileService) {
        registerFileTools(server, fileService);
      }
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);
      transport.onerror = (error) => {
        console.error("MCP transport error:", error);
      };

      reply.hijack();
      try {
        await server.connect(
          transport as unknown as Parameters<typeof server.connect>[0],
        );
        await accessTokenStorage.run(token, () =>
          transport.handleRequest(request.raw, reply.raw, request.body),
        );
      } catch (error) {
        console.error("MCP request handling failed:", error);
        request.log.error({ err: error }, "MCP request handling failed");
        if (!reply.raw.headersSent) {
          reply.raw.statusCode = 500;
          reply.raw.end(
            JSON.stringify({
              jsonrpc: "2.0",
              error: { code: -32603, message: "Internal error" },
              id: null,
            }),
          );
        }
      }
    },
  });
}

function registerRoomTools(
  server: McpServer,
  roomService: RoomService,
): void {
  const roomId = z.string().min(8).max(80);

  server.registerTool(
    "room_list_members",
    {
      description: "Lists the members of an AgentRoom room.",
      inputSchema: { roomId },
    },
    async ({ roomId: targetRoomId }) =>
      runTool(() =>
        roomService.listMembers({
          roomId: targetRoomId,
          accessToken: requireToken(),
        }),
      ),
  );

  server.registerTool(
    "room_list_messages",
    {
      description:
        "Lists room messages ordered by ascending room sequence. Provide afterSequence to page forward.",
      inputSchema: {
        roomId,
        afterSequence: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (input) =>
      runTool(() =>
        roomService.listMessages({
          roomId: input.roomId,
          accessToken: requireToken(),
          afterSequence: input.afterSequence ?? 0,
          limit: input.limit ?? 50,
        }),
      ),
  );

  server.registerTool(
    "room_send_text",
    {
      description: "Posts a plain text message to the room.",
      inputSchema: {
        roomId,
        text: z.string().min(1).max(8_000),
      },
    },
    async (input) =>
      runTool(() =>
        roomService.sendMessage({
          kind: "text",
          roomId: input.roomId,
          accessToken: requireToken(),
          text: input.text,
        }),
      ),
  );

  server.registerTool(
    "room_send_task",
    {
      description:
        "Creates an agent.task targeting one or more agent members. Requires the room owner token.",
      inputSchema: {
        roomId,
        text: z.string().min(1).max(8_000),
        targetMemberIds: z.array(z.string().min(8).max(80)).min(1).max(10),
        idempotencyKey: z.string().min(8).max(100),
      },
    },
    async (input) =>
      runTool(() =>
        roomService.sendMessage({
          kind: "agent.task",
          roomId: input.roomId,
          accessToken: requireToken(),
          text: input.text,
          targetMemberIds: input.targetMemberIds,
          idempotencyKey: input.idempotencyKey,
        }),
      ),
  );

  server.registerTool(
    "room_list_pending_deliveries",
    {
      description:
        "Lists non-terminal task deliveries addressed to the authenticated agent member.",
      inputSchema: { roomId },
    },
    async ({ roomId: targetRoomId }) =>
      runTool(() =>
        roomService.listPendingDeliveries({
          roomId: targetRoomId,
          accessToken: requireToken(),
        }),
      ),
  );

  server.registerTool(
    "room_update_delivery_status",
    {
      description:
        "Updates a task delivery status: received, running, or failed (with error text).",
      inputSchema: {
        roomId,
        deliveryId: z.string().min(8).max(80),
        status: z.enum(["received", "running", "failed"]),
        error: z.string().max(2_000).optional(),
      },
    },
    async (input) =>
      runTool(() =>
        roomService.updateDeliveryStatus({
          roomId: input.roomId,
          deliveryId: input.deliveryId,
          accessToken: requireToken(),
          status: input.status,
          error: input.status === "failed" ? (input.error ?? "failed") : null,
        }),
      ),
  );

  server.registerTool(
    "room_reply_delivery",
    {
      description:
        "Posts an agent.reply for a delivery, completing it. Optionally relays the result to new agent targets.",
      inputSchema: {
        roomId,
        deliveryId: z.string().min(8).max(80),
        text: z.string().min(1).max(8_000),
        relay: z
          .object({
            targetMemberIds: z.array(z.string().min(8).max(80)).min(1).max(10),
            idempotencyKey: z.string().min(8).max(100),
          })
          .optional(),
      },
    },
    async (input) =>
      runTool(() =>
        roomService.replyToDelivery({
          roomId: input.roomId,
          deliveryId: input.deliveryId,
          accessToken: requireToken(),
          text: input.text,
          ...(input.relay ? { relay: input.relay } : {}),
        }),
      ),
  );
}

function registerFileTools(
  server: McpServer,
  fileService: FileService,
): void {
  const roomId = z.string().min(8).max(80);

  server.registerTool(
    "room_list_attachments",
    {
      description: "Lists attachment metadata for a room.",
      inputSchema: { roomId },
    },
    async ({ roomId: targetRoomId }) =>
      runTool(() =>
        fileService.listAttachments({
          roomId: targetRoomId,
          accessToken: requireToken(),
        }),
      ),
  );
}

async function runTool<T>(work: () => Promise<T>): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  try {
    const value = await work();
    return {
      content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    };
  } catch (error) {
    const message =
      error instanceof AppError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
}
