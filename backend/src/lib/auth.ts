import { AppError } from "./errors.js";

export function readBearerToken(authorization: string | undefined): string {
  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError(401, "AUTH_REQUIRED", "A bearer token is required");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new AppError(401, "AUTH_REQUIRED", "A bearer token is required");
  }

  return token;
}
