"use client";

import { useState } from "react";
import { useAuth } from "./AuthProvider";

export function SignInScreen() {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      // On success the browser navigates to Google; nothing after this runs.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex flex-col items-center justify-center gap-6 bg-neutral-950 px-6">
      <div className="flex flex-col items-center gap-3">
        <img src="/ls-icon.png" alt="" className="w-12 h-12" />
        <h1 className="text-2xl font-medium text-neutral-100">Likelyfad Studio</h1>
        <p className="text-sm text-neutral-400">
          Sign in to reach your projects.
        </p>
      </div>

      <button
        type="button"
        onClick={handleSignIn}
        disabled={busy}
        className="flex items-center gap-3 rounded-lg border border-neutral-700 bg-neutral-900 px-5 py-2.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-wait"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z"
          />
          <path
            fill="#EA4335"
            d="M12 4.75c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 1.46 14.97.5 12 .5a11 11 0 0 0-9.82 6.55l3.66 2.84c.87-2.6 3.3-4.14 6.16-4.14z"
          />
        </svg>
        {busy ? "Redirecting…" : "Continue with Google"}
      </button>

      {error && (
        <p className="max-w-sm text-center text-xs text-red-400 break-words">
          {error}
        </p>
      )}
    </div>
  );
}
