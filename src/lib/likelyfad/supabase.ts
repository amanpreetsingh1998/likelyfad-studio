import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase/client";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

/**
 * Browser client.
 *
 * Delegates to the cookie-backed SSR client so every query carries the
 * signed-in user's JWT. That is what makes the RLS policies apply to
 * cloud-storage.ts — with a bare anon client the requests would be
 * indistinguishable from a signed-out visitor's.
 */
export function getSupabase(): SupabaseClient {
  return getBrowserSupabase();
}

// For backward compat — lazy getter
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return Reflect.get(getSupabase(), prop);
  },
});

/**
 * Service client (bypasses RLS — API routes only).
 *
 * Deliberately does not live in @/lib/supabase/server: that module imports
 * next/headers, which cannot be pulled into the client bundle through this
 * file's browser-side importers.
 */
export function getServiceClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase service credentials not configured (SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const MEDIA_BUCKET = "project-media";
