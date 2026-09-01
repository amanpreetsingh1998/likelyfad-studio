/**
 * Client half of opening a run.
 *
 * Separate from `runs.ts`, which is server-only: that module imports the
 * service-role Supabase client, and pulling it into the store's import graph
 * would drag server credentials into a browser bundle.
 *
 * NOTHING HERE THROWS. Every failure path returns null, and the caller treats
 * null as "run without history". A workflow that could not open a run still
 * executes, still bills, and still settles through the user-wide path — the
 * only thing lost is the entry on the history page. That trade is deliberate:
 * a feature for reading the past must never be able to stop someone working in
 * the present.
 */

export type StartWorkflowRunInput = {
  /** projects.id, when this canvas has been saved. Null for an unsaved one. */
  projectId?: string | null;
  projectName?: string | null;
  nodeCount?: number | null;
};

/**
 * Ask the server for a run id.
 *
 * The id is minted server-side and returned; the browser never chooses one.
 * A client-chosen id would let one user file their charges under another
 * user's run, which is both a billing fault and a read of someone else's
 * history.
 */
export async function startWorkflowRun(
  input: StartWorkflowRunInput
): Promise<string | null> {
  try {
    const response = await fetch("/api/workflows/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: input.projectId ?? null,
        projectName: input.projectName ?? null,
        nodeCount: input.nodeCount ?? null,
      }),
    });

    // 401 included: signed out is already handled by the auth gate upstream,
    // and a run row for nobody is not worth an error path of its own.
    if (!response.ok) return null;

    const data = await response.json();
    return typeof data?.runId === "string" ? data.runId : null;
  } catch {
    // Offline, or the route is not deployed yet. Run anyway.
    return null;
  }
}
