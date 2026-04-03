import { createClient, SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Browser client (uses anon key, respects RLS when enabled)
// Lazy-init to avoid errors during build when env vars aren't set
let _browserClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!_browserClient) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase credentials not configured");
    }
    _browserClient = createClient(supabaseUrl, supabaseAnonKey);
  }
  return _browserClient;
}

// For backward compat — lazy getter
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return Reflect.get(getSupabase(), prop);
  },
});

// Server client (uses service role key, bypasses RLS — use only in API routes)
export function getServiceClient(): SupabaseClient {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Supabase service credentials not configured (SUPABASE_SERVICE_ROLE_KEY)");
  }
  return createClient(supabaseUrl, serviceKey);
}

export const MEDIA_BUCKET = "project-media";
