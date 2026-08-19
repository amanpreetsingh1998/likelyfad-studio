/**
 * Session refresh and the sign-in wall, on every matched request.
 *
 * Supabase access tokens are short-lived. Without this, a tab left open past
 * expiry starts failing RLS-guarded queries until a manual reload. Calling
 * getUser() here refreshes the token when needed and writes the rotated
 * cookies onto the response.
 *
 * The same call decides whether the request is allowed through at all. Doing it
 * here rather than in the page means a signed-out visitor never receives the
 * studio: no flash of a canvas before a redirect, and nothing to bypass by
 * disabling JavaScript.
 *
 * Next 16 names this file `proxy.ts` and requires an export called `proxy`
 * (`middleware.ts` still works, but having both is an error).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Paths that must stay reachable signed out, or there is no way back in.
 *
 * /api is deliberately here: those routes already answer with 401 through
 * getAuthedContext(), and redirecting them would hand a fetch() an HTML page
 * with a 200 instead of the error it knows how to handle.
 */
function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/signin" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/")
  );
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without credentials there is no session to refresh — and no way to sign in
  // either, so gating here would only produce a redirect loop. Let the request
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

  // Must run: this is the call that performs the refresh. getUser() rather
  // than getSession() because it verifies the JWT with the auth server instead
  // of trusting whatever the cookie claims — the difference between a wall and
  // a suggestion.
  const { data } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  if (!data.user && !isPublicPath(pathname)) {
    const signIn = new URL("/signin", request.url);
    signIn.searchParams.set("next", pathname + search);
    return NextResponse.redirect(signIn);
  }

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
