import WebSocket from "ws";
import type {
  AgentDelivery,
  PendingAgentDelivery,
  RealtimeServerEvent,
  RoomMessage,
} from "../protocol/rooms.js";
import type { AgentRoomBridgeConfig } from "./config.js";

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export class AgentRoomClient {
  constructor(private readonly config: AgentRoomBridgeConfig) {}

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
  ): Promise<{ delivery: AgentDelivery; message: RoomMessage }> {
    return this.request(
      `/v1/rooms/${encodeURIComponent(this.config.roomId)}/deliveries/${encodeURIComponent(deliveryId)}/reply`,
      { method: "POST", body: JSON.stringify({ text }) },
    );
  }

  async listen(
    onEvent: (event: RealtimeServerEvent) => void | Promise<void>,
    signal?: AbortSignal,
    onConnected?: () => void | Promise<void>,
  ): Promise<void> {
    let retryMs = 500;

    while (!signal?.aborted) {
      try {
        await this.openSocket(onEvent, signal, onConnected);
        retryMs = 500;
      } catch (error) {
        if (!signal?.aborted) {
          console.error("AgentRoom realtime connection failed:", error);
        }
      }

      if (signal?.aborted) {
        break;
      }
      await abortableDelay(retryMs, signal);
      retryMs = Math.min(retryMs * 2, 15_000);
    }
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
    const url = new URL(this.config.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/v1/realtime";
    url.search = new URLSearchParams({ ticket }).toString();

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
      headers: {
        authorization: `Bearer ${this.config.accessToken}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
      throw new Error(
        `${body.error?.code ?? `HTTP_${response.status}`}: ${body.error?.message ?? response.statusText}`,
      );
    }

    return (await response.json()) as T;
  }
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
