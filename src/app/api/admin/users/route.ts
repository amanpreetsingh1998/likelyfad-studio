/**
 * GET /api/admin/users?q=&sort=&limit=&offset= — one page of accounts.
 *
 * The page renders its first page server-side, so this route exists for
 * search, sorting and paging, which all refetch without a navigation.
 *
 * Gated by requireAdmin() like every route under /api/admin: 401 signed out,
 * 404 signed in but not the admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { listUsers } from "@/lib/admin/users";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const result = await listUsers(gate.service, {
    search: params.get("q"),
    sort: params.get("sort"),
    limit: params.get("limit"),
    offset: params.get("offset"),
  });

  // 200 with `failed: true` rather than a 500, for the stats board's reason:
  // the UI must be able to tell "no accounts matched" from "the query broke",
  // and a 500 leaves it unable to say either.
  return NextResponse.json(result);
}
