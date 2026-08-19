/**
 * The gate between a signed-out visitor and the app.
 *
 * A signed-out visitor may look at the studio but not touch it: any click
 * sends them to /signin (see SignedOutInterceptor in src/app/page.tsx). This
 * module is the shared judgement of "is there a session", plus the redirect
 * itself, because the checks have to be callable from workflowStore.ts as much
 * as from components. AuthProvider pushes the session in.
 */

import { create } from "zustand";

export type AuthStatus = "unknown" | "signed-in" | "signed-out";

type AuthGateState = {
  status: AuthStatus;
  setStatus: (status: AuthStatus) => void;
};

export const useAuthGateStore = create<AuthGateState>((set) => ({
  status: "unknown",
  setStatus: (status) => set({ status }),
}));

/** Leave for /signin, remembering where to come back to. */
export function redirectToSignIn(): void {
  if (typeof window === "undefined") return;
  // A full assign rather than a router push: the studio holds a graph, a run
  // and blob URLs in memory, and a signed-out visitor has nothing there worth
  // preserving across the trip.
  const next = window.location.pathname + window.location.search;
  window.location.assign(`/signin?next=${encodeURIComponent(next)}`);
}

/**
 * True when the caller may proceed; otherwise starts the redirect and returns
 * false, so a call site reads `if (!requireAuth()) return;`.
 *
 * Only an explicit signed-out status blocks. Before AuthProvider has resolved
 * the session — and under tests, which never mount it — this returns true and
 * a write still fails downstream in requireCurrentUserId() exactly as it did
 * before, rather than the gate bouncing a user who turns out to be signed in.
 */
export function requireAuth(): boolean {
  if (useAuthGateStore.getState().status !== "signed-out") return true;
  redirectToSignIn();
  return false;
}

/**
 * Signed-in check for background work that must stay silent. Auto-save fires
 * every 30s; routing it through requireAuth() would navigate the visitor away
 * from the page on a timer.
 */
export function isSignedIn(): boolean {
  return useAuthGateStore.getState().status === "signed-in";
}
