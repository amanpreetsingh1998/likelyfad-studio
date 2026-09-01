/**
 * POST /api/credits/settle — bill a finished workflow.
 *
 * Body: { status?: "completed" | "failed" | "cancelled", runId?: string }
 *
 * The client decides *when* a workflow is over. It does not decide what that
 * costs: the amount comes from the pending_charges rows the generation routes
 * wrote as each node ran, so a browser that lies about what happened still
 * pays for what actually reached a provider.
 *
 * Settling twice is harmless — the second call finds no unsettled rows and
 * returns a zero charge — which matters because the client calls this from a
 * finally block that a retry or a double-click can reach more than once.
 *
 * A `runId` bills that one execution and closes its workflow_runs row, so the
 * ledger carries one line per workflow rather than one per "everything this
 * user owed at that moment" — which is what makes a per-workflow cost
 * answerable at all. Without one, settlement falls back to the user-wide path:
 * that is what a client predating this feature sends, and what the paths that
 * are not a workflow execution send.
 *
 * The run id is still only a grouping key. It selects which rows to bill; it
 * cannot change what they cost.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import { settlePendingCharges, settleWorkflowRun } from "@/lib/credits/server";
import { normaliseRunStatus } from "@/lib/workflows/runs";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));

    // A cancelled or failed workflow still pays for the nodes that already ran
    // — those provider calls happened. The label is only for the ledger, so a
    // user reading their history can see why a run cost what it did.
    const status = normaliseRunStatus(body?.status);
    const runId = typeof body?.runId === "string" && body.runId ? body.runId : null;

    // A run id that is not the caller's settles nothing and returns zero
    // rather than erroring — the honest answer, and one that declines to
    // confirm whether the run exists.
    const result = runId
      ? await settleWorkflowRun(auth.user.id, runId, status)
      : await settlePendingCharges(
          auth.user.id,
          status === "completed" ? "Workflow run" : `Workflow run (${status})`
        );

    if (result.shortfall > 0) {
      // The affordability check in the guard should make this unreachable;
      // if it fires, that check has a hole worth finding.
      console.warn("[credits] settled with a shortfall", {
        userId: auth.user.id,
        shortfall: result.shortfall,
      });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[credits] settle failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
