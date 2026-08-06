import type { ActorType } from "../api/types";
import { providerLabel } from "../lib/provider";

const COLORS: Record<ActorType, string> = {
  human:
    "bg-human/15 text-human border-human/40 glow-human",
  agent:
    "bg-agent/15 text-agent border-agent/40 glow-agent",
  terminal:
    "bg-terminal/15 text-terminal border-terminal/40 glow-terminal",
};

interface AvatarProps {
  displayName: string;
  actorType: ActorType;
  agentProvider?: string | null;
  size?: "sm" | "md";
}

/** Round initial badge colored by participant type. */
export function Avatar({
  displayName,
  actorType,
  agentProvider,
  size = "md",
}: AvatarProps) {
  const initial = (displayName.trim()[0] ?? "?").toUpperCase();
  const dims = size === "sm" ? "size-6 text-xs" : "size-8 text-sm";
  const badge =
    actorType === "agent" && agentProvider
      ? providerLabel(agentProvider).slice(0, 1).toUpperCase()
      : initial;
  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-semibold transition-transform duration-150 ${dims} ${COLORS[actorType]}`}
      title={`${displayName} (${actorType})`}
    >
      {badge}
    </div>
  );
}
