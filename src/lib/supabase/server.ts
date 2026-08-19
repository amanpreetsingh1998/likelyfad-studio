/**
 * Server-side Supabase clients for route handlers and server components.
 *
 * createSupabaseServerClient() is the one to reach for: it acts as the
 * signed-in user, so RLS decides what the query can touch. The service-role
 * client stays available for the few jobs that legitimately need to bypass RLS
 * (admin scripts, the data-claim migration) and must never be used to serve a
 * user request without an explicit ownership check.
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

function credentials() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase credentials not configured");
  }
  return { url, anonKey };
}

/** Request-scoped client that carries the caller's session. Subject to RLS. */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, anonKey } = credentials();
  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // proxy.ts refreshes the session, so ignoring this is safe.
        }
      },
    },
  });
}

/** Service-role client. Bypasses RLS — see the note at the top of this file. */
export function getServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Supabase service credentials not configured (SUPABASE_SERVICE_ROLE_KEY)"
    );
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type AuthedContext = { supabase: SupabaseClient; user: User };

/**
 * Resolve the caller for a route handler.
 *
 * Uses getUser() rather than getSession(): getSession() trusts whatever the
 * cookie says, while getUser() verifies the JWT with the auth server.
 */
export async function getAuthedContext(): Promise<AuthedContext | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}
