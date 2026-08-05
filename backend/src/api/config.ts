export interface AppConfig {
  host: string;
  port: number;
  logLevel: string;
  corsOrigin: string;
  databaseUrl: string | undefined;
  authSessionTtlMs: number;
  publicBaseUrl: string;
  redisUrl: string | undefined;
  files: FilesConfig;
  s3: S3Config;
  mail: MailConfig;
  oauth: OAuthConfig;
  frontendUrl: string;
  moderationEnabled: boolean;
  mcpEnabled: boolean;
}

export interface FilesConfig {
  enabled: boolean;
  maxSizeBytes: number;
  roomQuotaBytes: number;
  /** Simulated antivirus outcome applied when completing an upload. */
  scanResult: "clean" | "flagged";
  uploadUrlTtlSeconds: number;
}

export interface S3Config {
  endpoint: string | undefined;
  region: string;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  bucket: string | undefined;
  forcePathStyle: boolean;
}

export interface MailConfig {
  driver: "log" | "smtp";
  from: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string | undefined;
  smtpPass: string | undefined;
  codeTtlMinutes: number;
}

export interface OAuthConfig {
  googleClientId: string | undefined;
  googleClientSecret: string | undefined;
  githubClientId: string | undefined;
  githubClientSecret: string | undefined;
  stateTtlSeconds: number;
}

function integerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number.parseInt(env[name] ?? String(fallback), 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = integerEnv(env, "PORT", 8787, 1, 65_535);
  const authSessionTtlDays = integerEnv(
    env,
    "AUTH_SESSION_TTL_DAYS",
    30,
    1,
    365,
  );

  const publicBaseUrl = normalizePublicBaseUrl(
    env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${port}`,
  );

  return {
    host: env.HOST ?? "127.0.0.1",
    port,
    logLevel: env.LOG_LEVEL ?? "info",
    corsOrigin: env.CORS_ORIGIN ?? "http://localhost:3000",
    databaseUrl: env.DATABASE_URL,
    authSessionTtlMs: authSessionTtlDays * 24 * 60 * 60 * 1_000,
    publicBaseUrl,
    redisUrl: env.REDIS_URL,
    files: {
      enabled: env.FILES_ENABLED === "true",
      maxSizeBytes: integerEnv(
        env,
        "FILES_MAX_SIZE_BYTES",
        104_857_600,
        1,
        100_000_000_000,
      ),
      roomQuotaBytes: integerEnv(
        env,
        "FILES_ROOM_QUOTA_BYTES",
        1_048_576_000,
        1,
        1_000_000_000_000,
      ),
      scanResult: env.FILES_SCAN_RESULT === "flagged" ? "flagged" : "clean",
      uploadUrlTtlSeconds: integerEnv(
        env,
        "FILES_UPLOAD_URL_TTL_SECONDS",
        300,
        30,
        3600,
      ),
    },
    s3: {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION ?? "us-east-1",
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      bucket: env.S3_BUCKET,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === "true",
    },
    mail: {
      driver: env.MAIL_DRIVER === "smtp" ? "smtp" : "log",
      from: env.MAIL_FROM ?? "AgentRoom <no-reply@agentroom.local>",
      smtpHost: env.SMTP_HOST ?? "127.0.0.1",
      smtpPort: integerEnv(env, "SMTP_PORT", 587, 1, 65_535),
      smtpUser: env.SMTP_USER,
      smtpPass: env.SMTP_PASS,
      codeTtlMinutes: integerEnv(env, "MAIL_CODE_TTL_MINUTES", 15, 5, 60),
    },
    oauth: {
      googleClientId: env.OAUTH_GOOGLE_CLIENT_ID,
      googleClientSecret: env.OAUTH_GOOGLE_CLIENT_SECRET,
      githubClientId: env.OAUTH_GITHUB_CLIENT_ID,
      githubClientSecret: env.OAUTH_GITHUB_CLIENT_SECRET,
      stateTtlSeconds: integerEnv(env, "OAUTH_STATE_TTL_SECONDS", 600, 30, 3600),
    },
    frontendUrl: env.FRONTEND_URL ?? "http://localhost:3000",
    moderationEnabled: env.MODERATION_ENABLED === "true",
    mcpEnabled: env.MCP_ENABLED === "true",
  };
}

export function normalizePublicBaseUrl(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      "PUBLIC_BASE_URL must be an HTTP(S) URL without credentials, query, or hash",
    );
  }
  const normalized = url.toString().replace(/\/$/, "");
  if (
    !/^https?:\/\/[A-Za-z0-9._~:/%\[\]-]+$/.test(normalized) ||
    /%(?![0-9A-Fa-f]{2})/.test(normalized)
  ) {
    throw new Error(
      "PUBLIC_BASE_URL contains characters that are unsafe in a copyable CLI command",
    );
  }
  return normalized;
}
