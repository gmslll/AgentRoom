import { useRef, useState } from "react";
import { copyText } from "../lib/copy";
import { Icon } from "./ui/Icon";

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
      className={`press inline-flex min-h-8 items-center gap-1.5 border border-border bg-surface-raised/70 px-2 py-1 text-[10px] font-semibold transition-colors hover:border-border-strong hover:bg-surface-soft ${
        copied ? "border-primary/60 text-primary" : "text-muted"
      } ${className ?? ""}`}
    >
      <Icon name={copied ? "check" : "copy"} size={12} />
      {copied ? "已复制" : label}
    </button>
  );
}
