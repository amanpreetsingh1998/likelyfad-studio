/**
 * The session gate for routes that reach outward but do not spend credits.
 *
 * proxy.ts deliberately lets /api/* through, on the assumption that API routes
 * gate themselves. withCredits() is that gate for the generation routes,
 * requireAdmin() for /api/admin/*, requireCron() for the maintenance endpoint.
 * This is it for what is left: routes that make the server act on a caller's
 * behalf without billing for it.
 *
 * The Comfy routes are why it exists. They take their engine URL from an
 * X-Comfy-Base-Url header and then fetch it, which is deliberate — pointing at
 * 127.0.0.1:8188 is the whole purpose of local mode, and validateEngineUrl()
 * allows private and loopback addresses on purpose, saying so in a comment.
 * That design assumes a session in front of it. Without one, an anonymous
 * caller could aim the server at any internal address and read the outcome
 * back out of the response.
 *
 * Shaped as a discriminated union rather than a wrapper, matching requireAdmin()
 * and requireCron(), so a handler cannot forget to catch and run anyway:
 *
 *   const gate = await requireAuth();
 *   if (!gate.ok) return gate.response;
 */

import { NextResponse } from "next/server";
import { getAuthedContext, type AuthedContext } from "@/lib/supabase/server";

/**
 * 401 rather than the 404 the admin and cron gates answer with: these surfaces
 * are not secret — the client knows they exist and calls them on every run — so
 * the useful answer is "sign in", which is what the UI turns it into.
 */
export async function requireAuth(): Promise<
  { ok: true; auth: AuthedContext } | { ok: false; response: NextResponse }
> {
  const auth = await getAuthedContext();
  if (!auth) {
    return {
      ok: false,
      response: NextResponse.json(
        { success: false, error: "Not signed in" },
        { status: 401 }
      ),
    };
  }
  return { ok: true, auth };
}
