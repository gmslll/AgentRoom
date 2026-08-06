import { useEffect } from "react";
import { useToastStore } from "../stores/toastStore";

const KIND_STYLE: Record<string, string> = {
  error: "border-danger/40 text-danger",
  info: "border-border-strong text-text",
  success: "border-terminal/40 text-terminal",
};

const AUTO_DISMISS_MS = 4000;

/** Fixed-position toast host; mounted once in App. */
export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          id={toast.id}
          message={toast.message}
          kind={toast.kind}
          onDismiss={dismiss}
        />
      ))}
    </div>
  );
}

function ToastItem({
  id,
  message,
  kind,
  onDismiss,
}: {
  id: number;
  message: string;
  kind: string;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [id, onDismiss]);

  return (
    <button
      type="button"
      onClick={() => onDismiss(id)}
      className={`pointer-events-auto max-w-xs rounded-lg border bg-surface px-3 py-2 text-left text-sm shadow-xl ${KIND_STYLE[kind] ?? KIND_STYLE.info}`}
    >
      {message}
    </button>
  );
}
