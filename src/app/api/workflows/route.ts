/**
 * GET /api/workflows — the caller's workflow history, one page.
 *
 * Query: ?limit= &offset= &q= &sort=
 *
 * Read through the caller's own client, so the `auth.uid()` scoping inside
 * user_workflow_history has a caller to scope to. Deliberately NOT the service
 * client: that would bypass RLS and leave the function with no identity, and
 * the "works for the service role, returns nothing for a user" confusion is
 * exactly the trap this shape avoids.
 *
 * Both money figures are computed server-side and arrive finished. The page
 * never derives a cost client-side — not because the arithmetic is hard, but
 * because there would then be two places that decide what a workflow cost.
 *
 * A failed read answers 200 with `failed` set rather than a 500. The list and
 * the reason for it being empty are different facts, and the page has to be
 * able to say "could not load" instead of drawing a convincing empty state.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import { listWorkflowHistory } from "@/lib/workflows/history";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;

  const page = await listWorkflowHistory(auth.supabase, {
    limit: numberParam(params.get("limit")),
    offset: numberParam(params.get("offset")),
    q: params.get("q"),
    sort: params.get("sort"),
  });

  return NextResponse.json(page);
}

function numberParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
