"use client";

import { useState, type FormEvent } from "react";
import { useAuth } from "./AuthProvider";

type Mode = "signin" | "signup" | "reset";

const INPUT_CLASS =
  "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-neutral-500";

/** The sign-in form, with no opinion about the frame around it. */
export function SignInPanel() {
  const { signInWithGoogle, signInWithPassword, signUpWithPassword, sendPasswordReset } =
    useAuth();

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<null | "google" | "email">(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
  };

  const handleGoogle = async () => {
    setBusy("google");
    setError(null);
    try {
      await signInWithGoogle();
      // On success the browser leaves for Google; nothing after this runs.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setBusy(null);
    }
  };

  const handleEmail = async (e: FormEvent) => {
    e.preventDefault();
    setBusy("email");
    setError(null);
    setNotice(null);
    try {
      if (mode === "reset") {
        await sendPasswordReset(email);
        setNotice(`If an account exists for ${email}, a reset link is on its way.`);
      } else if (mode === "signup") {
        const { needsConfirmation } = await signUpWithPassword(email, password);
        if (needsConfirmation) {
          setNotice(`Check ${email} for a confirmation link to finish signing up.`);
        }
        // Otherwise the session already exists and the gate closes this itself.
      } else {
        await signInWithPassword(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const submitLabel =
    mode === "signup" ? "Create account" : mode === "reset" ? "Send reset link" : "Sign in";

  const subtitle =
    mode === "signup"
      ? "Create an account to get started."
      : mode === "reset"
        ? "We'll email you a link to set a new password."
        : "Sign in to reach your projects.";

  return (
    <div className="flex flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ls-icon.png" alt="" className="h-12 w-12" />
        <h1 className="text-2xl font-medium text-neutral-100">Likelyfad Studio</h1>
        <p className="text-center text-sm text-neutral-400">{subtitle}</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-4">
        <button
          type="button"
          onClick={handleGoogle}
          disabled={busy !== null}
          className="flex items-center justify-center gap-3 rounded-lg border border-neutral-700 bg-neutral-900 px-5 py-2.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-neutral-800 disabled:cursor-wait disabled:opacity-50"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
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
          {busy === "google" ? "Redirecting…" : "Continue with Google"}
        </button>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-neutral-800" />
          <span className="text-[11px] uppercase tracking-wide text-neutral-600">or</span>
          <span className="h-px flex-1 bg-neutral-800" />
        </div>

        <form onSubmit={handleEmail} className="flex flex-col gap-2.5">
          <input
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={INPUT_CLASS}
          />

          {mode !== "reset" && (
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_CLASS}
            />
          )}

          {mode === "signup" && (
            <p className="text-[11px] text-neutral-500">At least 6 characters.</p>
          )}

          <button
            type="submit"
            disabled={busy !== null}
            className="rounded-lg bg-neutral-100 px-5 py-2.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-50"
          >
            {busy === "email" ? "Working…" : submitLabel}
          </button>
        </form>

        <div className="flex flex-col gap-1 text-center text-xs text-neutral-500">
          {mode === "signin" && (
            <>
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className="transition-colors hover:text-neutral-300"
              >
                No account? <span className="text-neutral-300">Create one</span>
              </button>
              <button
                type="button"
                onClick={() => switchMode("reset")}
                className="transition-colors hover:text-neutral-300"
              >
                Forgot your password?
              </button>
            </>
          )}
          {mode !== "signin" && (
            <button
              type="button"
              onClick={() => switchMode("signin")}
              className="transition-colors hover:text-neutral-300"
            >
              Back to sign in
            </button>
          )}
        </div>

        {notice && (
          <p className="break-words text-center text-xs text-emerald-400">{notice}</p>
        )}
        {error && <p className="break-words text-center text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}
