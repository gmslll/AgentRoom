import { AppError } from "../../lib/errors.js";
import type { Mailer } from "../../lib/mailer.js";
import {
  createOAuthState,
  oauthRedirectUri,
  type OAuthProfile,
  type OAuthProvider,
} from "../../lib/oauth.js";
import { randomInt } from "node:crypto";
import type { KeyValueStore } from "../../lib/redis.js";
import { createId, createSecret, hashSecret } from "../../lib/secrets.js";
import { hashPassword, verifyPassword } from "./password.js";
import type {
  AuthRepository,
  EmailCodePurpose,
} from "./repository.js";
import type { AccountAccess, UserAccount, UserSession } from "./types.js";

const invalidCredentials = () =>
  new AppError(401, "INVALID_CREDENTIALS", "The email or password is invalid");

const invalidEmailCode = () =>
  new AppError(
    400,
    "INVALID_EMAIL_CODE",
    "The verification code is invalid or has expired",
  );

const oauthStateKey = (state: string) => `agentroom:oauth:state:${state}`;

export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly sessionTtlMs = 30 * 24 * 60 * 60 * 1_000,
    private readonly now: () => Date = () => new Date(),
    private readonly mailer: Mailer | undefined = undefined,
    private readonly store: KeyValueStore | undefined = undefined,
    private readonly oauthProviders: {
      google?: OAuthProvider;
      github?: OAuthProvider;
    } = {},
    private readonly publicBaseUrl = "http://127.0.0.1:8787",
    private readonly oauthStateTtlSeconds = 600,
    private readonly emailCodeTtlMinutes = 15,
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

  async login(input: {
    email: string;
    password: string;
  }): Promise<AccountAccess> {
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
    return {
      user: publicUser(credential),
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

  async requestEmailVerification(accessToken: string): Promise<void> {
    const user = await this.authenticate(accessToken);
    if (user.emailVerifiedAt) {
      throw new AppError(
        409,
        "EMAIL_ALREADY_VERIFIED",
        "This account email is already verified",
      );
    }
    const code = createEmailCode();
    await this.saveEmailCode(user.id, "email_verify", code);
    await this.sendMail({
      to: user.email,
      subject: "Verify your AgentRoom email",
      text:
        `Your AgentRoom email verification code is:\n\n  ${code}\n\n` +
        `It expires in ${this.emailCodeTtlMinutes} minutes. ` +
        `Enter it on the AgentRoom email verification screen.`,
    });
  }

  async verifyEmail(
    accessToken: string,
    code: string,
  ): Promise<UserAccount> {
    const user = await this.authenticate(accessToken);
    const verifiedAt = this.now().toISOString();
    await this.consumeEmailCode(user.id, "email_verify", code);
    await this.repository.markEmailVerified(user.id, verifiedAt);
    return { ...user, emailVerifiedAt: verifiedAt };
  }

  async requestPasswordReset(email: string): Promise<void> {
    const normalizedEmail = normalizeEmail(email);
    const credential = await this.repository.findCredentialByNormalizedEmail(
      normalizedEmail,
    );
    if (!credential) {
      // Burn comparable CPU so unknown emails cannot be timed.
      await hashPassword(createSecret("decoy"));
      return;
    }
    const code = createEmailCode();
    await this.saveEmailCode(credential.id, "password_reset", code);
    await this.sendMail({
      to: credential.email,
      subject: "Reset your AgentRoom password",
      text:
        `Your AgentRoom password reset code is:\n\n  ${code}\n\n` +
        `It expires in ${this.emailCodeTtlMinutes} minutes. ` +
        `Enter it with your email on the password reset screen.`,
    });
  }

  async resetPassword(input: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<UserAccount> {
    const credential = await this.repository.findCredentialByNormalizedEmail(
      normalizeEmail(input.email),
    );
    if (!credential) {
      throw invalidEmailCode();
    }
    await this.consumeEmailCode(credential.id, "password_reset", input.code);
    const passwordHash = await hashPassword(input.newPassword);
    await this.repository.updatePassword(credential.id, passwordHash);
    await this.repository.revokeAllSessionsExcept(
      credential.id,
      null,
      this.now().toISOString(),
    );
    return publicUser(credential);
  }

  async changePassword(input: {
    accessToken: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const user = await this.authenticate(input.accessToken);
    const credential = await this.repository.findCredentialByNormalizedEmail(
      user.email,
    );
    if (!credential) {
      throw invalidCredentials();
    }
    if (!(await verifyPassword(input.currentPassword, credential.passwordHash))) {
      throw invalidCredentials();
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.repository.updatePassword(credential.id, passwordHash);
    await this.repository.revokeAllSessionsExcept(
      credential.id,
      hashSecret(input.accessToken),
      this.now().toISOString(),
    );
  }

  async oauthAuthorize(provider: "google" | "github"): Promise<{
    redirectUrl: string;
  }> {
    const oauthProvider = this.oauthProviders[provider];
    if (!oauthProvider || !this.store) {
      throw new AppError(
        400,
        "OAUTH_NOT_CONFIGURED",
        `OAuth sign-in with ${provider} is not configured`,
      );
    }
    const { state, expiresAt } = createOAuthState(this.oauthStateTtlSeconds);
    await this.store.set(
      oauthStateKey(state),
      JSON.stringify({ provider, expiresAt }),
      this.oauthStateTtlSeconds * 1_000,
    );
    return {
      redirectUrl: oauthProvider.authorizeUrl(
        state,
        oauthRedirectUri(this.publicBaseUrl, provider),
      ),
    };
  }

  async oauthCallback(
    provider: "google" | "github",
    code: string,
    state: string,
  ): Promise<AccountAccess> {
    const oauthProvider = this.oauthProviders[provider];
    if (!oauthProvider || !this.store) {
      throw new AppError(
        400,
        "OAUTH_NOT_CONFIGURED",
        `OAuth sign-in with ${provider} is not configured`,
      );
    }
    const storedState = await this.store.get(oauthStateKey(state));
    await this.store.del(oauthStateKey(state));
    if (!storedState) {
      throw new AppError(400, "OAUTH_STATE_INVALID", "The OAuth state is invalid");
    }
    let parsed: { provider: string; expiresAt: string };
    try {
      parsed = JSON.parse(storedState) as { provider: string; expiresAt: string };
    } catch {
      throw new AppError(400, "OAUTH_STATE_INVALID", "The OAuth state is invalid");
    }
    if (
      parsed.provider !== provider ||
      new Date(parsed.expiresAt).getTime() <= this.now().getTime()
    ) {
      throw new AppError(400, "OAUTH_STATE_INVALID", "The OAuth state is invalid");
    }

    const profile = await oauthProvider.exchangeCode(
      code,
      oauthRedirectUri(this.publicBaseUrl, provider),
    );
    const user = await this.linkOrCreateUser(profile);
    const createdAt = this.now().toISOString();
    const issued = this.issueSession(user.id, createdAt);
    await this.repository.createSession({
      session: issued.session,
      tokenHash: hashSecret(issued.accessToken),
    });
    return {
      user,
      accessToken: issued.accessToken,
      expiresAt: issued.session.expiresAt,
    };
  }

  private async linkOrCreateUser(profile: OAuthProfile): Promise<UserAccount> {
    const existing = await this.repository.findUserByOAuth(
      profile.provider,
      profile.providerUserId,
    );
    if (existing) {
      return existing;
    }
    const byEmail = await this.repository.findCredentialByNormalizedEmail(
      normalizeEmail(profile.email),
    );
    if (byEmail) {
      await this.repository.linkOAuthAccount(
        profile.provider,
        profile.providerUserId,
        byEmail.id,
        this.now().toISOString(),
      );
      return publicUser(byEmail);
    }
    const createdAt = this.now().toISOString();
    const user: UserAccount = {
      id: createId("usr"),
      email: profile.email,
      displayName: profile.displayName.trim() || "New user",
      createdAt,
    };
    const passwordHash = await hashPassword(createSecret("oauth"));
    const issued = this.issueSession(user.id, createdAt);
    await this.repository.createUser({
      user,
      passwordHash,
      session: issued.session,
      sessionTokenHash: hashSecret(issued.accessToken),
    });
    await this.repository.linkOAuthAccount(
      profile.provider,
      profile.providerUserId,
      user.id,
      createdAt,
    );
    return user;
  }

  private async saveEmailCode(
    userId: string,
    purpose: EmailCodePurpose,
    code: string,
  ): Promise<void> {
    const createdAt = this.now().toISOString();
    const expiresAt = new Date(
      new Date(createdAt).getTime() + this.emailCodeTtlMinutes * 60_000,
    ).toISOString();
    await this.repository.createEmailCode({
      id: createId("cod"),
      userId,
      purpose,
      codeHash: hashSecret(code),
      expiresAt,
      createdAt,
    });
  }

  private async consumeEmailCode(
    userId: string,
    purpose: EmailCodePurpose,
    code: string,
  ): Promise<void> {
    const codeHash = hashSecret(code);
    const now = this.now().toISOString();
    const record = await this.repository.findValidEmailCode(
      userId,
      purpose,
      codeHash,
      now,
    );
    if (!record) {
      // Count the failed attempt against the user's most recent code so
      // brute-force is bounded per code, not just per IP: every wrong guess
      // burns the same (unknown) code record.
      const latest = await this.repository.findLatestEmailCode(userId, purpose);
      if (latest) {
        await this.repository.incrementEmailCodeFailures(latest.id);
      }
      throw invalidEmailCode();
    }
    await this.repository.consumeEmailCode(record.id, now);
  }

  private async sendMail(message: {
    to: string;
    subject: string;
    text: string;
  }): Promise<void> {
    if (!this.mailer) {
      return;
    }
    try {
      await this.mailer.send(message);
    } catch (error) {
      // Mail delivery must not break the request flow; the code is still stored.
      console.error("AgentRoom mail delivery failed:", error);
    }
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

function createEmailCode(): string {
  // crypto-secure 6-digit code; Math.random() would be predictable.
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function publicUser(credential: {
  passwordHash: string;
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
  emailVerifiedAt?: string | null;
}): UserAccount {
  const { passwordHash: _passwordHash, ...user } = credential;
  return user;
}
