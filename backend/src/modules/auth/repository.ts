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

export type EmailCodePurpose = "email_verify" | "password_reset";

/** A single code is invalidated after this many failed verification attempts. */
export const emailCodeMaxAttempts = 10;

export interface EmailCodeRecord {
  id: string;
  userId: string;
  purpose: EmailCodePurpose;
  codeHash: string;
  expiresAt: string;
  createdAt: string;
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
  markEmailVerified(userId: string, verifiedAt: string): Promise<void>;
  updatePassword(userId: string, newPasswordHash: string): Promise<void>;
  revokeAllSessionsExcept(
    userId: string,
    exceptTokenHash: string | null,
    revokedAt: string,
  ): Promise<void>;
  createEmailCode(record: EmailCodeRecord): Promise<void>;
  findValidEmailCode(
    userId: string,
    purpose: EmailCodePurpose,
    codeHash: string,
    now: string,
  ): Promise<EmailCodeRecord | undefined>;
  /** Locates the most recent code for this user/purpose, regardless of hash, to count failures against it. */
  findLatestEmailCode(
    userId: string,
    purpose: EmailCodePurpose,
  ): Promise<EmailCodeRecord | undefined>;
  /** Increments the failed-attempt counter; returns the new count. */
  incrementEmailCodeFailures(id: string): Promise<number>;
  consumeEmailCode(id: string, consumedAt: string): Promise<boolean>;
  linkOAuthAccount(
    provider: "google" | "github",
    providerUserId: string,
    userId: string,
    createdAt: string,
  ): Promise<void>;
  findUserByOAuth(
    provider: "google" | "github",
    providerUserId: string,
  ): Promise<UserAccount | undefined>;
}
