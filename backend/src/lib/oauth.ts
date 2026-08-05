import { randomBytes } from "node:crypto";

export interface OAuthProfile {
  provider: "google" | "github";
  providerUserId: string;
  email: string;
  displayName: string;
}

export interface OAuthProvider {
  readonly provider: "google" | "github";
  authorizeUrl(state: string, redirectUri: string): string;
  exchangeCode(code: string, redirectUri: string): Promise<OAuthProfile>;
}

/** OAuth 2.0 authorization code clients for Google and GitHub using fetch. */
export function createOAuthProvider(
  provider: "google" | "github",
  clientId: string | undefined,
  clientSecret: string | undefined,
): OAuthProvider | undefined {
  if (!clientId || !clientSecret) {
    return undefined;
  }
  if (provider === "google") {
    return new GoogleOAuthProvider(clientId, clientSecret);
  }
  return new GitHubOAuthProvider(clientId, clientSecret);
}

class GoogleOAuthProvider implements OAuthProvider {
  readonly provider = "google" as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  authorizeUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OAuthProfile> {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenResponse.ok) {
      throw new Error(`Google token exchange failed: ${tokenResponse.status}`);
    }
    const token = (await tokenResponse.json()) as { access_token: string };
    const infoResponse = await fetch(
      "https://openidconnect.googleapis.com/v1/userinfo",
      { headers: { authorization: `Bearer ${token.access_token}` } },
    );
    if (!infoResponse.ok) {
      throw new Error(`Google userinfo failed: ${infoResponse.status}`);
    }
    const info = (await infoResponse.json()) as {
      sub: string;
      email: string;
      name?: string;
    };
    return {
      provider: "google",
      providerUserId: info.sub,
      email: info.email.toLowerCase(),
      displayName: info.name ?? info.email.split("@")[0] ?? "Google user",
    };
  }
}

class GitHubOAuthProvider implements OAuthProvider {
  readonly provider = "github" as const;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  authorizeUrl(state: string, redirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: "read:user user:email",
      state,
    });
    return `https://github.com/login/oauth/authorize?${params}`;
  }

  async exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<OAuthProfile> {
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      },
    );
    if (!tokenResponse.ok) {
      throw new Error(`GitHub token exchange failed: ${tokenResponse.status}`);
    }
    const token = (await tokenResponse.json()) as { access_token: string };
    const infoResponse = await fetch("https://api.github.com/user", {
      headers: {
        authorization: `Bearer ${token.access_token}`,
        accept: "application/vnd.github+json",
        "user-agent": "agentroom-backend",
      },
    });
    if (!infoResponse.ok) {
      throw new Error(`GitHub userinfo failed: ${infoResponse.status}`);
    }
    const info = (await infoResponse.json()) as {
      id: number;
      login: string;
      name?: string | null;
      email?: string | null;
    };
    let email = info.email;
    if (!email) {
      const emailsResponse = await fetch("https://api.github.com/user/emails", {
        headers: {
          authorization: `Bearer ${token.access_token}`,
          accept: "application/vnd.github+json",
          "user-agent": "agentroom-backend",
        },
      });
      if (emailsResponse.ok) {
        const emails = (await emailsResponse.json()) as Array<{
          email: string;
          primary?: boolean;
        }>;
        email = emails.find((entry) => entry.primary)?.email ?? emails[0]?.email;
      }
    }
    if (!email) {
      throw new Error("GitHub account has no public email");
    }
    return {
      provider: "github",
      providerUserId: String(info.id),
      email: email.toLowerCase(),
      displayName: info.name ?? info.login ?? "GitHub user",
    };
  }
}

export function createOAuthState(ttlSeconds: number): {
  state: string;
  expiresAt: string;
} {
  const now = Date.now();
  return {
    state: randomBytes(24).toString("base64url"),
    expiresAt: new Date(now + ttlSeconds * 1_000).toISOString(),
  };
}

export function oauthRedirectUri(
  publicBaseUrl: string,
  provider: string,
): string {
  return `${publicBaseUrl}/v1/auth/oauth/${provider}/callback`;
}
