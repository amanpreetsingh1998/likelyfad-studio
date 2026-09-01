/**
 * The run the current execution belongs to.
 *
 * Every generation request a workflow makes has to carry the same run id so
 * the server can group their charges into one workflow cost. The five
 * executors that talk to /api/generate and /api/llm each build their own
 * request body, so the id lives here rather than being threaded through all of
 * them — one place to set it, one place to read it, one rule about clearing.
 *
 * WHY MODULE STATE AND NOT THE STORE
 *
 * workflowStore's contents get serialised into saved workflow files. A run id
 * is not part of a workflow; it belongs to one execution of one, on one
 * machine, and writing it into node data would persist it into every save —
 * the same reason Comfy previews are kept out of the store.
 *
 * Only one workflow runs at a time (executeWorkflow refuses to start while
 * isRunning), so a single ambient value is the honest shape here.
 *
 * WHY CLEARING MATTERS
 *
 * A stale id is worse than no id. Regenerating a single node from the canvas
 * is deliberately not part of a workflow run — if it inherited a finished
 * run's id, its charge would be tagged to a run that has already settled, so
 * nothing would ever bill it except the maintenance sweep, and the history
 * page would show a cost for work that run never did. executeWorkflow clears
 * this on every exit path.
 */

let activeRunId: string | null = null;

/** Called by executeWorkflow once the server has minted a run. */
export function setActiveRunId(runId: string | null): void {
  activeRunId = runId;
}

/** Null outside a workflow execution, and whenever the run could not be opened. */
export function getActiveRunId(): string | null {
  return activeRunId;
}

/**
 * Attach the current run to a generation request body.
 *
 * A grouping key only. The server derives what to charge from its own rate
 * card and records it against this id; nothing in this payload can influence
 * the amount. When there is no active run the body goes out unchanged, and the
 * charge settles through the user-wide path exactly as it did before runs
 * existed.
 */
export function withRunId<T extends Record<string, unknown>>(
  payload: T
): T | (T & { runId: string }) {
  return activeRunId ? { ...payload, runId: activeRunId } : payload;
}
