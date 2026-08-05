import type { FastifyError, FastifyInstance } from "fastify";

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId: request.id,
        },
      });
    }

    if (error.validation) {
      return reply.status(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: error.message,
          requestId: request.id,
        },
      });
    }

    request.log.error({ err: error }, "Unhandled request error");
    return reply.status(500).send({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: request.id,
      },
    }),
  );
}
