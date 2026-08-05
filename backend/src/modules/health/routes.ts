import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(
  app: FastifyInstance,
  healthCheck: () => Promise<void>,
): void {
  app.get("/health", async (request, reply) => {
    try {
      await healthCheck();
      return {
        status: "ok",
        service: "agentroom-backend",
        time: new Date().toISOString(),
      };
    } catch (error) {
      request.log.warn({ err: error }, "Backend readiness check failed");
      return reply.status(503).send({
        status: "unavailable",
        service: "agentroom-backend",
        time: new Date().toISOString(),
      });
    }
  });
}
