/**
 * The run entity: one execution of one workflow.
 *
 * Before this, `pending_charges` and `generation_events` were flat per-node
 * lists scoped only by user, so nothing in the system could answer "what did
 * workflow X cost" or "how long does it take". A run row is the join target
 * that makes both questions answerable.
 *
 * THE INVARIANT THIS FILE EXISTS TO PROTECT
 *
 * The client picks *when* a run starts and stops. It never says what one cost.
 * A run id travelling in a request body is a grouping key and nothing else —
 * the credits come from the `pending_charges` rows the server wrote as each
 * node ran, and the models and timings come from `generation_events`. If a
 * price, a model list or a duration is ever read out of a request body, that
 * is the vulnerability the whole pending-charges design was built to prevent.
 *
 * Everything here goes through the service-role client, because
 * `workflow_runs` has a read-own policy and no write policy at all (0013 §2) —
 * a user must not be able to forge a run or edit what one cost. The ownership
 * check that makes that safe is the caller's job: every function below takes a
 * userId that `getAuthedContext()` has already verified, and every write
 * filters on it.
 */

import { getServiceClient } from "@/lib/supabase/server";

const TABLE = "workflow_runs";

/**
 * A run's lifecycle.
 *
 * `cancelled` is a user decision; `abandoned` is a tab that closed and was
 * later swept by maintenance. They look identical in the ledger and mean
 * different things to whoever is asking why a run stopped.
 */
export type RunStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "abandoned";

/** A status a client may report when it closes a run it opened. */
export type ClientRunStatus = "completed" | "failed" | "cancelled";

const CLIENT_STATUSES: readonly string[] = [
  "completed",
  "failed",
  "cancelled",
];

/**
 * Coerce a client-supplied status into one we will store.
 *
 * Anything unrecognised becomes `completed` rather than being rejected: the
 * run really did end, and refusing to close it would leave the maintenance
 * sweep to reopen the question forever. The status is a ledger label, never a
 * reason to skip a debit.
 */
export function normaliseRunStatus(value: unknown): ClientRunStatus {
  return typeof value === "string" && CLIENT_STATUSES.includes(value)
    ? (value as ClientRunStatus)
    : "completed";
}

export type StartRunInput = {
  userId: string;
  /** projects.id — the client-minted 'wf_<ts>_<rand>' string. May be absent. */
  projectId?: string | null;
  /** Snapshot, so a renamed or deleted workflow still names what was run. */
  projectName?: string | null;
  nodeCount?: number | null;
};

/**
 * Open a run. Returns its id, or null if the row could not be written.
 *
 * NULL IS NOT AN ERROR THE CALLER SHOULD PROPAGATE. A history feature must
 * never be able to stop a user working: if this fails, the workflow runs
 * anyway with no run id, and every charge settles through the user-wide path
 * exactly as it did before this feature existed. The only thing lost is the
 * history entry.
 *
 * A workflow that has never been saved to the cloud still deserves a run row,
 * because the money it spends is real either way — so an absent project id is
 * normal, not a failure.
 *
 * THE PROJECT ID IS RESOLVED, NEVER STORED AS GIVEN. It arrives in a request
 * body and this row is written through the service-role client, so an
 * unchecked id is a foreign key the caller chose against a table RLS is not
 * protecting. Storing one lets a caller file a run against a workflow that is
 * not theirs, and the history feed then joins that row to `projects` to
 * display it — which is a read of another account's workflow name and an
 * existence oracle for any id. See `resolveProjectId` below. `finishRun` and
 * `runBelongsTo` already hold this line; this is the same rule applied to the
 * one write that was taking the client's word for it.
 */
export async function startRun(input: StartRunInput): Promise<string | null> {
  try {
    const projectId = await resolveProjectId(input.userId, input.projectId);

    const { data, error } = await getServiceClient()
      .from(TABLE)
      .insert({
        user_id: input.userId,
        project_id: projectId,
        project_name: clampName(input.projectName),
        node_count: normaliseCount(input.nodeCount),
        status: "running",
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      console.error(
        "[workflows] could not open a run — this execution will not appear in history:",
        error?.message ?? "no id returned",
        { userId: input.userId, projectId: input.projectId }
      );
      return null;
    }

    return data.id as string;
  } catch (err) {
    console.error(
      "[workflows] could not open a run:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Close a run without billing it.
 *
 * Settlement (`settle_workflow_run`) already closes the run it bills, so this
 * is for the paths that do not settle: a run that dispatched nothing, and the
 * maintenance sweep's abandoned rows.
 *
 * Filtered on `(id, user_id)`, never the id alone — the same rule that keeps
 * `generation_events` completion matching on the pair. A run id is supplied by
 * the browser, and an unchecked one would let a caller close, and later read,
 * a run belonging to someone else.
 *
 * `finished_at` uses coalesce so a re-close does not move the clock on a run
 * that already ended. Closing twice is harmless by design; the client reaches
 * this from a finally block that retries and double-clicks can hit.
 */
export async function finishRun(
  userId: string,
  runId: string,
  status: RunStatus
): Promise<boolean> {
  try {
    const { error } = await getServiceClient()
      .from(TABLE)
      .update({ status, finished_at: new Date().toISOString() })
      .eq("id", runId)
      .eq("user_id", userId)
      .eq("status", "running");

    if (error) {
      console.error("[workflows] could not close run:", error.message, { runId });
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      "[workflows] could not close run:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

/**
 * Does this run belong to this user?
 *
 * Used by the credit gate to decide whether to tag a charge with the run id
 * the browser sent. `record_pending_charge` re-checks the same thing in SQL —
 * the duplication is deliberate: the gate's copy avoids tagging rows we would
 * only have to untag, and the SQL copy is the one that is actually load
 * bearing, because it holds even if a future caller forgets this one.
 */
export async function runBelongsTo(
  userId: string,
  runId: string
): Promise<boolean> {
  try {
    const { data, error } = await getServiceClient()
      .from(TABLE)
      .select("user_id")
      .eq("id", runId)
      .maybeSingle();

    if (error || !data) return false;
    // Compared explicitly. "A row came back" is not a pass.
    return data.user_id === userId;
  } catch {
    return false;
  }
}

/**
 * May this user file a run against this workflow?
 *
 * Answers with the id to store, or null to store none — never an error. A
 * refused id degrades the run to "Unsaved workflow", which is a shape the feed
 * already renders and which costs the user nothing: the charges still settle,
 * because a run's cost comes from its `pending_charges` rows and never from
 * the workflow it names.
 *
 * TWO WAYS TO PASS, matching the two select policies on `projects` exactly —
 * your own row (0001) and a published one (0017). A published workflow has to
 * pass: the run page at /workflows/[id]/run is the only surface a non-admin
 * has, and every run made there is against somebody else's workflow by
 * design. Withholding the id would strand every one of those runs on the feed
 * as "Unsaved workflow".
 *
 * Compared explicitly rather than expressed as a filter that returns rows.
 * The service client bypasses RLS, so "a row came back" means only that the
 * id exists — which is the exact assumption this function exists to remove.
 * A soft-deleted workflow still passes for its owner, because owning it is
 * what is being asked; whether it is still somewhere to navigate to is a
 * separate question the feed answers for itself.
 */
async function resolveProjectId(
  userId: string,
  projectId: string | null | undefined
): Promise<string | null> {
  if (typeof projectId !== "string" || !projectId.trim()) return null;

  try {
    const { data, error } = await getServiceClient()
      .from("projects")
      .select("user_id, is_published, deleted_at")
      .eq("id", projectId)
      .maybeSingle();

    // A missing row is the ordinary case for a canvas that was never saved,
    // and a failed read is not a reason to trust an unverified id. Both store
    // nothing.
    if (error || !data) return null;

    const owned = data.user_id === userId;
    const published = data.is_published === true && !data.deleted_at;

    return owned || published ? projectId : null;
  } catch {
    return null;
  }
}

/** Names are snapshot for display, not replayed. 200 chars is plenty. */
function clampName(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > 200 ? trimmed.slice(0, 200) : trimmed;
}

function normaliseCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}
