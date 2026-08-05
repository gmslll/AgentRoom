import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const openApiPath = fileURLToPath(
  new URL("../../../../shared/contracts/http/openapi.yaml", import.meta.url),
);

export async function registerDocumentationRoutes(
  app: FastifyInstance,
  publicBaseUrl: string,
): Promise<void> {
  const openApiYaml = await readFile(openApiPath, "utf8");
  const publicPath = new URL(publicBaseUrl).pathname.replace(/\/+$/, "");

  await app.register(swagger, {
    mode: "static",
    specification: {
      path: openApiPath,
      baseDir: dirname(openApiPath),
    },
  });
  await app.register(swaggerUi, {
    routePrefix: "/docs",
    ...(publicPath ? { indexPrefix: publicPath } : {}),
    staticCSP: true,
    uiConfig: {
      deepLinking: true,
      docExpansion: "list",
      persistAuthorization: false,
    },
    theme: {
      title: "AgentRoom API Documentation",
    },
  });

  app.get(
    "/openapi.yaml",
    { schema: { hide: true } },
    async (_request, reply) => {
      return reply.type("application/yaml; charset=utf-8").send(openApiYaml);
    },
  );
}
