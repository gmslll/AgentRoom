const PROVIDER_LABEL: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  other: "AI",
};

/** Human-friendly label for an agent provider. */
export function providerLabel(
  provider: string | null | undefined,
): string {
  return provider ? (PROVIDER_LABEL[provider] ?? provider) : "AI";
}
