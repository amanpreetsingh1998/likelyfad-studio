"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Result of an email sign-up.
 *
 * With "Confirm email" off in the Supabase dashboard, signUp returns a session
 * and the user is straight in. With it on, it returns a user but no session and
 * nothing happens until they click the link — the caller has to say so rather
 * than appear to hang.
 */
export type SignUpOutcome = { needsConfirmation: boolean };

type AuthState = {
  user: User | null;
  /** True until the first session lookup resolves. */
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<SignUpOutcome>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    let active = true;

    // getUser() verifies the token with the auth server rather than trusting
    // the cookie, so a revoked session does not render as signed in.
    supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setUser(data.user ?? null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!active) return;
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,

      signInWithGoogle: async () => {
        const supabase = getBrowserSupabase();
        const next = window.location.pathname + window.location.search;
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          },
        });
        if (error) throw error;
      },

      signInWithPassword: async (email, password) => {
        const { error } = await getBrowserSupabase().auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        // onAuthStateChange sets the user; no navigation needed.
      },

      signUpWithPassword: async (email, password) => {
        const { data, error } = await getBrowserSupabase().auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        return { needsConfirmation: !data.session };
      },

      sendPasswordReset: async (email) => {
        const { error } = await getBrowserSupabase().auth.resetPasswordForEmail(
          email,
          {
            // The link carries a recovery code; the callback trades it for a
            // session and drops the user on the change-password form.
            redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/auth/reset-password")}`,
          }
        );
        if (error) throw error;
      },

      signOut: async () => {
        await getBrowserSupabase().auth.signOut();
        // Full reload so in-memory workflow state from the previous account
        // cannot leak into the next one.
        window.location.assign("/");
      },
    }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
