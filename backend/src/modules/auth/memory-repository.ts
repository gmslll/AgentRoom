import { AppError } from "../../lib/errors.js";
import type {
  AuthRepository,
  CreateSessionRecord,
  CreateUserRecord,
  UserCredential,
} from "./repository.js";
import type { UserAccount, UserSession } from "./types.js";

interface StoredSession extends UserSession {
  tokenHash: string;
  revokedAt: string | null;
}

export class InMemoryAuthRepository implements AuthRepository {
  readonly #users = new Map<string, UserCredential>();
  readonly #emailIndex = new Map<string, string>();
  readonly #sessions = new Map<string, StoredSession>();

  async createUser(record: CreateUserRecord): Promise<void> {
    const normalizedEmail = normalizeEmail(record.user.email);
    if (this.#emailIndex.has(normalizedEmail)) {
      throw new AppError(
        409,
        "EMAIL_ALREADY_REGISTERED",
        "An account with this email already exists",
      );
    }
    this.#users.set(record.user.id, {
      ...record.user,
      passwordHash: record.passwordHash,
    });
    this.#emailIndex.set(normalizedEmail, record.user.id);
    await this.createSession({
      session: record.session,
      tokenHash: record.sessionTokenHash,
    });
  }

  async findCredentialByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<UserCredential | undefined> {
    const userId = this.#emailIndex.get(normalizedEmail);
    return userId ? this.#users.get(userId) : undefined;
  }

  async createSession(record: CreateSessionRecord): Promise<void> {
    this.#sessions.set(record.tokenHash, {
      ...record.session,
      tokenHash: record.tokenHash,
      revokedAt: null,
    });
  }

  async findUserBySessionTokenHash(
    tokenHash: string,
    now: string,
  ): Promise<UserAccount | undefined> {
    const session = this.#sessions.get(tokenHash);
    if (!session || session.revokedAt || session.expiresAt <= now) {
      return undefined;
    }
    const credential = this.#users.get(session.userId);
    return credential ? publicUser(credential) : undefined;
  }

  async revokeSession(tokenHash: string, revokedAt: string): Promise<boolean> {
    const session = this.#sessions.get(tokenHash);
    if (!session || session.revokedAt) {
      return false;
    }
    session.revokedAt = revokedAt;
    return true;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function publicUser(credential: UserCredential): UserAccount {
  const { passwordHash: _passwordHash, ...user } = credential;
  return user;
}
