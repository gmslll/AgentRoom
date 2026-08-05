import { AppError } from "../../lib/errors.js";
import type {
  AuthRepository,
  CreateSessionRecord,
  CreateUserRecord,
  EmailCodePurpose,
  EmailCodeRecord,
  UserCredential,
} from "./repository.js";
import { emailCodeMaxAttempts } from "./repository.js";
import type { UserAccount, UserSession } from "./types.js";

interface StoredSession extends UserSession {
  tokenHash: string;
  revokedAt: string | null;
}

interface StoredEmailCode extends EmailCodeRecord {
  consumedAt: string | null;
  failedAttempts: number;
}

export class InMemoryAuthRepository implements AuthRepository {
  readonly #users = new Map<string, UserCredential>();
  readonly #emailIndex = new Map<string, string>();
  readonly #sessions = new Map<string, StoredSession>();
  readonly #emailCodes = new Map<string, StoredEmailCode>();
  readonly #oauthIndex = new Map<string, string>();

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

  async markEmailVerified(userId: string, verifiedAt: string): Promise<void> {
    const credential = this.#users.get(userId);
    if (credential) {
      credential.emailVerifiedAt = verifiedAt;
    }
  }

  async updatePassword(
    userId: string,
    newPasswordHash: string,
  ): Promise<void> {
    const credential = this.#users.get(userId);
    if (!credential) {
      throw new AppError(404, "USER_NOT_FOUND", "Account not found");
    }
    credential.passwordHash = newPasswordHash;
  }

  async revokeAllSessionsExcept(
    userId: string,
    exceptTokenHash: string | null,
    revokedAt: string,
  ): Promise<void> {
    for (const session of this.#sessions.values()) {
      if (session.userId === userId && session.tokenHash !== exceptTokenHash) {
        session.revokedAt = revokedAt;
      }
    }
  }

  async createEmailCode(record: EmailCodeRecord): Promise<void> {
    this.#emailCodes.set(record.id, {
      ...record,
      consumedAt: null,
      failedAttempts: 0,
    });
  }

  async findValidEmailCode(
    userId: string,
    purpose: EmailCodePurpose,
    codeHash: string,
    now: string,
  ): Promise<EmailCodeRecord | undefined> {
    for (const code of this.#emailCodes.values()) {
      if (
        code.userId === userId &&
        code.purpose === purpose &&
        code.codeHash === codeHash &&
        code.consumedAt === null &&
        code.expiresAt > now &&
        code.failedAttempts < emailCodeMaxAttempts
      ) {
        return code;
      }
    }
    return undefined;
  }

  async findLatestEmailCode(
    userId: string,
    purpose: EmailCodePurpose,
  ): Promise<EmailCodeRecord | undefined> {
    let newest: StoredEmailCode | undefined;
    for (const code of this.#emailCodes.values()) {
      if (code.userId === userId && code.purpose === purpose) {
        if (!newest || code.createdAt > newest.createdAt) {
          newest = code;
        }
      }
    }
    return newest;
  }

  async incrementEmailCodeFailures(id: string): Promise<number> {
    const code = this.#emailCodes.get(id);
    if (!code) {
      return 0;
    }
    code.failedAttempts += 1;
    return code.failedAttempts;
  }

  async consumeEmailCode(id: string, consumedAt: string): Promise<boolean> {
    const code = this.#emailCodes.get(id);
    if (!code || code.consumedAt) {
      return false;
    }
    code.consumedAt = consumedAt;
    return true;
  }

  async linkOAuthAccount(
    provider: "google" | "github",
    providerUserId: string,
    userId: string,
    createdAt: string,
  ): Promise<void> {
    const key = oauthKey(provider, providerUserId);
    const existing = this.#oauthIndex.get(key);
    if (existing && existing !== userId) {
      throw new AppError(
        409,
        "OAUTH_ACCOUNT_LINKED",
        "This provider identity is already linked to another account",
      );
    }
    this.#oauthIndex.set(key, userId);
    void createdAt;
  }

  async findUserByOAuth(
    provider: "google" | "github",
    providerUserId: string,
  ): Promise<UserAccount | undefined> {
    const userId = this.#oauthIndex.get(oauthKey(provider, providerUserId));
    if (!userId) {
      return undefined;
    }
    const credential = this.#users.get(userId);
    return credential ? publicUser(credential) : undefined;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function oauthKey(provider: string, providerUserId: string): string {
  return `${provider}:${providerUserId}`;
}

function publicUser(credential: UserCredential): UserAccount {
  const { passwordHash: _passwordHash, ...user } = credential;
  return user;
}
