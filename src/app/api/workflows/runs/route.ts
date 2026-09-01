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
import { startRun } from "@/lib/workflows/runs";

export const dynamic = "force-dynamic";

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
