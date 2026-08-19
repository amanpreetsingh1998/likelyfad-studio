/**
 * OAuth redirect target.
 *
 * Google sends the browser back here with a `code`; exchanging it sets the
 * session cookies. This URL must be registered as a redirect URL in the
 * Supabase dashboard (Authentication → URL Configuration).
 */

import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  // `next` lets a caller resume where they were; reject absolute URLs so this
  // cannot be used as an open redirect.
  const requested = searchParams.get("next") ?? "/";
  const next = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";

  // The provider reports denials here rather than at the token exchange.
  const error = searchParams.get("error_description") ?? searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      `${origin}/auth/error?message=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/auth/error?message=${encodeURIComponent("No authorization code returned")}`
    );
  }

  const supabase = await createSupabaseServerClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError) {
    return NextResponse.redirect(
      `${origin}/auth/error?message=${encodeURIComponent(exchangeError.message)}`
    );
  }

  // Behind a proxy, x-forwarded-host is the address the user actually typed;
  // `origin` would be the internal one.
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") ?? "https";
  const base =
    process.env.NODE_ENV === "development" || !forwardedHost
      ? origin
      : `${forwardedProto}://${forwardedHost}`;

  return NextResponse.redirect(`${base}${next}`);
}
