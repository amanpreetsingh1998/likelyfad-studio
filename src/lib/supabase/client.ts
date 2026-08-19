/**
 * Browser Supabase client.
 *
 * Unlike a plain createClient(), this one reads and writes the session from
 * cookies, so the same session is visible to the server (proxy.ts, route
 * handlers, server components). Every query it makes carries the signed-in
 * user's JWT, which is what makes the RLS policies apply.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getBrowserSupabase(): SupabaseClient {
  if (typeof window === "undefined") {
    throw new Error("getBrowserSupabase() called on the server");
  }
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error("Supabase credentials not configured");
    }
    client = createBrowserClient(url, anonKey);
  }
  return client;
}

/** The signed-in user's id, or null when signed out. */
export async function getCurrentUserId(): Promise<string | null> {
  const { data } = await getBrowserSupabase().auth.getUser();
  return data.user?.id ?? null;
}

/**
 * The user id, or a thrown error. Storage paths and owner columns are keyed on
 * it, so callers that are about to write need the failure to be loud rather
 * than silently writing somewhere unreachable.
 */
export async function requireCurrentUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) throw new Error("Not signed in");
  return id;
}
