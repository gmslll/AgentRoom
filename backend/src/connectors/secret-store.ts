export type CredentialStoreKind = "file" | "keychain";

export interface SecretStore {
  /**
   * Stores the secret. Returns false when the OS credential store is
   * unavailable so the caller can fall back to the config file.
   */
  save(account: string, secret: string): Promise<boolean>;
  load(account: string): Promise<string | undefined>;
}

/**
 * OS credential storage (macOS Keychain, Windows Credential Manager via
 * DPAPI, Linux libsecret) through @napi-rs/keyring. When the native module is
 * unavailable the caller falls back to the mode-0600 config file.
 */
export class KeychainSecretStore implements SecretStore {
  static #keyring: (typeof import("@napi-rs/keyring")) | undefined;

  constructor(private readonly service = "agentroom") {}

  async save(account: string, secret: string): Promise<boolean> {
    const keyring = await KeychainSecretStore.#loadKeyring();
    if (!keyring) {
      return false;
    }
    try {
      new keyring.Entry(this.service, account).setPassword(secret);
      return true;
    } catch {
      return false;
    }
  }

  async load(account: string): Promise<string | undefined> {
    const keyring = await KeychainSecretStore.#loadKeyring();
    if (!keyring) {
      return undefined;
    }
    try {
      const password = new keyring.Entry(this.service, account).getPassword();
      return password === null ? undefined : password;
    } catch {
      return undefined;
    }
  }

  static async #loadKeyring(): Promise<(typeof import("@napi-rs/keyring")) | undefined> {
    if (KeychainSecretStore.#keyring !== undefined) {
      return KeychainSecretStore.#keyring;
    }
    try {
      KeychainSecretStore.#keyring = await import("@napi-rs/keyring");
    } catch {
      KeychainSecretStore.#keyring = undefined;
    }
    return KeychainSecretStore.#keyring;
  }
}

/** The account id used in the OS credential store. */
export function credentialAccount(roomId: string, memberId: string): string {
  return `agentroom:${roomId}:${memberId}`;
}

export function resolveCredentialStoreKind(
  explicit: string | undefined,
): CredentialStoreKind {
  const value = (explicit ?? process.env.AGENTROOM_CREDENTIAL_STORE ?? "file")
    .trim()
    .toLowerCase();
  return value === "keychain" ? "keychain" : "file";
}
