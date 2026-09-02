/**
 * Opening and closing the run that a piece of execution is billed under.
 *
 * WHY THIS EXISTS
 *
 * There are three ways to spend money on the canvas, and only one of them was
 * ever billed:
 *
 *   executeWorkflow()      — Run. Opened a run, settled on both exit paths.
 *   executeSelectedNodes() — Run selected. Opened nothing, settled nothing.
 *   regenerateNode()       — the regenerate button on a generation node, and
 *                            the single most-used action in the app. Opened
 *                            nothing, settled nothing.
 *
 * The last two still hit `/api/generate`, so `withCredits` still checked
 * affordability and still wrote a `pending_charges` row. Nothing ever billed
 * it. The badge counted down (the response header reports balance minus
 * pending) and the next reload put the number back, because the ledger had
 * never moved. Regenerate an image ten times and the account owed for ten
 * images while showing a balance that said otherwise.
 *
 * A regeneration gets its own run row rather than settling user-wide. It is an
 * execution that spent real money, so it belongs in the history for the same
 * reason an unsaved workflow's runs do — and a run-scoped settle bills exactly
 * the charges it opened, where the user-wide path would sweep in anything else
 * outstanding and file it under a single-node regenerate.
 *
 * NOTHING HERE THROWS. A run that cannot be opened returns null and execution
 * carries on unattributed, settling through the user-wide path exactly as it
 * did before runs existed.
 */

import { startWorkflowRun } from "@/lib/workflows/startRun";
import { settleRun, settleOnUnload } from "@/store/creditStore";
import { getActiveRunId, setActiveRunId } from "./activeRun";

export type BillableRunContext = {
  projectId: string | null;
  projectName: string | null;
  nodeCount: number;
};

/**
 * Open a run and make it ambient, so every executor's request carries its id.
 *
 * Awaited by callers rather than fired off: a node that dispatched before the
 * id arrived would be billed to nothing and quietly missing from the run's
 * cost. One round trip against work about to call a provider is cheap.
 */
export async function openBillableRun(
  ctx: BillableRunContext
): Promise<string | null> {
  const runId = await startWorkflowRun({
    projectId: ctx.projectId,
    projectName: ctx.projectName,
    nodeCount: ctx.nodeCount,
  });
  setActiveRunId(runId);
  return runId;
}

/**
 * Close the run and bill it.
 *
 * The ambient id is cleared FIRST and the local copy is what gets settled.
 * `settleRun` is fire-and-forget, so leaving the module value set would let a
 * node regenerated moments later attach its charge to a run that has already
 * been billed — money only the maintenance sweep would find, against a run
 * that never spent it.
 */
export function closeBillableRun(
  runId: string | null,
  status: "completed" | "failed" | "cancelled"
): void {
  setActiveRunId(null);
  void settleRun(status, runId);
}

/**
 * Bill a run whose tab is closing.
 *
 * `executeWorkflow` closes its run on every exit path, but none of them run if
 * the page goes away mid-execution — the machine sleeps, the tab is closed,
 * the user navigates. Those runs sat at `running` with their charges unbilled
 * until the hourly maintenance sweep found them, which the docs describe as
 * "swept, not fixed at the source". This is the source.
 *
 * `pagehide` rather than `beforeunload`: it is the event that actually fires
 * on mobile and on a bfcache navigation, and it does not risk prompting the
 * user. `persisted` is skipped because a bfcached page can come back and carry
 * on running.
 *
 * The status is `failed`, not `completed` — the run did not finish, and saying
 * it did would put a wrong answer in the history for a run nobody watched end.
 * It bills identically either way; the label is for whoever reads the ledger.
 *
 * Registered once, at import, and only in a browser.
 */
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    const runId = getActiveRunId();
    if (!runId) return;
    setActiveRunId(null);
    settleOnUnload("failed", runId);
  });
}
