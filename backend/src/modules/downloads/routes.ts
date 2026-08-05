import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { AppError } from "../../lib/errors.js";
import type {
  CliReleaseArtifact,
  CliReleaseManifest,
} from "../../protocol/cli-release.js";

const defaultArtifactsDirectory = fileURLToPath(
  new URL("../../../artifacts/cli/", import.meta.url),
);
const DownloadParams = Type.Object(
  {
    fileName: Type.String({
      minLength: 1,
      maxLength: 128,
      pattern: "^[a-zA-Z0-9._-]+$",
    }),
  },
  { additionalProperties: false },
);

export function registerDownloadRoutes(
  app: FastifyInstance,
  artifactsDirectory = defaultArtifactsDirectory,
): void {
  app.get("/downloads/cli/manifest.json", async (_request, reply) => {
    const manifest = await loadManifest(artifactsDirectory);
    return reply
      .header("cache-control", "no-cache, no-store, must-revalidate")
      .send(manifest);
  });

  app.get<{ Params: Static<typeof DownloadParams> }>(
    "/downloads/cli/:fileName",
    { schema: { params: DownloadParams } },
    async (request, reply) => {
      const manifest = await loadManifest(artifactsDirectory);
      const artifact = findArtifact(manifest, request.params.fileName);
      if (!artifact) {
        throw new AppError(
          404,
          "CLI_ARTIFACT_NOT_FOUND",
          "The requested AgentRoom CLI artifact does not exist",
        );
      }
      const path = resolve(artifactsDirectory, artifact.name);
      const content = await readArtifact(path, artifact);
      return reply
        .type(artifact.mediaType)
        .header("x-content-type-options", "nosniff")
        .header(
          "content-disposition",
          `attachment; filename=${JSON.stringify(artifact.name)}`,
        )
        .header(
          "cache-control",
          artifact.name.startsWith("agentroom-v")
            ? "public, max-age=31536000, immutable"
            : "no-cache, no-store, must-revalidate",
        )
        .send(content);
    },
  );
}

async function loadManifest(
  artifactsDirectory: string,
): Promise<CliReleaseManifest> {
  try {
    const value: unknown = JSON.parse(
      await readFile(resolve(artifactsDirectory, "manifest.json"), "utf8"),
    );
    if (!isManifest(value)) {
      throw new Error("invalid manifest structure");
    }
    return value;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError(
      503,
      "CLI_RELEASE_UNAVAILABLE",
      "The AgentRoom CLI release is temporarily unavailable",
    );
  }
}

function findArtifact(
  manifest: CliReleaseManifest,
  fileName: string,
): CliReleaseArtifact | undefined {
  return Object.values(manifest.files).find(
    (artifact) => artifact.name === fileName,
  );
}

async function readArtifact(
  path: string,
  artifact: CliReleaseArtifact,
): Promise<Buffer> {
  try {
    const content = await readFile(path);
    const sha256 = createHash("sha256").update(content).digest("hex");
    if (content.length !== artifact.size || sha256 !== artifact.sha256) {
      throw new Error("artifact metadata mismatch");
    }
    return content;
  } catch {
    throw new AppError(
      503,
      "CLI_RELEASE_UNAVAILABLE",
      "The AgentRoom CLI release is temporarily unavailable",
    );
  }
}

function isManifest(value: unknown): value is CliReleaseManifest {
  if (!isObject(value) || value.schemaVersion !== 1) {
    return false;
  }
  if (
    typeof value.version !== "string" ||
    value.minimumNodeVersion !== "22.0.0" ||
    !Array.isArray(value.providers) ||
    value.providers.length !== 2 ||
    value.providers[0] !== "claude" ||
    value.providers[1] !== "codex" ||
    !isObject(value.files)
  ) {
    return false;
  }
  return (
    isArtifact(value.files.bundle) &&
    isArtifact(value.files.macosLinuxInstaller) &&
    isArtifact(value.files.windowsInstaller)
  );
}

function isArtifact(value: unknown): value is CliReleaseArtifact {
  return (
    isObject(value) &&
    typeof value.name === "string" &&
    /^[a-zA-Z0-9._-]+$/.test(value.name) &&
    typeof value.mediaType === "string" &&
    ["text/javascript", "text/x-shellscript", "text/plain"].includes(
      value.mediaType,
    ) &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.size === "number" &&
    Number.isSafeInteger(value.size) &&
    value.size > 0
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
