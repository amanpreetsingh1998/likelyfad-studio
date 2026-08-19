"use client";

/**
 * Where a password-reset link lands.
 *
 * The emailed link goes to /auth/callback first, which trades the recovery
 * code for a session and forwards here. So by the time this renders the user
 * is already authenticated — updateUser() is all that is left. Arriving here
 * without that session means the link was stale or already used.
 */

import { useEffect, useState, type FormEvent } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    getBrowserSupabase()
      .auth.getUser()
      .then(({ data }) => {
        setHasSession(!!data.user);
        setChecking(false);
      });
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await getBrowserSupabase().auth.updateUser({
        password,
      });
      if (updateError) throw updateError;
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the password");
    } finally {
      setBusy(false);
    }
  };

  const inputClass =
    "w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 outline-none transition-colors focus:border-neutral-500";

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-5 bg-neutral-950 px-6">
      <h1 className="text-lg font-semibold text-neutral-100">Set a new password</h1>

      {checking ? (
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-neutral-700 border-t-neutral-300" />
      ) : done ? (
        <>
          <p className="text-sm text-emerald-400">Password updated.</p>
          <a
            href="/"
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
          >
            Continue to the app
          </a>
        </>
      ) : !hasSession ? (
        <>
          <p className="max-w-sm text-center text-sm text-neutral-400">
            This reset link is no longer valid. Request a new one from the sign-in
            screen.
          </p>
          <a
            href="/"
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-200 transition-colors hover:bg-neutral-800"
          >
            Back to sign in
          </a>
        </>
      ) : (
        <form onSubmit={handleSubmit} className="flex w-full max-w-xs flex-col gap-2.5">
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="New password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
          <input
            type="password"
            required
            minLength={6}
            autoComplete="new-password"
            placeholder="Confirm new password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={inputClass}
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-neutral-100 px-5 py-2.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:cursor-wait disabled:opacity-50"
          >
            {busy ? "Saving…" : "Update password"}
          </button>
          {error && <p className="text-center text-xs text-red-400">{error}</p>}
        </form>
      )}
    </div>
  );
}
