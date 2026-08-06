import type { ApiErrorBody } from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)
  ?.replace(/\/+$/, "");

/**
 * Base URL for API requests. The Vite dev server proxies nothing by default;
 * point VITE_API_BASE_URL at the AgentRoom backend (see .env.example).
 */
export function apiUrl(path: string): string {
  const base = API_BASE_URL ?? "";
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiRequestOptions {
  /** Bearer token (account `ars_` or room `art_`). */
  token?: string;
  /** Skip JSON request body serialization (e.g. form data). */
  rawBody?: boolean;
}

/**
 * Unified API client. Throws ApiError with a preserved requestId for
 * diagnostics. Returns `undefined` for 204 responses.
 */
export async function api<T>(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !options.rawBody) {
    headers.set("content-type", "application/json");
  }
  if (options.token) {
    headers.set("authorization", `Bearer ${options.token}`);
  }

  let response: Response;
  try {
    response = await fetch(apiUrl(path), { ...init, headers });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Cannot reach the AgentRoom API");
  }

  if (response.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body (e.g. proxy error pages).
  }

  if (!response.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      response.status,
      err?.code ?? "UNKNOWN_ERROR",
      err?.message ?? `Request failed (${response.status})`,
      err?.requestId,
    );
  }
  return body as T;
}
