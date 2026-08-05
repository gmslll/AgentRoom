import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const algorithm = "scrypt";
const cost = 32_768;
const blockSize = 8;
const parallelization = 1;
const keyLength = 32;
const maxMemory = 64 * 1024 * 1024;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await derive(password, salt);
  return [
    algorithm,
    cost,
    blockSize,
    parallelization,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const parts = encoded.split("$");
  if (
    parts.length !== 6 ||
    parts[0] !== algorithm ||
    Number(parts[1]) !== cost ||
    Number(parts[2]) !== blockSize ||
    Number(parts[3]) !== parallelization
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(parts[4]!, "base64url");
    const expected = Buffer.from(parts[5]!, "base64url");
    if (salt.length !== 16 || expected.length !== keyLength) {
      return false;
    }
    const actual = await derive(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLength,
      {
        N: cost,
        r: blockSize,
        p: parallelization,
        maxmem: maxMemory,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      },
    );
  });
}
