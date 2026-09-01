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

/**
 * Where a signed-in non-admin belongs.
 *
 * This is the landing page for everyone who is not the admin, and it is also
 * the target every admin-only redirect below points at — which is why it must
 * never itself be admin-only. Sending a non-admin from an admin page to
 * another admin page is an infinite redirect, and the browser reports that as
 * a broken site rather than a denied one.
 */
const NON_ADMIN_HOME = "/workflows";

/**
 * Pages only the admin may see.
 *
 * Two surfaces, one rule. The dashboard under /admin has always been here.
 * **The studio at / is now here too**: building and running workflows is an
 * admin-only capability, and a signed-in non-admin gets the history page
 * instead.
 *
 * Gated at the edge rather than in the page for the same reason the sign-in
 * wall is: a visitor who is not the admin never receives the page at all, so
 * there is no flash of a canvas before a client-side redirect and nothing to
 * reach by disabling JavaScript.
 *
 * This costs one indexed lookup on a single-row table, and only on these
 * paths. /api/* is excluded throughout — those routes gate themselves, and a
 * redirect would hand fetch() an HTML page with a 200 instead of the error it
 * knows how to handle.
 */
function isAdminPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/admin" ||
    pathname.startsWith("/admin/")
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

  // Signed in, but is it the admin? Asked through the caller's own session,
  // which the admins_select_self policy limits to their own row — so this
  // needs no service-role key, and a non-admin simply gets nothing back.
  //
  // Compared explicitly against the session's id rather than trusting that a
  // returned row must be theirs: the policy is what makes those equivalent,
  // and this is the check that would be load-bearing if the policy were wrong.
  if (data.user && isAdminPath(pathname)) {
    const { data: admin } = await supabase
      .from("admins")
      .select("user_id")
      .eq("id", 1)
      .maybeSingle();

    // Redirected to their own home, not shown a denial. Someone who guessed
    // the URL learns only that it is not theirs.
    //
    // The target is NON_ADMIN_HOME rather than "/" because the studio is now
    // admin-only too: redirecting there would bounce straight back here and
    // loop forever.
    if (admin?.user_id !== data.user.id) {
      return NextResponse.redirect(new URL(NON_ADMIN_HOME, request.url));
    }
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
