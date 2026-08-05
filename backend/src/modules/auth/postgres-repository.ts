import { Pool, type PoolClient, type QueryResultRow } from "pg";
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
import type { UserAccount } from "./types.js";

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: Date;
  email_verified_at: Date | null;
}

export class PostgresAuthRepository implements AuthRepository {
  readonly #pool: Pool;

  constructor(connectionString: string) {
    this.#pool = new Pool({
      connectionString,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
      query_timeout: 20_000,
    });
    this.#pool.on("error", (error) => {
      console.error("Unexpected idle PostgreSQL auth client error:", error);
    });
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }

  async healthCheck(): Promise<void> {
    const result = await this.#pool.query<{ users_table: string | null }>(
      "SELECT to_regclass('public.users')::text AS users_table",
    );
    if (!result.rows[0]?.users_table) {
      throw new Error("PostgreSQL account migrations have not been applied");
    }
  }

  async createUser(record: CreateUserRecord): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO users
           (id, email, email_normalized, display_name, password_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          record.user.id,
          record.user.email,
          normalizeEmail(record.user.email),
          record.user.displayName,
          record.passwordHash,
          record.user.createdAt,
        ],
      );
      await this.#insertSession(client, {
        session: record.session,
        tokenHash: record.sessionTokenHash,
      });
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      if (isUniqueViolation(error, "users_email_normalized_key")) {
        throw new AppError(
          409,
          "EMAIL_ALREADY_REGISTERED",
          "An account with this email already exists",
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async findCredentialByNormalizedEmail(
    normalizedEmail: string,
  ): Promise<UserCredential | undefined> {
    const result = await this.#pool.query<UserRow>(
      `${userSelect} WHERE email_normalized = $1`,
      [normalizedEmail],
    );
    return result.rows[0] ? mapCredential(result.rows[0]) : undefined;
  }

  async createSession(record: CreateSessionRecord): Promise<void> {
    await this.#insertSession(this.#pool, record);
  }

  async findUserBySessionTokenHash(
    tokenHash: string,
    now: string,
  ): Promise<UserAccount | undefined> {
    const result = await this.#pool.query<UserRow>(
      `${userSelect}
       JOIN user_sessions s ON s.user_id = u.id
       WHERE s.token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > $2`,
      [tokenHash, now],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : undefined;
  }

  async revokeSession(tokenHash: string, revokedAt: string): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE user_sessions
       SET revoked_at = $1
       WHERE token_hash = $2 AND revoked_at IS NULL`,
      [revokedAt, tokenHash],
    );
    return result.rowCount === 1;
  }

  async markEmailVerified(userId: string, verifiedAt: string): Promise<void> {
    await this.#pool.query(
      "UPDATE users SET email_verified_at = $1 WHERE id = $2",
      [verifiedAt, userId],
    );
  }

  async updatePassword(
    userId: string,
    newPasswordHash: string,
  ): Promise<void> {
    await this.#pool.query(
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [newPasswordHash, userId],
    );
  }

  async revokeAllSessionsExcept(
    userId: string,
    exceptTokenHash: string | null,
    revokedAt: string,
  ): Promise<void> {
    if (exceptTokenHash === null) {
      await this.#pool.query(
        `UPDATE user_sessions
         SET revoked_at = $1
         WHERE user_id = $2 AND revoked_at IS NULL`,
        [revokedAt, userId],
      );
      return;
    }
    await this.#pool.query(
      `UPDATE user_sessions
       SET revoked_at = $1
       WHERE user_id = $2 AND token_hash <> $3 AND revoked_at IS NULL`,
      [revokedAt, userId, exceptTokenHash],
    );
  }

  async createEmailCode(record: EmailCodeRecord): Promise<void> {
    await this.#pool.query(
      `INSERT INTO email_codes
         (id, user_id, purpose, code_hash, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        record.id,
        record.userId,
        record.purpose,
        record.codeHash,
        record.expiresAt,
        record.createdAt,
      ],
    );
  }

  async findValidEmailCode(
    userId: string,
    purpose: EmailCodePurpose,
    codeHash: string,
    now: string,
  ): Promise<EmailCodeRecord | undefined> {
    const result = await this.#pool.query<{
      id: string;
      user_id: string;
      purpose: string;
      code_hash: string;
      expires_at: Date;
      created_at: Date;
    }>(
      `SELECT id, user_id, purpose, code_hash, expires_at, created_at
       FROM email_codes
       WHERE user_id = $1
         AND purpose = $2
         AND code_hash = $3
         AND consumed_at IS NULL
         AND failed_attempts < $4
         AND expires_at > $5
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, purpose, codeHash, emailCodeMaxAttempts, now],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          purpose: row.purpose as EmailCodePurpose,
          codeHash: row.code_hash,
          expiresAt: row.expires_at.toISOString(),
          createdAt: row.created_at.toISOString(),
        }
      : undefined;
  }

  async findLatestEmailCode(
    userId: string,
    purpose: EmailCodePurpose,
  ): Promise<EmailCodeRecord | undefined> {
    const result = await this.#pool.query<{
      id: string;
      user_id: string;
      purpose: string;
      code_hash: string;
      expires_at: Date;
      created_at: Date;
    }>(
      `SELECT id, user_id, purpose, code_hash, expires_at, created_at
       FROM email_codes
       WHERE user_id = $1 AND purpose = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, purpose],
    );
    const row = result.rows[0];
    return row
      ? {
          id: row.id,
          userId: row.user_id,
          purpose: row.purpose as EmailCodePurpose,
          codeHash: row.code_hash,
          expiresAt: row.expires_at.toISOString(),
          createdAt: row.created_at.toISOString(),
        }
      : undefined;
  }

  async incrementEmailCodeFailures(id: string): Promise<number> {
    const result = await this.#pool.query<{ failed_attempts: string }>(
      `UPDATE email_codes
       SET failed_attempts = failed_attempts + 1
       WHERE id = $1
       RETURNING failed_attempts`,
      [id],
    );
    return Number(result.rows[0]?.failed_attempts ?? 0);
  }

  async consumeEmailCode(id: string, consumedAt: string): Promise<boolean> {
    const result = await this.#pool.query(
      `UPDATE email_codes
       SET consumed_at = $1
       WHERE id = $2 AND consumed_at IS NULL`,
      [consumedAt, id],
    );
    return result.rowCount === 1;
  }

  async linkOAuthAccount(
    provider: "google" | "github",
    providerUserId: string,
    userId: string,
    createdAt: string,
  ): Promise<void> {
    try {
      await this.#pool.query(
        `INSERT INTO oauth_accounts (provider, provider_user_id, user_id, created_at)
         VALUES ($1, $2, $3, $4)`,
        [provider, providerUserId, userId, createdAt],
      );
    } catch (error) {
      if (
        isUniqueViolation(error, "oauth_accounts_pkey") ||
        isUniqueViolation(error, "oauth_accounts_user_idx")
      ) {
        throw new AppError(
          409,
          "OAUTH_ACCOUNT_LINKED",
          "This provider identity is already linked to another account",
        );
      }
      throw error;
    }
  }

  async findUserByOAuth(
    provider: "google" | "github",
    providerUserId: string,
  ): Promise<UserAccount | undefined> {
    const result = await this.#pool.query<UserRow>(
      `${userSelect}
       JOIN oauth_accounts o ON o.user_id = u.id
       WHERE o.provider = $1 AND o.provider_user_id = $2`,
      [provider, providerUserId],
    );
    return result.rows[0] ? mapUser(result.rows[0]) : undefined;
  }

  async #insertSession(
    client: Pick<Pool, "query"> | Pick<PoolClient, "query">,
    record: CreateSessionRecord,
  ): Promise<void> {
    await client.query(
      `INSERT INTO user_sessions
         (id, user_id, token_hash, created_at, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        record.session.id,
        record.session.userId,
        record.tokenHash,
        record.session.createdAt,
        record.session.expiresAt,
      ],
    );
  }
}

const userSelect = `
  SELECT u.id, u.email, u.display_name, u.password_hash, u.created_at,
         u.email_verified_at
  FROM users u
`;

function mapUser(row: UserRow): UserAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
    emailVerifiedAt: row.email_verified_at?.toISOString() ?? null,
  };
}

function mapCredential(row: UserRow): UserCredential {
  return { ...mapUser(row), passwordHash: row.password_hash };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === constraint
  );
}
