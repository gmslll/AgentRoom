import WebSocket from "ws";
import { createHash } from "node:crypto";
import type {
  AgentClaim,
  AgentDelivery,
  PendingAgentDelivery,
  RealtimeServerEvent,
  RoomMessage,
} from "../protocol/rooms.js";
import type { AgentRoomClientConfig } from "./config.js";

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export type AgentRoomConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "revoked"
  | "stopped";

export interface AgentRoomConnectionUpdate {
  state: AgentRoomConnectionState;
  error?: unknown;
}

export interface AgentRoomAttachment {
  id: string;
  roomId: string;
  uploaderMemberId: string;
  name: string;
  mediaType: string;
  size: number;
  sha256: string;
  scanState: "pending" | "clean" | "flagged";
  createdAt: string;
}

export interface DownloadedAttachment {
  attachment: AgentRoomAttachment;
  bytes: Uint8Array;
}

class AgentRoomApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "AgentRoomApiError";
  }
}

export class AgentRoomClient {
  constructor(private readonly config: AgentRoomClientConfig) {}

  async listPendingDeliveries(): Promise<PendingAgentDelivery[]> {
    const body = await this.request<{ items: PendingAgentDelivery[] }>(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/deliveries/pending`,
    );
    return body.items;
  }

  async listMessages(
    afterSequence = 0,
    limit = 50,
  ): Promise<{ items: RoomMessage[]; nextAfterSequence: number }> {
    const query = new URLSearchParams({
      afterSequence: String(afterSequence),
      limit: String(limit),
    });
    return this.request(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/messages?${query}`,
    );
  }

  async sendTextMessage(
    text: string,
    attachmentIds: string[] = [],
  ): Promise<RoomMessage> {
    const body = await this.request<{ message: RoomMessage }>(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({ kind: "text", text, attachmentIds }),
      },
    );
    return body.message;
  }

  async sendAgentTask(
    text: string,
    targetMemberIds: string[],
    idempotencyKey: string,
    attachmentIds: string[] = [],
  ): Promise<{ message: RoomMessage; deliveries: AgentDelivery[] }> {
    return this.request(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          kind: "agent.task",
          text,
          targetMemberIds,
          idempotencyKey,
          attachmentIds,
        }),
      },
    );
  }

  async issueAgentClaimCode(agentMemberId: string): Promise<AgentClaim> {
    const body = await this.request<{ agentClaim: AgentClaim }>(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/agents/${encodeURIComponent(agentMemberId)}/claim-code`,
      { method: "POST" },
    );
    return body.agentClaim;
  }

  async updateDelivery(
    deliveryId: string,
    status: "received" | "running" | "failed",
    error?: string,
  ): Promise<AgentDelivery> {
    const body = await this.request<{ delivery: AgentDelivery }>(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/deliveries/${encodeURIComponent(deliveryId)}/status`,
      {
        method: "POST",
        body: JSON.stringify(
          status === "failed" ? { status, error } : { status },
        ),
      },
    );
    return body.delivery;
  }

  async replyToDelivery(
    deliveryId: string,
    text: string,
    attachmentIds: string[] = [],
  ): Promise<{ delivery: AgentDelivery; message: RoomMessage }> {
    return this.request(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/deliveries/${encodeURIComponent(deliveryId)}/reply`,
      {
        method: "POST",
        body: JSON.stringify({ text, attachmentIds }),
      },
    );
  }

  async listAttachments(): Promise<AgentRoomAttachment[]> {
    const body = await this.request<{ items: AgentRoomAttachment[] }>(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/attachments`,
    );
    return body.items;
  }

  async getAttachment(
    attachmentId: string,
  ): Promise<{ attachment: AgentRoomAttachment; downloadUrl: string }> {
    return this.request(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
  }

  async uploadAttachment(input: {
    name: string;
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<AgentRoomAttachment> {
    const sha256 = createHash("sha256").update(input.bytes).digest("hex");
    const intent = await this.request<{
      fileId: string;
      presignedUrl: string;
      expiresAt: string;
    }>(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/files/upload-intents`,
      {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          mediaType: input.mediaType,
          size: input.bytes.byteLength,
          sha256,
        }),
      },
    );
    const uploadUrl = validatedTransferUrl(intent.presignedUrl, "upload");
    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": input.mediaType,
        "content-length": String(input.bytes.byteLength),
        "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString(
          "base64",
        ),
      },
      body: Buffer.from(input.bytes),
      signal: AbortSignal.timeout(attachmentTransferTimeout(this.config)),
    });
    if (!response.ok) {
      throw new Error(
        `Attachment upload failed with HTTP ${response.status} ${response.statusText}`,
      );
    }
    const completed = await this.request<{
      attachment: AgentRoomAttachment;
      downloadUrl: string;
    }>(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/files/${encodeURIComponent(intent.fileId)}/complete`,
      { method: "POST" },
    );
    return completed.attachment;
  }

  async downloadAttachment(
    attachmentId: string,
    maximumBytes = 104_857_600,
  ): Promise<DownloadedAttachment> {
    const result = await this.getAttachment(attachmentId);
    if (result.attachment.size > maximumBytes) {
      throw new Error(
        `Attachment ${attachmentId} is ${result.attachment.size} bytes; the local limit is ${maximumBytes}`,
      );
    }
    const downloadUrl = validatedTransferUrl(result.downloadUrl, "download");
    const response = await fetch(downloadUrl, {
      signal: AbortSignal.timeout(attachmentTransferTimeout(this.config)),
    });
    if (!response.ok) {
      throw new Error(
        `Attachment download failed with HTTP ${response.status} ${response.statusText}`,
      );
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) > maximumBytes) {
      throw new Error(`Attachment ${attachmentId} exceeds the local size limit`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== result.attachment.size) {
      throw new Error(`Attachment ${attachmentId} size verification failed`);
    }
    if (result.attachment.sha256) {
      const actual = createHash("sha256").update(bytes).digest("hex");
      if (actual !== result.attachment.sha256) {
        throw new Error(`Attachment ${attachmentId} checksum verification failed`);
      }
    }
    return { attachment: result.attachment, bytes };
  }

  async listen(
    onEvent: (event: RealtimeServerEvent) => void | Promise<void>,
    signal?: AbortSignal,
    onConnected?: () => void | Promise<void>,
    onConnectionUpdate?: (
      update: AgentRoomConnectionUpdate,
    ) => void | Promise<void>,
  ): Promise<void> {
    let retryMs = 500;
    let firstAttempt = true;

    while (!signal?.aborted) {
      await emitConnectionUpdate(onConnectionUpdate, {
        state: firstAttempt ? "connecting" : "reconnecting",
      });
      firstAttempt = false;
      try {
        await this.openSocket(onEvent, signal, async () => {
          await emitConnectionUpdate(onConnectionUpdate, {
            state: "connected",
          });
          await onConnected?.();
        });
        retryMs = 500;
        if (!signal?.aborted) {
          await emitConnectionUpdate(onConnectionUpdate, {
            state: "reconnecting",
          });
        }
      } catch (error) {
        if (!signal?.aborted) {
          console.error("AgentRoom realtime connection failed:", error);
        }
        if (isTerminalMembershipError(error)) {
          await emitConnectionUpdate(onConnectionUpdate, {
            state: "revoked",
            error,
          });
          console.error(
            "AgentRoom membership is no longer active; receiver will stay stopped until the provider exits.",
          );
          await waitForAbort(signal);
          break;
        }
        await emitConnectionUpdate(onConnectionUpdate, {
          state: "reconnecting",
          error,
        });
      }

      if (signal?.aborted) {
        break;
      }
      await abortableDelay(retryMs, signal);
      retryMs = Math.min(retryMs * 2, 15_000);
    }
    await emitConnectionUpdate(onConnectionUpdate, { state: "stopped" });
  }

  private async openSocket(
    onEvent: (event: RealtimeServerEvent) => void | Promise<void>,
    signal?: AbortSignal,
    onConnected?: () => void | Promise<void>,
  ): Promise<void> {
    const { ticket } = await this.request<{ ticket: string; expiresAt: string }>(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/realtime-tickets`,
      { method: "POST" },
    );
    const url = realtimeWebSocketUrl(this.config.baseUrl, ticket);

    await new Promise<void>((resolvePromise, reject) => {
      const socket = new WebSocket(url);
      let settled = false;
      let eventChain = Promise.resolve();
      let heartbeatTimer: NodeJS.Timeout | undefined;
      const finish = (error?: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(connectTimer);
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }
        signal?.removeEventListener("abort", onAbort);
        if (error) {
          reject(error);
        } else {
          resolvePromise();
        }
      };
      const onAbort = () => {
        socket.terminate();
        finish();
      };
      const connectTimer = setTimeout(() => {
        socket.terminate();
        finish(new Error("AgentRoom WebSocket connection timed out"));
      }, this.config.socketConnectTimeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });

      socket.once("open", () => {
        clearTimeout(connectTimer);
        heartbeatTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "ping" }));
          }
        }, 25_000);
        void Promise.resolve(onConnected?.()).catch((error: unknown) => {
          console.error("AgentRoom reconnect recovery failed:", error);
          socket.close(1011, "Recovery failed");
        });
      });
      socket.on("message", (data) => {
        try {
          const value: unknown = JSON.parse(data.toString());
          if (isPong(value)) {
            return;
          }
          if (!isRealtimeServerEvent(value)) {
            throw new Error("Server event is missing its required envelope");
          }
          const event = value;
          eventChain = eventChain
            .then(() => onEvent(event))
            .catch((error: unknown) => {
              console.error("AgentRoom event handler failed:", error);
              socket.close(1011, "Event handling failed");
            });
        } catch (error) {
          console.error("Ignoring invalid AgentRoom realtime event:", error);
          socket.close(1007, "Invalid server event");
        }
      });
      socket.once("close", () => finish());
      socket.once("error", (error) => {
        finish(error);
      });
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const timeoutSignal = AbortSignal.timeout(this.config.httpTimeoutMs);
    const signal = init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      signal,
      headers: agentRoomRequestHeaders(this.config.accessToken, init),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
      throw new AgentRoomApiError(
        response.status,
        body.error?.code ?? `HTTP_${response.status}`,
        body.error?.message ?? response.statusText,
      );
    }

    return (await response.json()) as T;
  }
}

function isTerminalMembershipError(error: unknown): boolean {
  return (
    error instanceof AgentRoomApiError &&
    (error.code === "ROOM_NOT_FOUND" ||
      error.code === "INVALID_TOKEN" ||
      error.code === "AUTH_REQUIRED")
  );
}

function validatedTransferUrl(value: string, operation: string): URL {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Attachment ${operation} URL must use HTTP or HTTPS`);
  }
  return url;
}

function attachmentTransferTimeout(config: AgentRoomClientConfig): number {
  return Math.max(config.httpTimeoutMs, 5 * 60_000);
}

async function waitForAbort(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return;
  }
  await new Promise<void>((resolvePromise) => {
    signal?.addEventListener("abort", () => resolvePromise(), { once: true });
  });
}

async function emitConnectionUpdate(
  listener: ((update: AgentRoomConnectionUpdate) => void | Promise<void>) | undefined,
  update: AgentRoomConnectionUpdate,
): Promise<void> {
  try {
    await listener?.(update);
  } catch (error) {
    console.error("Could not record AgentRoom receiver status:", error);
  }
}

export function agentRoomRequestHeaders(
  accessToken: string,
  init: Pick<RequestInit, "body" | "headers"> = {},
): Headers {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${accessToken}`);
  if (
    init.body !== undefined &&
    init.body !== null &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

export function realtimeWebSocketUrl(
  baseUrl: string,
  ticket: string,
): URL {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/v1/realtime`;
  url.search = new URLSearchParams({ ticket }).toString();
  return url;
}

function isPong(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "pong"
  );
}

function isRealtimeServerEvent(value: unknown): value is RealtimeServerEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    "version" in value &&
    value.version === 1 &&
    "eventId" in value &&
    typeof value.eventId === "string" &&
    "type" in value &&
    typeof value.type === "string" &&
    "roomId" in value &&
    typeof value.roomId === "string" &&
    "occurredAt" in value &&
    typeof value.occurredAt === "string" &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null
  );
}

async function abortableDelay(
  durationMs: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) {
    return;
  }
  await new Promise<void>((resolvePromise) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolvePromise();
    };
    const onAbort = () => finish();
    const timer = setTimeout(finish, durationMs);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
