import { api, apiUrl } from "./client";
import type {
  Account,
  AccountAccess,
  LoginInput,
  OAuthProvider,
  RegisterInput,
} from "./types";

export async function register(input: RegisterInput): Promise<AccountAccess> {
  return api<AccountAccess>("/v1/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function login(input: LoginInput): Promise<AccountAccess> {
  return api<AccountAccess>("/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Validates the local token and returns the account behind it. */
export async function getMe(token: string): Promise<{ user: Account }> {
  return api<{ user: Account }>("/v1/auth/me", {}, { token });
}

/** Revokes the current account token. */
export async function logout(token: string): Promise<void> {
  await api<void>("/v1/auth/logout", { method: "POST" }, { token });
}

export async function requestEmailVerification(token: string): Promise<void> {
  await api<void>("/v1/auth/email/verification", { method: "POST" }, { token });
}

export async function verifyEmail(
  token: string,
  code: string,
): Promise<{ user: Account }> {
  return api<{ user: Account }>(
    "/v1/auth/email/verify",
    { method: "POST", body: JSON.stringify({ code }) },
    { token },
  );
}

export async function requestPasswordReset(email: string): Promise<void> {
  await api<void>("/v1/auth/password/reset-request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<{ user: Account }> {
  return api<{ user: Account }>("/v1/auth/password/reset", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function changePassword(
  token: string,
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  await api<void>(
    "/v1/auth/password/change",
    { method: "POST", body: JSON.stringify(input) },
    { token },
  );
}

export function oauthAuthorizeUrl(provider: OAuthProvider): string {
  return apiUrl(`/v1/auth/oauth/${provider}/authorize`);
}
