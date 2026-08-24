/**
 * The admin gate that wraps an /api/admin route.
 *
 * Two jobs, in order: prove the caller is the one admin, and only then hand
 * over a service-role client. Nothing above this line touches service role —
 * the check itself runs through it, but the handler cannot obtain it without
 * passing.
 *
 * WHY ROUTES AND NOT RLS
 *
 * The obvious alternative is an is_admin() helper wired into every table's RLS
 * policies, so the admin's own session can read everyone's rows. That was
 * rejected: it widens the blast radius of every policy in the schema at once,
 * on tables (projects, media, credit_transactions) whose entire security model
 * today is "auth.uid() = user_id and nothing else". A mistake in one policy
 * would leak across the whole app rather than across one route.
 *
 * So admin reads live here instead: RLS stays exactly as strict as it is, and
 * the bypass exists in one file that does an explicit identity comparison
 * first.
 */

import { NextResponse } from "next/server";
import { getAuthedContext, getServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/** The only row the admins table can hold — see 0005_admin.sql §1. */
const ADMIN_ROW_ID = 1;

export type AdminContext = {
  user: User;
  /** Bypasses RLS. Reachable only after the check above has passed. */
  service: SupabaseClient;
};

/**
 * Is this user the admin?
 *
 * Reads through the service client rather than the caller's session, so the
 * answer does not depend on the RLS policy in 0005 being correct. The policy
 * exists for src/proxy.ts, which cannot use next/headers and therefore cannot
 * reach the service client at all.
 *
 * The comparison is explicit — `row.user_id === userId`, not "a row came
 * back". Those are the same thing only for as long as the query filter is
 * right, and this is the one place in the app where being wrong hands over
 * every user's data.
 */
export async function isAdmin(userId: string): Promise<boolean> {
  let data: { user_id?: string } | null;
  let error: { message: string } | null;

  try {
    ({ data, error } = await getServiceClient()
      .from("admins")
      .select("user_id")
      .eq("id", ADMIN_ROW_ID)
      .maybeSingle());
  } catch (err) {
    // getServiceClient() throws outright when SUPABASE_SERVICE_ROLE_KEY is
    // missing. Letting that propagate would be a 500, not a refusal — and a
    // crash is not the same as a closed door.
    console.error(
      "[admin] admin lookup threw:",
      err instanceof Error ? err.message : err
    );
    return false;
  }

  if (error) {
    // Fail closed. An unreadable admins table (missing migration, revoked
    // grant, network blip) must not read as "sure, come in".
    console.error("[admin] admin lookup failed:", error.message);
    return false;
  }

  // Typed before compared. `data?.user_id === userId` alone is a fail-open:
  // a row without the column and a caller without an id are both undefined,
  // and undefined === undefined admits them.
  const adminId = data?.user_id;
  return typeof adminId === "string" && adminId === userId;
}

/**
 * Resolve the admin for a route handler, or return the response to send.
 *
 * Returns a discriminated union rather than throwing, so a handler cannot
 * forget to catch and accidentally serve the body anyway:
 *
 *   const gate = await requireAdmin();
 *   if (!gate.ok) return gate.response;
 *   const { service } = gate;
 *
 * 404 rather than 403 for a signed-in non-admin. There is no benefit in
 * confirming that an admin surface exists to someone who just probed for it.
 */
export async function requireAdmin(): Promise<
  { ok: true } & AdminContext | { ok: false; response: NextResponse }
> {
  const auth = await getAuthedContext();
  if (!auth) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }

  if (!(await isAdmin(auth.user.id))) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }

  return { ok: true, user: auth.user, service: getServiceClient() };
}
