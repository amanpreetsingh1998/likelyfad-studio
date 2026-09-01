/**
 * /workflows/[id]/run — run a workflow without the canvas.
 *
 * This is the surface a non-admin has instead of the studio. The admin builds
 * a workflow and publishes it; everyone else fills in its inputs here and
 * presses Run.
 *
 * IT REUSES THE REAL EXECUTION ENGINE. The client component below loads this
 * graph into workflowStore and calls the same `executeWorkflow()` the canvas
 * calls, so billing, run attribution, the credit gate, the generation log and
 * settlement all behave identically. A second execution path would be a second
 * thing to keep correct about money, and the first one to drift.
 *
 * ACCESS IS RLS, NOT AN `isAdmin()` CALL. The read below goes through the
 * caller's own client, and `projects` has exactly two select policies: your
 * own rows (0001), and published rows (0017). So a workflow that is neither
 * yours nor published returns nothing and this answers 404 — without this file
 * having to know anything about who is allowed what.
 *
 * 404 rather than 403, as everywhere else: someone probing ids learns nothing
 * about which exist.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAuthedContext } from "@/lib/supabase/server";
import { WorkflowRunner } from "@/components/workflows/WorkflowRunner";

export const metadata: Metadata = {
  title: "Run workflow · Likelyfad Studio",
};

// The graph must be current per request: running a stale copy would spend real
// credits on a workflow its owner has already changed.
export const dynamic = "force-dynamic";

export default async function RunWorkflowPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const auth = await getAuthedContext();
  if (!auth) return null; // proxy.ts already redirected; see the layout.

  const { data: project, error } = await auth.supabase
    .from("projects")
    .select("id, name, description, workflow_json, user_id, is_published")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[workflows] run page lookup failed:", error.message);
    throw new Error("Could not load this workflow.");
  }

  if (!project) notFound();

  return (
    <WorkflowRunner
      projectId={project.id}
      title={project.name ?? "Untitled workflow"}
      description={project.description ?? null}
      graph={(project.workflow_json ?? {}) as Record<string, unknown>}
      isOwner={project.user_id === auth.user.id}
    />
  );
}
