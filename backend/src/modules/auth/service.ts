import { AppError } from "../../lib/errors.js";
import { createId, createSecret, hashSecret } from "../../lib/secrets.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { AuthRepository } from "./repository.js";
import type { AccountAccess, UserAccount, UserSession } from "./types.js";

const invalidCredentials = () =>
  new AppError(401, "INVALID_CREDENTIALS", "The email or password is invalid");

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly sessionTtlMs = 30 * 24 * 60 * 60 * 1_000,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async register(input: {
    email: string;
    displayName: string;
    password: string;
  }): Promise<AccountAccess> {
    const createdAt = this.now().toISOString();
    const user: UserAccount = {
      id: createId("usr"),
      email: normalizeEmail(input.email),
      displayName: input.displayName.trim(),
      createdAt,
    };
    const passwordHash = await hashPassword(input.password);
    const issued = this.issueSession(user.id, createdAt);
    await this.repository.createUser({
      user,
      passwordHash,
      session: issued.session,
      sessionTokenHash: hashSecret(issued.accessToken),
    });
    return {
      user,
      accessToken: issued.accessToken,
      expiresAt: issued.session.expiresAt,
    };
  }

  async login(input: { email: string; password: string }): Promise<AccountAccess> {
    const credential = await this.repository.findCredentialByNormalizedEmail(
      normalizeEmail(input.email),
    );
    if (!credential) {
      await hashPassword(input.password);
      throw invalidCredentials();
    }
    if (!(await verifyPassword(input.password, credential.passwordHash))) {
      throw invalidCredentials();
    }

    const createdAt = this.now().toISOString();
    const issued = this.issueSession(credential.id, createdAt);
    await this.repository.createSession({
      session: issued.session,
      tokenHash: hashSecret(issued.accessToken),
    });
    const { passwordHash: _passwordHash, ...user } = credential;
    return {
      user,
      accessToken: issued.accessToken,
      expiresAt: issued.session.expiresAt,
    };
  }

  async authenticate(accessToken: string): Promise<UserAccount> {
    if (!accessToken.startsWith("ars_")) {
      throw new AppError(401, "INVALID_SESSION", "The account session is invalid");
    }
    const user = await this.repository.findUserBySessionTokenHash(
      hashSecret(accessToken),
      this.now().toISOString(),
    );
    if (!user) {
      throw new AppError(401, "INVALID_SESSION", "The account session is invalid");
    }
    return user;
  }

  async logout(accessToken: string): Promise<void> {
    await this.authenticate(accessToken);
    await this.repository.revokeSession(
      hashSecret(accessToken),
      this.now().toISOString(),
    );
  }

  private issueSession(
    userId: string,
    createdAt: string,
  ): { session: UserSession; accessToken: string } {
    return {
      accessToken: createSecret("ars"),
      session: {
        id: createId("ses"),
        userId,
        createdAt,
        expiresAt: new Date(
          new Date(createdAt).getTime() + this.sessionTtlMs,
        ).toISOString(),
      },
    };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
