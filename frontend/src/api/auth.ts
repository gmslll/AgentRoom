import { api } from "./client";
import type {
  Account,
  AccountAccess,
  LoginInput,
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
