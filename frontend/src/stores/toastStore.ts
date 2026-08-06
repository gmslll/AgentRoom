import { create } from "zustand";

export type ToastKind = "error" | "info" | "success";

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  toasts: Toast[];
  push: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

/** Minimal global toast queue (no dependency). */
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (message, kind = "info") =>
    set((state) => ({
      toasts: [...state.toasts, { id: nextId++, message, kind }],
    })),
  dismiss: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
}));

/** Push an error toast from any error-shaped value. */
export function toastError(error: unknown, fallback = "操作失败"): void {
  useToastStore
    .getState()
    .push(
      error instanceof Error && error.message ? error.message : fallback,
      "error",
    );
}
