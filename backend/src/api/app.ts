import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { normalizePublicBaseUrl } from "./config.js";
import { installErrorHandler } from "../lib/errors.js";
import { InMemoryAuthRepository } from "../modules/auth/memory-repository.js";
import { PostgresAuthRepository } from "../modules/auth/postgres-repository.js";
import type { AuthRepository } from "../modules/auth/repository.js";
import { registerAuthRoutes } from "../modules/auth/routes.js";
import { AuthService } from "../modules/auth/service.js";
import { registerDocumentationRoutes } from "../modules/docs/routes.js";
import { registerHealthRoutes } from "../modules/health/routes.js";
import { InMemoryEventBus } from "../modules/realtime/event-bus.js";
import { registerRealtimeRoutes } from "../modules/realtime/routes.js";
import { RealtimeTicketService } from "../modules/realtime/tickets.js";
import { InMemoryRoomRepository } from "../modules/rooms/memory-repository.js";
import { PostgresRoomRepository } from "../modules/rooms/postgres-repository.js";
import type { RoomRepository } from "../modules/rooms/repository.js";
import { registerRoomRoutes } from "../modules/rooms/routes.js";
import { RoomService } from "../modules/rooms/service.js";

export interface BuildAppOptions {
  logger?: boolean | { level: string };
  corsOrigin?: string;
  databaseUrl?: string;
  repository?: RoomRepository;
  authRepository?: AuthRepository;
  authSessionTtlMs?: number;
  publicBaseUrl?: string;
}

export async function buildApp(
  options: BuildAppOptions = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

  await app.register(websocket, {
    options: {
      maxPayload: 64 * 1024,
      perMessageDeflate: false,
    },
  });
  await app.register(cors, {
    origin: options.corsOrigin ?? "http://localhost:3000",
    credentials: false,
  });

  installErrorHandler(app);

  const publicBaseUrl = normalizePublicBaseUrl(
    options.publicBaseUrl ?? "http://127.0.0.1:8787",
  );
  await registerDocumentationRoutes(app, publicBaseUrl);

  const repository: RoomRepository =
    options.repository ??
    (options.databaseUrl
      ? new PostgresRoomRepository(options.databaseUrl)
      : new InMemoryRoomRepository());
  const authRepository: AuthRepository =
    options.authRepository ??
    (options.databaseUrl
      ? new PostgresAuthRepository(options.databaseUrl)
      : new InMemoryAuthRepository());
  const eventBus = new InMemoryEventBus();
  const ticketService = new RealtimeTicketService();
  const authService = new AuthService(
    authRepository,
    options.authSessionTtlMs,
  );
  const roomService = new RoomService(
    repository,
    eventBus,
    undefined,
    (accessToken) => authService.authenticate(accessToken),
    publicBaseUrl,
  );

  registerHealthRoutes(app, async () => {
    await repository.healthCheck?.();
    await authRepository.healthCheck?.();
  });
  registerAuthRoutes(app, authService);
  registerRoomRoutes(app, roomService, ticketService, authService);
  registerRealtimeRoutes(app, ticketService, eventBus);
  app.addHook("onClose", async () => {
    await repository.close?.();
    await authRepository.close?.();
  });

  return app;
}
