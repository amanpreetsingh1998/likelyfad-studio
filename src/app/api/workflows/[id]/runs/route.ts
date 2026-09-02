/**
 * GET /api/workflows/[id]/runs — every run of one workflow.
 *
 * Query: ?limit= &offset=
 *
 * OWNERSHIP IS CHECKED, NOT JUST AUTHENTICATION. A signed-in caller passing
 * someone else's project id gets a 404, not that workflow's run history. This
 * is the exact class of bug the audit found open on /api/images/[id], which
 * serves any stored image by id to anyone with a session; it is not being
 * reintroduced here.
 *
 * Two layers do it, deliberately. The lookup below reads `projects` through
 * the caller's client, so RLS answers "is this yours"; and the SQL function
 * scopes its own rows with auth.uid() regardless. Neither alone is trusted:
 * RLS is the backstop, the explicit check is the check.
 *
 * The distinction is worth the extra round trip. "This workflow has no runs"
 * and "this workflow is not yours" would otherwise both render as an empty
 * drawer, and only the first is something the owner should act on.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import { listWorkflowRuns } from "@/lib/workflows/history";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Can the caller SEE this workflow? Not the same question as owning it, and
  // the comment here used to say otherwise. RLS scopes the read, and since
  // 0017 that means own rows OR published ones, so a row coming back proves
  // visibility and nothing more.
  //
  // That is the right gate for this route even so, and it is worth saying why
  // rather than leaving it to look like an oversight: the runs themselves are
  // scoped inside `workflow_run_history` with `r.user_id = auth.uid()`, so a
  // non-owner opening a published workflow sees its title and their OWN runs
  // of it — which is exactly what the run page is for. Nothing here widens
  // because the visibility check did.
  //
  // A soft-deleted workflow still counts as visible to its owner, because its
  // run history is exactly what a deleted workflow's spending needs to stay
  // explainable.
  const { data: project, error } = await auth.supabase
    .from("projects")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[workflows] ownership lookup failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!project) {
    // 404 rather than 403: someone probing ids learns nothing about which
    // exist. Same reasoning as the admin routes answering 404 to a non-admin.
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const params_ = request.nextUrl.searchParams;
  const page = await listWorkflowRuns(auth.supabase, id, {
    limit: numberParam(params_.get("limit")),
    offset: numberParam(params_.get("offset")),
  });

  return NextResponse.json({ title: project.name, ...page });
}

function numberParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
