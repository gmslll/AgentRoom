import type { UserAccount, UserSession } from "./types.js";

export interface UserCredential extends UserAccount {
  passwordHash: string;
}

export interface CreateUserRecord {
  user: UserAccount;
  passwordHash: string;
  session: UserSession;
  sessionTokenHash: string;
}

export interface CreateSessionRecord {
  session: UserSession;
  tokenHash: string;
}

export interface AuthRepository {
  close?(): Promise<void>;
  healthCheck?(): Promise<void>;
  createUser(record: CreateUserRecord): Promise<void>;
  findCredentialByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<UserCredential | undefined>;
  createSession(record: CreateSessionRecord): Promise<void>;
  findUserBySessionTokenHash(
    tokenHash: string,
    now: string,
  ): Promise<UserAccount | undefined>;
  revokeSession(tokenHash: string, revokedAt: string): Promise<boolean>;
}
