import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Account } from "../api/types";

interface TokenState {
  /** Account session token (`ars_...`). Never written to logs, URLs, or git. */
  token: string | null;
  expiresAt: string | null;
  user: Account | null;
  setSession: (accessToken: string, expiresAt: string, user: Account) => void;
  setUser: (user: Account) => void;
  clearSession: () => void;
}

/**
 * Account session store. Persisted to sessionStorage so a page reload restores
 * the login state for the current tab; logout and 401 INVALID_SESSION clear it.
 */
export const useTokenStore = create<TokenState>()(
  persist(
    (set) => ({
      token: null,
      expiresAt: null,
      user: null,
      setSession: (token, expiresAt, user) => set({ token, expiresAt, user }),
      setUser: (user) => set({ user }),
      clearSession: () => set({ token: null, expiresAt: null, user: null }),
    }),
    {
      name: "agentroom.session",
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        token: state.token,
        expiresAt: state.expiresAt,
        user: state.user,
      }),
    },
  ),
);

/** Convenience selector for the current account token. */
export const selectToken = (state: TokenState): string | null => state.token;
