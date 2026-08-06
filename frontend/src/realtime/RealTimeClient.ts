import { apiUrl } from "../api/client";
import type {
  AgentDelivery,
  Member,
  MemberPresence,
  Message,
  Room,
  RealtimeEnvelope,
  RealtimeTicket,
} from "../api/types";

export interface RealTimeHandlers {
  /** `session.ready` received: safe to backfill history from the local watermark. */
  onSessionReady: () => void;
  onMemberJoined: (member: Member) => void;
  onMessageCreated: (message: Message) => void;
  onDeliveryUpdated: (delivery: AgentDelivery) => void;
  onMemberRemoved: (memberId: string) => void;
  onRoomUpdated?: (room: Room) => void;
  onRoomDissolved?: () => void;
  onMemberPresence?: (presence: MemberPresence) => void;
  /** Transport state for the room header; message writes still use HTTP. */
  onConnectionState?: (state: RealTimeConnectionState) => void;
}

export type RealTimeConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected";

/** Minimal WebSocket surface the client relies on (injectable in tests). */
export interface WebSocketLike {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  send(data: string): void;
  close(): void;
}

export interface RealTimeClientOptions {
  /** Fetches a fresh single-use ticket; called on every (re)connect. */
  getTicket: () => Promise<RealtimeTicket>;
  handlers: RealTimeHandlers;
  heartbeatMs?: number;
  initialReconnectDelayMs?: number;
  maxReconnectDelayMs?: number;
  /** Injectable for tests. */
  webSocketFactory?: (url: string) => WebSocketLike;
}

const DEFAULT_HEARTBEAT_MS = 25_000;
const DEFAULT_INITIAL_RECONNECT_MS = 1_000;
const DEFAULT_MAX_RECONNECT_MS = 30_000;

/**
 * Own WebSocket client for one room: ticket → connect → heartbeat → backoff
 * reconnect with a fresh ticket → event dispatch. Chat writes stay on HTTP;
 * the socket only delivers notifications.
 */
export class RealTimeClient {
  private readonly heartbeatMs: number;
  private readonly initialReconnectDelayMs: number;
  private readonly maxReconnectDelayMs: number;
  private ws: WebSocketLike | null = null;
  private closed = false;
  private reconnectDelayMs: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: RealTimeClientOptions) {
    this.heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.initialReconnectDelayMs =
      options.initialReconnectDelayMs ?? DEFAULT_INITIAL_RECONNECT_MS;
    this.maxReconnectDelayMs =
      options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_MS;
    this.reconnectDelayMs = this.initialReconnectDelayMs;
  }

  connect(): void {
    if (this.closed || this.ws) return;
    this.options.handlers.onConnectionState?.("connecting");
    void this.open();
  }

  disconnect(): void {
    this.closed = true;
    this.clearTimers();
    this.ws?.close();
    this.ws = null;
    this.options.handlers.onConnectionState?.("disconnected");
  }

  private async open(): Promise<void> {
    let ticket: string;
    try {
      const { ticket: value } = await this.options.getTicket();
      ticket = value;
    } catch {
      this.scheduleReconnect();
      return;
    }

    const url = this.buildUrl(ticket);
    const ws = this.options.webSocketFactory?.(url) ?? new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => this.handleOpen();
    ws.onmessage = (event) => this.handleMessage(event);
    ws.onclose = () => this.handleClose();
    ws.onerror = () => {
      // The close event always follows an error; reconnect is driven from there.
    };
  }

  private buildUrl(ticket: string): string {
    const url = new URL(apiUrl("/v1/realtime"), window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("ticket", ticket);
    return url.toString();
  }

  private handleOpen(): void {
    // A successful connection resets the backoff sequence.
    this.reconnectDelayMs = this.initialReconnectDelayMs;
    this.clearHeartbeat();
    this.options.handlers.onConnectionState?.("connected");
    this.heartbeatTimer = setInterval(() => {
      this.ws?.send(JSON.stringify({ type: "ping" }));
    }, this.heartbeatMs);
  }

  private handleMessage(event: MessageEvent): void {
    let envelope: RealtimeEnvelope;
    try {
      envelope = JSON.parse(String(event.data)) as RealtimeEnvelope;
    } catch {
      return;
    }
    const data = envelope.data as Record<string, unknown> | undefined;
    switch (envelope.type) {
      case "session.ready":
        this.options.handlers.onSessionReady();
        break;
      case "member.joined":
        this.options.handlers.onMemberJoined(data?.member as Member);
        break;
      case "message.created":
        this.options.handlers.onMessageCreated(data?.message as Message);
        break;
      case "delivery.updated":
        this.options.handlers.onDeliveryUpdated(
          data?.delivery as AgentDelivery,
        );
        break;
      case "member.removed":
        this.options.handlers.onMemberRemoved(data?.memberId as string);
        break;
      case "member.presence":
        this.options.handlers.onMemberPresence?.({
          memberId: String(data?.memberId),
          online: Boolean(data?.online),
          lastSeenAt:
            typeof data?.lastSeenAt === "string" ? data.lastSeenAt : null,
        });
        break;
      case "room.updated":
        this.options.handlers.onRoomUpdated?.(data?.room as Room);
        break;
      case "room.dissolved":
        this.options.handlers.onRoomDissolved?.();
        break;
      default:
        // Includes "pong" and "delivery.queued" (only sent to the target AI).
        break;
    }
  }

  private handleClose(): void {
    this.clearHeartbeat();
    this.ws = null;
    if (!this.closed) {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer !== null) return;
    this.options.handlers.onConnectionState?.("reconnecting");
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * 2,
      this.maxReconnectDelayMs,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearHeartbeat();
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
