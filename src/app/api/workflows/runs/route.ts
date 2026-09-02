/**
 * POST /api/workflows/runs — open a run.
 *
 * Body: { projectId?: string, projectName?: string, nodeCount?: number }
 * Returns: { runId: string | null }
 *
 * The run id is minted by the server and handed to the client, never invented
 * by the browser and announced. That mirrors the rule the credit system
 * already holds to: the client picks the *moment* a run starts and stops, and
 * never its identity or its cost. A client-chosen id would let one user file
 * their charges under another user's run.
 *
 * `runId: null` is a SUCCESS, not an error. If the row cannot be written the
 * workflow still runs — every charge simply settles through the user-wide path
 * as it did before history existed. A feature for looking at the past must
 * never be able to stop someone working in the present, so this route answers
 * 200 with a null id rather than a 500 the executor would have to interpret.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import { listUserRunHistory } from "@/lib/workflows/history";
import { startRun } from "@/lib/workflows/runs";

export const dynamic = "force-dynamic";

/**
 * GET /api/workflows/runs — every run this caller has made, newest first.
 *
 * Query: ?limit= &offset= &status= &q=
 *
 * The read half of this path: POST opens a run, GET lists them.
 *
 * Read through the CALLER'S client, never the service client — `user_run_history`
 * is security definer and scopes itself with auth.uid(), so the service role
 * would give it no caller to scope to and it would correctly return nothing.
 * That "works for the service role, empty for a user" trap is the one this
 * shape avoids, and it is why every reader on this feature takes a client
 * rather than a user id.
 *
 * A failed read answers 200 with `failed` set rather than a 500, matching
 * GET /api/workflows. "You have run nothing" and "the query broke" are
 * different facts and the page has to be able to tell them apart.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;

  const page = await listUserRunHistory(auth.supabase, {
    limit: numberParam(params.get("limit")),
    offset: numberParam(params.get("offset")),
    status: params.get("status"),
    q: params.get("q"),
  });

  return NextResponse.json(page);
}

function numberParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function POST(request: NextRequest) {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));

  const runId = await startRun({
    userId: auth.user.id,
    projectId: typeof body?.projectId === "string" ? body.projectId : null,
    projectName: typeof body?.projectName === "string" ? body.projectName : null,
    nodeCount: typeof body?.nodeCount === "number" ? body.nodeCount : null,
  });

  return NextResponse.json({ runId });
}
