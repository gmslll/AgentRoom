import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { AppError } from "../../lib/errors.js";
import type {
  AuthRepository,
  CreateSessionRecord,
  CreateUserRecord,
  UserCredential,
} from "./repository.js";
import type { UserAccount } from "./types.js";

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  display_name: string;
  password_hash: string;
  created_at: Date;
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
  SELECT u.id, u.email, u.display_name, u.password_hash, u.created_at
  FROM users u
`;

function mapUser(row: UserRow): UserAccount {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
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
