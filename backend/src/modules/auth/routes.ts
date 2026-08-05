import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { readBearerToken } from "../../lib/auth.js";
import type { KeyValueStore } from "../../lib/redis.js";
import {
  AuthRateLimiter,
  RedisAuthRateLimiter,
} from "./rate-limiter.js";
import type { AuthService } from "./service.js";

const Email = Type.String({
  minLength: 3,
  maxLength: 254,
  pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
});

const Password = Type.String({ minLength: 8, maxLength: 128 });

const EmailCode = Type.String({ minLength: 6, maxLength: 32 });

const RegisterBody = Type.Object(
  {
    email: Email,
    displayName: Type.String({ minLength: 1, maxLength: 64, pattern: "\\S" }),
    password: Password,
  },
  { additionalProperties: false },
);

const LoginBody = Type.Object(
  { email: Email, password: Password },
  { additionalProperties: false },
);

const VerifyEmailBody = Type.Object(
  { code: EmailCode },
  { additionalProperties: false },
);

const ResetRequestBody = Type.Object(
  { email: Email },
  { additionalProperties: false },
);

const ResetBody = Type.Object(
  {
    email: Email,
    code: EmailCode,
    newPassword: Password,
  },
  { additionalProperties: false },
);

const ChangePasswordBody = Type.Object(
  {
    currentPassword: Password,
    newPassword: Password,
  },
  { additionalProperties: false },
);

const OAuthProviderParams = Type.Object(
  { provider: Type.Union([Type.Literal("google"), Type.Literal("github")]) },
  { additionalProperties: false },
);

const OAuthCallbackQuery = Type.Object(
  {
    code: Type.String({ minLength: 1 }),
    state: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export interface AuthRouteOptions {
  store?: KeyValueStore;
  frontendUrl?: string;
}

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  options: AuthRouteOptions = {},
): void {
  const registrationLimiter = options.store
    ? new RedisAuthRateLimiter(options.store, 5, 60_000)
    : new AuthRateLimiter(5, 60_000);
  const loginLimiter = options.store
    ? new RedisAuthRateLimiter(options.store, 10, 60_000)
    : new AuthRateLimiter(10, 60_000);
  const resetLimiter = options.store
    ? new RedisAuthRateLimiter(options.store, 5, 60_000)
    : new AuthRateLimiter(5, 60_000);
  const verifyLimiter = options.store
    ? new RedisAuthRateLimiter(options.store, 10, 60_000)
    : new AuthRateLimiter(10, 60_000);
  const frontendUrl = (options.frontendUrl ?? "http://localhost:3000").replace(
    /\/$/,
    "",
  );

  app.post<{ Body: Static<typeof RegisterBody> }>(
    "/v1/auth/register",
    { schema: { body: RegisterBody } },
    async (request, reply) => {
      await registrationLimiter.consume(request.ip);
      return reply.status(201).send(await authService.register(request.body));
    },
  );

  app.post<{ Body: Static<typeof LoginBody> }>(
    "/v1/auth/login",
    { schema: { body: LoginBody } },
    async (request) => {
      const attemptKey = `${request.ip}:${request.body.email.trim().toLowerCase()}`;
      await loginLimiter.consume(attemptKey);
      const access = await authService.login(request.body);
      await loginLimiter.reset(attemptKey);
      return access;
    },
  );

  app.get("/v1/auth/me", async (request) => ({
    user: await authService.authenticate(
      readBearerToken(request.headers.authorization),
    ),
  }));

  app.post("/v1/auth/logout", async (request, reply) => {
    await authService.logout(readBearerToken(request.headers.authorization));
    return reply.status(204).send();
  });

  app.post("/v1/auth/email/verification", async (request, reply) => {
    await authService.requestEmailVerification(
      readBearerToken(request.headers.authorization),
    );
    return reply.status(202).send();
  });

  app.post<{ Body: Static<typeof VerifyEmailBody> }>(
    "/v1/auth/email/verify",
    { schema: { body: VerifyEmailBody } },
    async (request) => {
      await verifyLimiter.consume(request.ip);
      return {
        user: await authService.verifyEmail(
          readBearerToken(request.headers.authorization),
          request.body.code,
        ),
      };
    },
  );

  app.post<{ Body: Static<typeof ResetRequestBody> }>(
    "/v1/auth/password/reset-request",
    { schema: { body: ResetRequestBody } },
    async (request, reply) => {
      await resetLimiter.consume(
        `${request.ip}:${request.body.email.trim().toLowerCase()}`,
      );
      await authService.requestPasswordReset(request.body.email);
      return reply.status(202).send();
    },
  );

  app.post<{ Body: Static<typeof ResetBody> }>(
    "/v1/auth/password/reset",
    { schema: { body: ResetBody } },
    async (request) => {
      await resetLimiter.consume(request.ip);
      return {
        user: await authService.resetPassword(request.body),
      };
    },
  );

  app.post<{ Body: Static<typeof ChangePasswordBody> }>(
    "/v1/auth/password/change",
    { schema: { body: ChangePasswordBody } },
    async (request, reply) => {
      await authService.changePassword({
        accessToken: readBearerToken(request.headers.authorization),
        currentPassword: request.body.currentPassword,
        newPassword: request.body.newPassword,
      });
      return reply.status(204).send();
    },
  );

  app.get<{ Params: Static<typeof OAuthProviderParams> }>(
    "/v1/auth/oauth/:provider/authorize",
    { schema: { params: OAuthProviderParams } },
    async (request, reply) => {
      const { redirectUrl } = await authService.oauthAuthorize(
        request.params.provider,
      );
      return reply.redirect(redirectUrl);
    },
  );

  app.get<{
    Params: Static<typeof OAuthProviderParams>;
    Querystring: Static<typeof OAuthCallbackQuery>;
  }>(
    "/v1/auth/oauth/:provider/callback",
    { schema: { params: OAuthProviderParams, querystring: OAuthCallbackQuery } },
    async (request, reply) => {
      const access = await authService.oauthCallback(
        request.params.provider,
        request.query.code,
        request.query.state,
      );
      const fragment = new URLSearchParams({
        access_token: access.accessToken,
        expires_at: access.expiresAt,
      }).toString();
      return reply.redirect(`${frontendUrl}/#${fragment}`);
    },
  );
}
