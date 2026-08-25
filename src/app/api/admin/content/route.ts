/**
 * GET /api/admin/content?q=&state=&kind=&user=&limit=&offset= — the feed.
 *
 * The page renders its first page server-side; this route serves the filters,
 * the search and paging, none of which should cost a navigation.
 *
 * Gated by requireAdmin(): 401 signed out, 404 signed in but not the admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getModerationFeed } from "@/lib/admin/moderation";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const feed = await getModerationFeed(gate.service, {
    search: params.get("q"),
    state: params.get("state"),
    kind: params.get("kind"),
    userId: params.get("user"),
    limit: params.get("limit"),
    offset: params.get("offset"),
  });

  // 200 with `failed` set rather than a 500 — the UI has to be able to tell
  // "nothing matches this filter" from "the query broke", and an empty feed
  // reads as the first.
  return NextResponse.json(feed);
}
