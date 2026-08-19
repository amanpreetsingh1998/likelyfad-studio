/**
 * The gate between a signed-out visitor and the actions that need an account.
 *
 * The studio itself renders for everyone: you can lay a graph out, wire handles
 * and type prompts without signing in. What needs an account is anything that
 * spends API credits or touches Supabase — and those checks have to be callable
 * from workflowStore.ts as much as from components, which is why this is a
 * plain store rather than React context. AuthProvider pushes the session in.
 */

import { create } from "zustand";

export type AuthStatus = "unknown" | "signed-in" | "signed-out";

type AuthGateState = {
  status: AuthStatus;
  isOpen: boolean;
  /** Completes "Sign in to …" on the modal. */
  reason: string | null;
  /** The blocked call, replayed once a session lands. */
  pending: (() => void) | null;

  setStatus: (status: AuthStatus) => void;
  open: (reason: string, pending?: () => void) => void;
  close: () => void;
};

export const useAuthGateStore = create<AuthGateState>((set) => ({
  status: "unknown",
  isOpen: false,
  reason: null,
  pending: null,

  setStatus: (status) =>
    set((state) => {
      if (status !== "signed-in" || !state.isOpen) return { status };
      // Signed in from the modal: dismiss it and resume what was blocked. The
      // timeout lets React commit the close first, so the replayed action does
      // not render behind a modal that is still on screen.
      const { pending } = state;
      if (pending) setTimeout(pending, 0);
      return { status, isOpen: false, reason: null, pending: null };
    }),

  open: (reason, pending) =>
    set({ isOpen: true, reason, pending: pending ?? null }),

  close: () => set({ isOpen: false, reason: null, pending: null }),
}));

/**
 * True when the caller may proceed; otherwise raises the sign-in modal and
 * returns false, so a call site reads `if (!requireAuth(...)) return;`.
 *
 * `reason` completes the sentence "Sign in to …". `retry` is replayed after a
 * successful sign-in — worth passing for anything the user explicitly asked
 * for. It cannot survive Google OAuth, which leaves the page entirely; that
 * path lands them back signed in with the modal gone, ready to click again.
 *
 * Only an explicit signed-out status blocks. Before AuthProvider has resolved
 * the session — and under tests, which never mount it — this returns true and
 * a write still fails downstream in requireCurrentUserId() exactly as it did
 * before, rather than the gate silently swallowing calls it cannot judge.
 */
export function requireAuth(reason: string, retry?: () => void): boolean {
  const { status, open } = useAuthGateStore.getState();
  if (status !== "signed-out") return true;
  open(reason, retry);
  return false;
}

/**
 * Signed-in check for background work that must stay silent. Auto-save fires
 * every 30s; routing it through requireAuth() would reopen the modal on a
 * timer over whatever the visitor is doing.
 */
export function isSignedIn(): boolean {
  return useAuthGateStore.getState().status === "signed-in";
}
