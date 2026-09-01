/**
 * POST /api/workflows/[id]/publish — make a workflow available to every user,
 * or take it back.
 *
 * Body: { published: boolean }
 *
 * Publishing is a read grant on one project row and nothing else. It shares
 * the recipe, never the kitchen: a user who runs a published workflow spends
 * their own credits, gets their own run row and their own outputs, and the
 * owner sees none of it.
 *
 * OWNERSHIP IS CHECKED TWICE, ON PURPOSE. The lookup below reads through the
 * caller's client so RLS answers "is this yours", and `set_workflow_published`
 * filters on `user_id = auth.uid()` again in SQL. The route's copy is what
 * produces an honest 404; the SQL's copy is the one that still holds if a
 * future caller forgets to check. Neither is redundant with the other.
 *
 * There is deliberately no admin check here. Publishing is an owner's right,
 * not an administrative one — and today only the admin can build a workflow
 * anyway, so an `isAdmin()` call would add a second rule that says the same
 * thing and would have to be kept in step with the first.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  if (typeof body?.published !== "boolean") {
    return NextResponse.json(
      { error: "published must be true or false" },
      { status: 400 }
    );
  }

  const { data, error } = await auth.supabase.rpc("set_workflow_published", {
    p_project_id: id,
    p_published: body.published,
  });

  if (error) {
    console.error("[workflows] publish failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The function updates nothing when the row is not the caller's, so an empty
  // result is "not yours or not there" — answered as 404 rather than 403,
  // because someone probing ids should learn nothing about which exist.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  // Reported from what the database returned, never from what was requested:
  // a caller must not be able to misreport the outcome by assuming its own
  // request succeeded.
  return NextResponse.json({
    projectId: row.project_id,
    isPublished: row.is_published === true,
    publishedAt: row.published_at ?? null,
  });
}
