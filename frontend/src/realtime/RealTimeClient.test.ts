import { describe, expect, it, vi } from "vitest";
import type { AgentDelivery, Member, Message, Room } from "../api/types";
import { RealTimeClient } from "./RealTimeClient";

/** Minimal fake WebSocket controllable from the test. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.onclose?.();
  }

  open(): void {
    this.onopen?.();
  }

  emit(data: unknown): void {
    this.onmessage?.(
      new MessageEvent("message", { data: JSON.stringify(data) }),
    );
  }
}

const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const sampleMessage: Message = {
  id: "msg_1",
  roomId: "room_1",
  sequence: 1,
  kind: "text",
  text: "hi",
  attachmentIds: [],
  targetMemberIds: [],
  inReplyToMessageId: null,
  idempotencyKey: null,
  author: {
    memberId: "mem_1",
    displayName: "Alice",
    actorType: "human",
    agentProvider: null,
  },
  createdAt: "2026-08-05T00:00:00.000Z",
};

const sampleMember: Member = {
  id: "mem_2",
  roomId: "room_1",
  displayName: "Claude",
  actorType: "agent",
  agentProvider: "claude",
  role: "member",
  joinedAt: "2026-08-05T00:00:00.000Z",
};

const sampleDelivery: AgentDelivery = {
  id: "del_1",
  roomId: "room_1",
  taskMessageId: "msg_2",
  targetMemberId: "mem_2",
  status: "running",
  error: null,
  createdAt: "2026-08-05T00:00:00.000Z",
  updatedAt: "2026-08-05T00:00:00.000Z",
};

const sampleRoom: Room = {
  id: "room_1",
  name: "Public room",
  visibility: "public",
  createdAt: "2026-08-05T00:00:00.000Z",
};

function envelope(type: string, data: unknown) {
  return {
    version: 1,
    eventId: `evt_${Math.random()}`,
    type,
    roomId: "room_1",
    occurredAt: "2026-08-05T00:00:00.000Z",
    data,
  };
}

function makeClient(overrides: { heartbeatMs?: number } = {}) {
  const handlers = {
    onSessionReady: vi.fn(),
    onMemberJoined: vi.fn(),
    onMessageCreated: vi.fn(),
    onDeliveryUpdated: vi.fn(),
    onMemberRemoved: vi.fn(),
    onMemberPresence: vi.fn(),
    onRoomUpdated: vi.fn(),
    onRoomDissolved: vi.fn(),
  };
  const getTicket = vi.fn().mockResolvedValue({
    ticket: "arrt_1",
    expiresAt: "2026-08-05T00:01:00.000Z",
  });
  const client = new RealTimeClient({
    getTicket,
    handlers,
    heartbeatMs: overrides.heartbeatMs ?? 1_000_000,
    initialReconnectDelayMs: 5,
    maxReconnectDelayMs: 5,
    webSocketFactory: (url) => new FakeWebSocket(url),
  });
  return { client, handlers, getTicket };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
});

describe("RealTimeClient", () => {
  it("connects with a ticket from the API", async () => {
    const { client, getTicket } = makeClient();
    client.connect();
    await tick(10);
    expect(getTicket).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toContain("ticket=arrt_1");
    client.disconnect();
  });

  it("dispatches realtime events to the handlers", async () => {
    const { client, handlers } = makeClient();
    client.connect();
    await tick(10);
    const ws = FakeWebSocket.instances[0];

    ws.emit(envelope("session.ready", {}));
    expect(handlers.onSessionReady).toHaveBeenCalledTimes(1);

    ws.emit(envelope("message.created", { message: sampleMessage }));
    expect(handlers.onMessageCreated).toHaveBeenCalledWith(sampleMessage);

    ws.emit(envelope("member.joined", { member: sampleMember }));
    expect(handlers.onMemberJoined).toHaveBeenCalledWith(sampleMember);

    ws.emit(envelope("delivery.updated", { delivery: sampleDelivery }));
    expect(handlers.onDeliveryUpdated).toHaveBeenCalledWith(sampleDelivery);

    ws.emit(envelope("member.removed", { memberId: "mem_9" }));
    expect(handlers.onMemberRemoved).toHaveBeenCalledWith("mem_9");

    ws.emit(
      envelope("member.presence", {
        memberId: "mem_2",
        online: true,
        lastSeenAt: "2026-08-05T00:00:00.000Z",
      }),
    );
    expect(handlers.onMemberPresence).toHaveBeenCalledWith({
      memberId: "mem_2",
      online: true,
      lastSeenAt: "2026-08-05T00:00:00.000Z",
    });

    ws.emit(envelope("room.updated", { room: sampleRoom }));
    expect(handlers.onRoomUpdated).toHaveBeenCalledWith(sampleRoom);

    ws.emit(envelope("room.dissolved", { dissolvedByMemberId: "mem_1" }));
    expect(handlers.onRoomDissolved).toHaveBeenCalledTimes(1);

    // delivery.queued targets the AI only; the human client ignores it.
    ws.emit(envelope("delivery.queued", { delivery: sampleDelivery }));
    expect(handlers.onDeliveryUpdated).toHaveBeenCalledTimes(1);

    client.disconnect();
  });

  it("sends a heartbeat ping while connected", async () => {
    const { client } = makeClient({ heartbeatMs: 30 });
    client.connect();
    await tick(10);
    const ws = FakeWebSocket.instances[0];
    ws.open();
    await tick(80);
    expect(ws.sent).toContain(JSON.stringify({ type: "ping" }));
    client.disconnect();
  });

  it("reconnects with a fresh ticket after the socket closes", async () => {
    const { client, getTicket } = makeClient();
    client.connect();
    await tick(10);
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0].close();
    await tick(30);

    expect(getTicket).toHaveBeenCalledTimes(2);
    expect(FakeWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it("stops reconnecting after disconnect()", async () => {
    const { client, getTicket } = makeClient();
    client.connect();
    await tick(10);
    client.disconnect();

    FakeWebSocket.instances[0].close();
    await tick(30);

    expect(getTicket).toHaveBeenCalledTimes(1);
  });
});
