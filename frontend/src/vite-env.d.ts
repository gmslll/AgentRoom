/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ENABLE_EMAIL_AUTH?: string;
  readonly VITE_ENABLE_GOOGLE_OAUTH?: string;
  readonly VITE_ENABLE_GITHUB_OAUTH?: string;
  readonly VITE_ENABLE_MODERATION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
