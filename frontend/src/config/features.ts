function enabled(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export const features = {
  emailAuth: enabled(import.meta.env.VITE_ENABLE_EMAIL_AUTH),
  googleOAuth: enabled(import.meta.env.VITE_ENABLE_GOOGLE_OAUTH),
  githubOAuth: enabled(import.meta.env.VITE_ENABLE_GITHUB_OAUTH),
  moderation: enabled(import.meta.env.VITE_ENABLE_MODERATION),
} as const;
