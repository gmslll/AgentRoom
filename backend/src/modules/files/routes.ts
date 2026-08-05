import { Type, type Static } from "@sinclair/typebox";
import type { FastifyInstance } from "fastify";
import { readBearerToken } from "../../lib/auth.js";
import type { FileService } from "./service.js";

const RoomParams = Type.Object(
  { roomId: Type.String({ minLength: 8, maxLength: 80 }) },
  { additionalProperties: false },
);

const FileParams = Type.Object(
  {
    roomId: Type.String({ minLength: 8, maxLength: 80 }),
    fileId: Type.String({ minLength: 8, maxLength: 80 }),
  },
  { additionalProperties: false },
);

const AttachmentParams = Type.Object(
  {
    roomId: Type.String({ minLength: 8, maxLength: 80 }),
    attachmentId: Type.String({ minLength: 8, maxLength: 80 }),
  },
  { additionalProperties: false },
);

const UploadIntentBody = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 255 }),
    mediaType: Type.String({
      minLength: 1,
      maxLength: 128,
      pattern: "^[\\w.+-]+/[\\w.+-]+$",
    }),
    size: Type.Integer({ minimum: 1, maximum: 100_000_000_000 }),
    sha256: Type.Optional(Type.String({ pattern: "^[a-f0-9]{64}$" })),
  },
  { additionalProperties: false },
);

export function registerFileRoutes(
  app: FastifyInstance,
  fileService: FileService,
): void {
  app.post<{
    Params: Static<typeof RoomParams>;
    Body: Static<typeof UploadIntentBody>;
  }>(
    "/v1/rooms/:roomId/files/upload-intents",
    { schema: { params: RoomParams, body: UploadIntentBody } },
    async (request, reply) =>
      reply.status(201).send(
        await fileService.createUploadIntent({
          roomId: request.params.roomId,
          accessToken: readBearerToken(request.headers.authorization),
          name: request.body.name,
          mediaType: request.body.mediaType,
          size: request.body.size,
          sha256: request.body.sha256,
        }),
      ),
  );

  app.post<{ Params: Static<typeof FileParams> }>(
    "/v1/rooms/:roomId/files/:fileId/complete",
    { schema: { params: FileParams } },
    async (request) =>
      fileService.completeUpload({
        roomId: request.params.roomId,
        fileId: request.params.fileId,
        accessToken: readBearerToken(request.headers.authorization),
      }),
  );

  app.get<{ Params: Static<typeof RoomParams> }>(
    "/v1/rooms/:roomId/attachments",
    { schema: { params: RoomParams } },
    async (request) => ({
      items: await fileService.listAttachments({
        roomId: request.params.roomId,
        accessToken: readBearerToken(request.headers.authorization),
      }),
    }),
  );

  app.get<{ Params: Static<typeof AttachmentParams> }>(
    "/v1/rooms/:roomId/attachments/:attachmentId",
    { schema: { params: AttachmentParams } },
    async (request) =>
      fileService.getAttachment({
        roomId: request.params.roomId,
        attachmentId: request.params.attachmentId,
        accessToken: readBearerToken(request.headers.authorization),
      }),
  );
}
