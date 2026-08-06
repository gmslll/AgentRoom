import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { normalizePublicBaseUrl, type FilesConfig, type MailConfig, type OAuthConfig, type S3Config } from "./config.js";
import { installErrorHandler } from "../lib/errors.js";
import { createMailer } from "../lib/mailer.js";
import { createObjectStorage, type ObjectStorage } from "../lib/object-storage.js";
import { createOAuthProvider } from "../lib/oauth.js";
import { createKeyValueStore, type KeyValueStore } from "../lib/redis.js";
import { InMemoryAuthRepository } from "../modules/auth/memory-repository.js";
import { PostgresAuthRepository } from "../modules/auth/postgres-repository.js";
import type { AuthRepository } from "../modules/auth/repository.js";
import { registerAuthRoutes } from "../modules/auth/routes.js";
import { AuthService } from "../modules/auth/service.js";
import { registerDocumentationRoutes } from "../modules/docs/routes.js";
import { registerDownloadRoutes } from "../modules/downloads/routes.js";
import { InMemoryFileRepository } from "../modules/files/memory-repository.js";
import { PostgresFileRepository } from "../modules/files/postgres-repository.js";
import type { FileRepository } from "../modules/files/repository.js";
import { registerFileRoutes } from "../modules/files/routes.js";
import { FileService } from "../modules/files/service.js";
import { registerHealthRoutes } from "../modules/health/routes.js";
import { registerMcpRoutes } from "../modules/mcp/server.js";
import { InMemoryEventBus, RedisEventBus } from "../modules/realtime/event-bus.js";
import { OutboxPublisher } from "../modules/realtime/outbox-publisher.js";
import { KeyValuePresenceService } from "../modules/realtime/presence.js";
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
  cliArtifactsDirectory?: string;
  redisUrl?: string;
  files?: FilesConfig;
  s3?: S3Config;
  mail?: MailConfig;
  oauth?: OAuthConfig;
  frontendUrl?: string;
  moderationEnabled?: boolean;
  mcpEnabled?: boolean;
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
  registerDownloadRoutes(app, options.cliArtifactsDirectory);

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

  const store: KeyValueStore = createKeyValueStore(options.redisUrl);
  const storage: ObjectStorage = createObjectStorage({
    enabled: options.files?.enabled ?? false,
    endpoint: options.s3?.endpoint,
    region: options.s3?.region ?? "us-east-1",
    accessKeyId: options.s3?.accessKeyId,
    secretAccessKey: options.s3?.secretAccessKey,
    bucket: options.s3?.bucket,
    forcePathStyle: options.s3?.forcePathStyle ?? false,
  });
  const mailer = createMailer({
    driver: options.mail?.driver ?? "log",
    from: options.mail?.from ?? "AgentRoom <no-reply@agentroom.local>",
    smtpHost: options.mail?.smtpHost ?? "127.0.0.1",
    smtpPort: options.mail?.smtpPort ?? 587,
    smtpUser: options.mail?.smtpUser,
    smtpPass: options.mail?.smtpPass,
  });

  const eventBus = options.redisUrl
    ? new RedisEventBus(store)
    : new InMemoryEventBus();
  const ticketService = new RealtimeTicketService();
  const presence = new KeyValuePresenceService(store);
  const authService = new AuthService(
    authRepository,
    options.authSessionTtlMs,
    undefined,
    mailer,
    store,
    {
      ...(options.oauth?.googleClientId && options.oauth?.googleClientSecret
        ? {
            google: createOAuthProvider(
              "google",
              options.oauth.googleClientId,
              options.oauth.googleClientSecret,
            )!,
          }
        : {}),
      ...(options.oauth?.githubClientId && options.oauth?.githubClientSecret
        ? {
            github: createOAuthProvider(
              "github",
              options.oauth.githubClientId,
              options.oauth.githubClientSecret,
            )!,
          }
        : {}),
    },
    publicBaseUrl,
    options.oauth?.stateTtlSeconds,
    options.mail?.codeTtlMinutes,
  );

  let fileService: FileService | undefined;
  const roomService = new RoomService(
    repository,
    eventBus,
    undefined,
    (accessToken) => authService.authenticate(accessToken),
    publicBaseUrl,
    {
      validateAttachments: async (roomId, attachmentIds) =>
        fileService
          ? fileService.validateAttachments(roomId, attachmentIds)
          : false,
      moderationEnabled: options.moderationEnabled ?? false,
    },
  );

  const fileRepository: FileRepository =
    options.databaseUrl
      ? new PostgresFileRepository(options.databaseUrl)
      : new InMemoryFileRepository();
  fileService = new FileService({
    repository: fileRepository,
    storage,
    authenticateMember: (roomId, accessToken) =>
      roomService.authenticate(roomId, accessToken),
    maxSizeBytes: options.files?.maxSizeBytes ?? 104_857_600,
    roomQuotaBytes: options.files?.roomQuotaBytes ?? 1_048_576_000,
    scanResult: options.files?.scanResult ?? "clean",
    uploadUrlTtlSeconds: options.files?.uploadUrlTtlSeconds ?? 300,
  });

  registerHealthRoutes(app, async () => {
    await repository.healthCheck?.();
    await authRepository.healthCheck?.();
    await fileRepository.healthCheck?.();
    await store.healthCheck();
    await storage.healthCheck();
  });

  const outboxPublisher = repository.listPendingOutbox
    ? new OutboxPublisher(repository, eventBus)
    : undefined;
  outboxPublisher?.start();
  registerAuthRoutes(app, authService, {
    store,
    frontendUrl: options.frontendUrl ?? "http://localhost:3000",
  });
  registerRoomRoutes(app, roomService, ticketService, authService);
  registerRealtimeRoutes(app, ticketService, eventBus, presence, roomService);
  registerFileRoutes(app, fileService);
  registerMcpRoutes(app, roomService, fileService, {
    enabled: options.mcpEnabled ?? false,
  });

  app.addHook("onClose", async () => {
    outboxPublisher?.stop();
    await repository.close?.();
    await authRepository.close?.();
    await fileRepository.close?.();
    await store.close();
    await storage.close();
    await mailer.close();
  });

  return app;
}
