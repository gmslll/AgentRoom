import type { KeyValueStore } from "../../lib/redis.js";
import type { MemberPresenceSnapshot } from "../rooms/types.js";

export interface PresenceService {
  markOnline(roomId: string, memberId: string): Promise<void>;
  markOffline(roomId: string, memberId: string): Promise<void>;
  list(
    roomId: string,
    memberIds: string[],
  ): Promise<MemberPresenceSnapshot[]>;
  isOnline(roomId: string, memberId: string): Promise<boolean>;
}

function presenceKey(roomId: string, memberId: string): string {
  return `agentroom:presence:${roomId}:${memberId}`;
}

/**
 * Presence tracked as expiring keys, so a crashed process or dropped socket
 * clears itself within the TTL. WebSocket connections refresh the key on every
 * client ping; closing the connection removes it immediately.
 */
export class KeyValuePresenceService implements PresenceService {
  constructor(
    private readonly store: KeyValueStore,
    private readonly ttlMs = 90_000,
  ) {}

  async markOnline(roomId: string, memberId: string): Promise<void> {
    await this.store.set(
      presenceKey(roomId, memberId),
      new Date().toISOString(),
      this.ttlMs,
    );
  }

  async markOffline(roomId: string, memberId: string): Promise<void> {
    await this.store.del(presenceKey(roomId, memberId));
  }

  async list(
    roomId: string,
    memberIds: string[],
  ): Promise<MemberPresenceSnapshot[]> {
    const snapshots: MemberPresenceSnapshot[] = [];
    for (const memberId of memberIds) {
      const lastSeenAt = await this.store.get(presenceKey(roomId, memberId));
      snapshots.push({
        memberId,
        online: lastSeenAt !== undefined,
        lastSeenAt: lastSeenAt ?? null,
      });
    }
    return snapshots;
  }

  async isOnline(roomId: string, memberId: string): Promise<boolean> {
    return (await this.store.get(presenceKey(roomId, memberId))) !== undefined;
  }
}
