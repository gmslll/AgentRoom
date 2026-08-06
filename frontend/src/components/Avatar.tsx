import type { ActorType } from "../api/types";
import { providerLabel } from "../lib/provider";

const RING: Record<ActorType, string> = {
  human: "border-human/60 text-human bg-human/10",
  agent: "border-agent/60 text-agent bg-agent/10",
  terminal: "border-terminal/60 text-terminal bg-terminal/10",
};

interface AvatarProps {
  displayName: string;
  actorType: ActorType;
  agentProvider?: string | null;
  size?: "sm" | "md";
}

/** Round initial badge with a semantic-color ring; no glow. */
export function Avatar({
  displayName,
  actorType,
  agentProvider,
  size = "md",
}: AvatarProps) {
  const initial = (displayName.trim()[0] ?? "?").toUpperCase();
  const dims = size === "sm" ? "size-6 text-[11px]" : "size-8 text-sm";
  const badge =
    actorType === "agent" && agentProvider
      ? providerLabel(agentProvider).slice(0, 1).toUpperCase()
      : initial;
  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-semibold ${dims} ${RING[actorType]}`}
      title={`${displayName} (${actorType})`}
    >
      {badge}
    </div>
  );
}
