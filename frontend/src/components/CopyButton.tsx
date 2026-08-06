import { useRef, useState } from "react";
import { copyText } from "../lib/copy";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
  /** Called after a successful copy (e.g. to enter the "waiting for agent" state). */
  onCopied?: () => void;
}

/** Copy-to-clipboard button with transient feedback. */
export function CopyButton({
  text,
  label = "复制",
  className,
  onCopied,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopy = async () => {
    const ok = await copyText(text);
    if (ok) {
      setCopied(true);
      onCopied?.();
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1600);
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:border-border-strong hover:bg-surface-raised ${
        copied ? "text-terminal border-terminal/40" : "text-muted"
      } ${className ?? ""}`}
    >
      {copied ? "已复制" : label}
    </button>
  );
}
