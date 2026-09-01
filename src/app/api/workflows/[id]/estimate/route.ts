/**
 * POST /api/workflows/[id]/estimate — reprice a saved workflow.
 *
 * Recomputes what this workflow would cost and how long it would take, and
 * caches both on the project row for the history page to read.
 *
 * THE GRAPH IS READ FROM THE DATABASE, NOT FROM THE REQUEST BODY.
 *
 * The body carries nothing but the id in the path. That is the point: a route
 * that accepted a graph would be a route that accepts "here is a workflow,
 * please agree it costs one credit", and est_credits is a figure shown to a
 * user before they spend anything. Reading the stored row means the estimate
 * always describes what was actually saved, and there is no field in the
 * request that can influence it.
 *
 * The pricing itself is `creditCostForRun()` — the same function the credit
 * gate bills from, not a parallel table. estimateMatchesBilling.test.ts asserts
 * the two agree, because the credit system has already been bitten once by a
 * second price list that drifted.
 *
 * FAILURE IS NOT THE CALLER'S PROBLEM. This is called after a save that has
 * already succeeded. If repricing fails the workflow is still saved and still
 * runnable; only the estimate on its history card is stale, and the history
 * page falls back to saying so. So a broken reprice logs and answers 200 with
 * `stored: false` rather than turning a good save into an error.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import { estimateWorkflow, type LatencyTable } from "@/lib/workflows/estimate";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  // Ownership, through the caller's client so RLS answers it. A workflow that
  // is not theirs is a 404, never a repriced row.
  const { data: project, error } = await auth.supabase
    .from("projects")
    .select("id, workflow_json")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[workflows] estimate lookup failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!project) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }

  const graph = (project.workflow_json ?? {}) as Record<string, unknown>;
  const estimate = estimateWorkflow(graph.nodes, await latencyTable(auth.supabase));

  // Cached, not authoritative. A completed run's measured cost always wins on
  // the history card; this is what it shows before there is one.
  const { error: writeError } = await auth.supabase
    .from("projects")
    .update({
      est_credits: estimate.credits,
      est_duration_ms: estimate.durationMs,
      est_partial: estimate.partial,
      models: estimate.models,
    })
    .eq("id", id);

  if (writeError) {
    console.error("[workflows] estimate write failed:", writeError.message);
    return NextResponse.json({ ...estimate, stored: false });
  }

  return NextResponse.json({ ...estimate, stored: true });
}

/**
 * Measured per-model medians, keyed by model id.
 *
 * An empty table is fine and expected on a new install: estimateWorkflow falls
 * back to its static per-kind figures, which the UI labels differently. A
 * failure here is not worth failing the reprice over — a duration derived from
 * the fallback is still better than no estimate at all.
 */
async function latencyTable(supabase: SupabaseClient): Promise<LatencyTable> {
  try {
    const { data, error } = await supabase.rpc("model_latency_stats", {
      p_days: 30,
      p_min_runs: 3,
    });
    if (error || !Array.isArray(data)) return {};

    const table: LatencyTable = {};
    for (const row of data as Record<string, unknown>[]) {
      const modelId = row.model_id;
      const median = Number(row.median_ms);
      if (typeof modelId === "string" && Number.isFinite(median) && median > 0) {
        table[modelId] = median;
      }
    }
    return table;
  } catch {
    return {};
  }
}
