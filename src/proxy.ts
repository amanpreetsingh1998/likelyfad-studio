/**
 * Session refresh on every matched request.
 *
 * Supabase access tokens are short-lived. Without this, a tab left open past
 * expiry starts failing RLS-guarded queries until a manual reload. Calling
 * getUser() here refreshes the token when needed and writes the rotated
 * cookies onto the response.
 *
 * Next 16 names this file `proxy.ts` and requires an export called `proxy`
 * (`middleware.ts` still works, but having both is an error).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without credentials there is no session to refresh. Let the request
  // through rather than hard-failing every page in the app.
  if (!url || !anonKey) return response;

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Must run: this is the call that performs the refresh.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Auth routes are
     * deliberately included so the callback can write session cookies.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm|glb)$).*)",
  ],
};
