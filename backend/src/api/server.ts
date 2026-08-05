import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const app = await buildApp({
  logger: { level: config.logLevel },
  corsOrigin: config.corsOrigin,
  authSessionTtlMs: config.authSessionTtlMs,
  publicBaseUrl: config.publicBaseUrl,
  files: config.files,
  s3: config.s3,
  mail: config.mail,
  oauth: config.oauth,
  frontendUrl: config.frontendUrl,
  moderationEnabled: config.moderationEnabled,
  mcpEnabled: config.mcpEnabled,
  ...(config.databaseUrl ? { databaseUrl: config.databaseUrl } : {}),
  ...(config.redisUrl ? { redisUrl: config.redisUrl } : {}),
});

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down");
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.fatal({ err: error }, "Failed to start server");
  process.exit(1);
}
