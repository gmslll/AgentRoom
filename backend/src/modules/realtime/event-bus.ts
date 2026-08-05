import type { RealtimeServerEvent } from "../rooms/types.js";

type RoomEventListener = (event: RealtimeServerEvent) => void;

interface Subscription {
  memberId: string;
  listener: RoomEventListener;
}

export interface EventBus {
  publish(event: RealtimeServerEvent, audienceMemberIds?: string[]): void;
  subscribe(
    roomId: string,
    memberId: string,
    listener: RoomEventListener,
  ): () => void;
}

export class InMemoryEventBus implements EventBus {
  readonly #listeners = new Map<string, Set<Subscription>>();

  constructor(
    private readonly onListenerError: (
      error: unknown,
      event: RealtimeServerEvent,
    ) => void = (error, event) => {
      console.error(`AgentRoom realtime listener failed for ${event.eventId}:`, error);
    },
  ) {}

  publish(event: RealtimeServerEvent, audienceMemberIds?: string[]): void {
    for (const subscription of this.#listeners.get(event.roomId) ?? []) {
      if (
        !audienceMemberIds ||
        audienceMemberIds.includes(subscription.memberId)
      ) {
        try {
          subscription.listener(event);
        } catch (error) {
          this.onListenerError(error, event);
        }
      }
    }
  }

  subscribe(
    roomId: string,
    memberId: string,
    listener: RoomEventListener,
  ): () => void {
    const listeners = this.#listeners.get(roomId) ?? new Set<Subscription>();
    const subscription = { memberId, listener };
    listeners.add(subscription);
    this.#listeners.set(roomId, listeners);

    return () => {
      listeners.delete(subscription);
      if (listeners.size === 0) {
        this.#listeners.delete(roomId);
      }
    };
  }
}
