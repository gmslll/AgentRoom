import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { readBearerToken } from "../../lib/auth.js";
import { AuthRateLimiter } from "./rate-limiter.js";
import type { AuthService } from "./service.js";

const Email = Type.String({
  minLength: 3,
  maxLength: 254,
  pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
});

const Password = Type.String({ minLength: 8, maxLength: 128 });

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

export function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
): void {
  const registrationLimiter = new AuthRateLimiter(5, 60_000);
  const loginLimiter = new AuthRateLimiter(10, 60_000);

  app.post<{ Body: Static<typeof RegisterBody> }>(
    "/v1/auth/register",
    { schema: { body: RegisterBody } },
    async (request, reply) => {
      registrationLimiter.consume(request.ip);
      return reply.status(201).send(await authService.register(request.body));
    },
  );

  app.post<{ Body: Static<typeof LoginBody> }>(
    "/v1/auth/login",
    { schema: { body: LoginBody } },
    async (request) => {
      const attemptKey = `${request.ip}:${request.body.email.trim().toLowerCase()}`;
      loginLimiter.consume(attemptKey);
      const access = await authService.login(request.body);
      loginLimiter.reset(attemptKey);
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
}
