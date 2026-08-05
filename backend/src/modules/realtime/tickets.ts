import { createSecret, hashSecret } from "../../lib/secrets.js";
import type { RoomMember } from "../rooms/types.js";

interface TicketRecord {
  member: RoomMember;
  expiresAtMs: number;
}

export interface IssuedTicket {
  ticket: string;
  expiresAt: string;
}

export class RealtimeTicketService {
  readonly #tickets = new Map<string, TicketRecord>();
  readonly #memberTickets = new Map<string, string>();

  constructor(
    private readonly ttlMs = 60_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  issue(member: RoomMember): IssuedTicket {
    this.#deleteExpired();
    const ticket = createSecret("arrt");
    const ticketHash = hashSecret(ticket);
    const expiresAtMs = this.now().getTime() + this.ttlMs;
    const previousTicketHash = this.#memberTickets.get(member.id);
    if (previousTicketHash) {
      this.#tickets.delete(previousTicketHash);
    }
    this.#tickets.set(ticketHash, { member, expiresAtMs });
    this.#memberTickets.set(member.id, ticketHash);
    return { ticket, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  consume(ticket: string): RoomMember | undefined {
    const ticketHash = hashSecret(ticket);
    const record = this.#tickets.get(ticketHash);
    this.#tickets.delete(ticketHash);
    if (record && this.#memberTickets.get(record.member.id) === ticketHash) {
      this.#memberTickets.delete(record.member.id);
    }

    if (!record || record.expiresAtMs <= this.now().getTime()) {
      return undefined;
    }

    return record.member;
  }

  #deleteExpired(): void {
    const nowMs = this.now().getTime();
    for (const [ticketHash, record] of this.#tickets) {
      if (record.expiresAtMs <= nowMs) {
        this.#tickets.delete(ticketHash);
        if (this.#memberTickets.get(record.member.id) === ticketHash) {
          this.#memberTickets.delete(record.member.id);
        }
      }
    }
  }
}
