export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  corsOrigin: string;
  databaseUrl: string | undefined;
  authSessionTtlMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number.parseInt(env.PORT ?? "8787", 10);
  const authSessionTtlDays = Number.parseInt(
    env.AUTH_SESSION_TTL_DAYS ?? "30",
    10,
  );

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  if (
    !Number.isInteger(authSessionTtlDays) ||
    authSessionTtlDays < 1 ||
    authSessionTtlDays > 365
  ) {
    throw new Error("AUTH_SESSION_TTL_DAYS must be an integer from 1 to 365");
  }

  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    logLevel: env.LOG_LEVEL ?? "info",
    corsOrigin: env.CORS_ORIGIN ?? "http://localhost:3000",
    databaseUrl: env.DATABASE_URL,
    authSessionTtlMs: authSessionTtlDays * 24 * 60 * 60 * 1_000,
  };
}
