/**
 * POST /api/credits/settle — bill a finished workflow.
 *
 * Body: { status?: "completed" | "failed" | "cancelled" }
 *
 * The client decides *when* a workflow is over. It does not decide what that
 * costs: the amount comes from the pending_charges rows the generation routes
 * wrote as each node ran, so a browser that lies about what happened still
 * pays for what actually reached a provider.
 *
 * Settling twice is harmless — the second call finds no unsettled rows and
 * returns a zero charge — which matters because the client calls this from a
 * finally block that a retry or a double-click can reach more than once.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import { settlePendingCharges } from "@/lib/credits/server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const status = typeof body?.status === "string" ? body.status : "completed";

    // A cancelled or failed workflow still pays for the nodes that already ran
    // — those provider calls happened. The label is only for the ledger, so a
    // user reading their history can see why a run cost what it did.
    const reason =
      status === "completed"
        ? "Workflow run"
        : `Workflow run (${status})`;

    const result = await settlePendingCharges(auth.user.id, reason);

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
