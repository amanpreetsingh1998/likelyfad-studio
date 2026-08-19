"use client";

/**
 * Where the gate sends a signed-out visitor.
 *
 * `?next` is where to return once there is a session. It is read straight off
 * window.location rather than through useSearchParams(), which would force a
 * Suspense boundary on this page for no benefit.
 */

import { useEffect } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { SignInScreen } from "@/components/auth/SignInScreen";

function returnPath(): string {
  const requested = new URLSearchParams(window.location.search).get("next");
  // Reject absolute URLs, so a crafted link cannot bounce someone off-site.
  if (!requested || !requested.startsWith("/") || requested.startsWith("//")) {
    return "/";
  }
  return requested;
}

export default function SignInPage() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user) return;
    // Covers both arrivals: signing in on this page, and coming back from the
    // Google round trip, which lands here already authenticated.
    window.location.assign(returnPath());
  }, [user, loading]);

  // Rendered immediately rather than behind a spinner while the session
  // resolves. proxy.ts only sends people here after confirming there is no
  // session, so "signed out" is the overwhelmingly likely answer and waiting
  // to be told it would flash a spinner in front of every single visitor. A
  // signed-in user who navigates here directly sees the form for the moment
  // it takes the effect above to bounce them — the rarer case, and the
  // cheaper one to get wrong.
  return <SignInScreen />;
}
