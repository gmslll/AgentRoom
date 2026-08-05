import { describe, expect, it } from "vitest";
import { LogMailer } from "../../../src/lib/mailer.js";
import { InMemoryAuthRepository } from "../../../src/modules/auth/memory-repository.js";
import { emailCodeMaxAttempts } from "../../../src/modules/auth/repository.js";
import { AuthService } from "../../../src/modules/auth/service.js";

class CapturingMailer extends LogMailer {
  readonly sent: Array<{ to: string; subject: string; text: string }> = [];

  constructor() {
    super(() => undefined);
  }

  override async send(message: {
    to: string;
    subject: string;
    text: string;
  }): Promise<void> {
    this.sent.push(message);
  }
}

function extractCode(text: string): string {
  const match = text.match(/\b(\d{6})\b/);
  if (!match) {
    throw new Error("no 6-digit code found in mail text");
  }
  return match[1]!;
}

describe("email verification codes", () => {
  it("invalidates a code after too many failed attempts", async () => {
    const mailer = new CapturingMailer();
    const service = new AuthService(
      new InMemoryAuthRepository(),
      30 * 24 * 60 * 60 * 1_000,
      () => new Date("2026-08-05T00:00:00.000Z"),
      mailer,
    );
    const access = await service.register({
      email: "code@example.com",
      displayName: "Code",
      password: "correct horse battery staple",
    });
    await service.requestEmailVerification(access.accessToken);
    const code = extractCode(mailer.sent[0]!.text);

    // Wrong codes count against the same record.
    for (let attempt = 0; attempt < emailCodeMaxAttempts; attempt += 1) {
      await expect(
        service.verifyEmail(access.accessToken, "000000"),
      ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_EMAIL_CODE" });
    }

    // The real code is now burned by the failure limit.
    await expect(
      service.verifyEmail(access.accessToken, code),
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_EMAIL_CODE" });
  });

  it("accepts the correct code before the failure limit", async () => {
    const mailer = new CapturingMailer();
    const service = new AuthService(
      new InMemoryAuthRepository(),
      30 * 24 * 60 * 60 * 1_000,
      () => new Date("2026-08-05T00:00:00.000Z"),
      mailer,
    );
    const access = await service.register({
      email: "good@example.com",
      displayName: "Good",
      password: "correct horse battery staple",
    });
    await service.requestEmailVerification(access.accessToken);
    const code = extractCode(mailer.sent[0]!.text);

    await expect(service.verifyEmail(access.accessToken, "111111")).rejects.toMatchObject(
      { statusCode: 400 },
    );
    const user = await service.verifyEmail(access.accessToken, code);
    expect(user.emailVerifiedAt).toBeTruthy();
  });
});
