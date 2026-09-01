/**
 * The maintenance sweeps.
 *
 * What is worth pinning here is not the SQL — that is Postgres's job — but the
 * three things this layer decides: what a caller is allowed to ask for, what
 * happens to storage after the rows are gone, and whether a failure is
 * reported or swallowed. The clamps in particular guard a parameter that
 * deletes the only copy of the moderation record.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_RETENTION_DAYS,
  DEFAULT_STALE_MINUTES,
  DEFAULT_SWEEP_LIMIT,
  normalizeDays,
  normalizeLimit,
  normalizeMinutes,
  pruneGenerationEvents,
  runMaintenance,
  sweepAbandonedRuns,
  sweepPendingCharges,
} from "../sweep";

/** A Supabase stand-in whose rpc and storage calls are observable. */
function makeService(opts: {
  rpc?: (fn: string, args: Record<string, unknown>) => unknown;
  remove?: (keys: string[]) => unknown;
} = {}) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) =>
    opts.rpc ? opts.rpc(fn, args) : { data: [], error: null }
  );
  const remove = vi.fn(async (keys: string[]) =>
    opts.remove ? opts.remove(keys) : { error: null }
  );
  const from = vi.fn(() => ({ remove }));
  return {
    service: { rpc, storage: { from } } as unknown as SupabaseClient,
    rpc,
    remove,
    from,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("normalizeMinutes", () => {
  it("keeps a sensible window", () => {
    expect(normalizeMinutes(90)).toBe(90);
  });

  it("falls back to the default for junk", () => {
    expect(normalizeMinutes("soon")).toBe(DEFAULT_STALE_MINUTES);
    expect(normalizeMinutes(undefined)).toBe(DEFAULT_STALE_MINUTES);
  });

  it("clamps rather than letting a zero sweep live workflows", () => {
    expect(normalizeMinutes(0)).toBe(1);
    expect(normalizeMinutes(-5)).toBe(1);
    expect(normalizeMinutes(999999)).toBe(10080);
  });
});

describe("normalizeLimit", () => {
  it("clamps to a bounded batch", () => {
    expect(normalizeLimit(0)).toBe(1);
    expect(normalizeLimit(50)).toBe(50);
    expect(normalizeLimit(1e9)).toBe(5000);
    expect(normalizeLimit("all")).toBe(DEFAULT_SWEEP_LIMIT);
  });
});

describe("normalizeDays", () => {
  it("keeps a sensible retention window", () => {
    expect(normalizeDays(30)).toBe(30);
  });

  /**
   * The floor is the point of this function. `days=0` would delete every
   * generation_events row ever written — the moderation record and the entire
   * history behind the stats board, none of which can be backfilled.
   */
  it("refuses to prune everything", () => {
    expect(normalizeDays(0)).toBe(7);
    expect(normalizeDays(-1)).toBe(7);
    expect(normalizeDays(3)).toBe(7);
  });

  it("falls back to the default for junk", () => {
    expect(normalizeDays("forever")).toBe(DEFAULT_RETENTION_DAYS);
  });
});

describe("sweepPendingCharges", () => {
  it("passes the clamped window and limit to the sweep function", async () => {
    const { service, rpc } = makeService();
    await sweepPendingCharges(service, { minutes: 0, limit: 1e9 });

    expect(rpc).toHaveBeenCalledWith("sweep_stale_pending_charges", {
      p_minutes: 1,
      p_limit: 5000,
    });
  });

  it("totals what it settled across users", async () => {
    const { service } = makeService({
      rpc: () => ({
        data: [
          { user_id: "a", charged: 10, runs: 2, shortfall: 0 },
          { user_id: "b", charged: 5, runs: 1, shortfall: 3 },
        ],
        error: null,
      }),
    });

    const result = await sweepPendingCharges(service);

    expect(result).toEqual({
      users: 2,
      charged: 15,
      runs: 3,
      shortfall: 3,
      failed: null,
    });
  });

  it("reports a failure instead of throwing", async () => {
    const { service } = makeService({
      rpc: () => ({ data: null, error: { message: "function missing" } }),
    });

    const result = await sweepPendingCharges(service);

    expect(result.failed).toBe("function missing");
    expect(result.charged).toBe(0);
  });

  it("treats an empty sweep as a clean no-op", async () => {
    const { service } = makeService({ rpc: () => ({ data: [], error: null }) });
    const result = await sweepPendingCharges(service);
    expect(result).toEqual({
      users: 0,
      charged: 0,
      runs: 0,
      shortfall: 0,
      failed: null,
    });
  });
});

describe("pruneGenerationEvents", () => {
  it("deletes the thumbnails the row delete returned", async () => {
    const { service, remove, from } = makeService({
      rpc: () => ({
        data: [
          { deleted_thumb_path: "a.webp" },
          { deleted_thumb_path: "b.webp" },
        ],
        error: null,
      }),
    });

    const result = await pruneGenerationEvents(service, { days: 30 });

    expect(from).toHaveBeenCalledWith("moderation");
    expect(remove).toHaveBeenCalledWith(["a.webp", "b.webp"]);
    expect(result.rowsDeleted).toBe(2);
    expect(result.thumbsDeleted).toBe(2);
    expect(result.thumbsOrphaned).toBe(0);
  });

  /**
   * Video, audio and 3D runs never get a thumbnail, so a null path is the
   * normal case rather than an error — and passing one to remove() would be a
   * request to delete a key called "null".
   */
  it("skips rows that never had a thumbnail", async () => {
    const { service, remove } = makeService({
      rpc: () => ({
        data: [
          { deleted_thumb_path: null },
          { deleted_thumb_path: "" },
          { deleted_thumb_path: "kept.webp" },
        ],
        error: null,
      }),
    });

    const result = await pruneGenerationEvents(service);

    expect(remove).toHaveBeenCalledWith(["kept.webp"]);
    expect(result.rowsDeleted).toBe(3);
    expect(result.thumbsDeleted).toBe(1);
  });

  it("makes no storage call when nothing was pruned", async () => {
    const { service, remove } = makeService({ rpc: () => ({ data: [], error: null }) });
    const result = await pruneGenerationEvents(service);
    expect(remove).not.toHaveBeenCalled();
    expect(result.rowsDeleted).toBe(0);
  });

  it("chunks large deletions", async () => {
    const data = Array.from({ length: 250 }, (_, i) => ({
      deleted_thumb_path: `k${i}.webp`,
    }));
    const { service, remove } = makeService({ rpc: () => ({ data, error: null }) });

    const result = await pruneGenerationEvents(service);

    expect(remove).toHaveBeenCalledTimes(3);
    expect(remove.mock.calls[0][0]).toHaveLength(100);
    expect(remove.mock.calls[2][0]).toHaveLength(50);
    expect(result.thumbsDeleted).toBe(250);
  });

  /**
   * The rows are already gone by this point, so a storage failure cannot be
   * undone — it is counted and reported rather than thrown, and the run still
   * reports the rows it did delete.
   */
  it("counts orphans when storage refuses", async () => {
    const { service } = makeService({
      rpc: () => ({ data: [{ deleted_thumb_path: "a.webp" }], error: null }),
      remove: () => ({ error: { message: "bucket missing" } }),
    });

    const result = await pruneGenerationEvents(service);

    expect(result.rowsDeleted).toBe(1);
    expect(result.thumbsDeleted).toBe(0);
    expect(result.thumbsOrphaned).toBe(1);
    expect(result.failed).toBeNull();
  });

  it("reports an rpc failure instead of throwing", async () => {
    const { service, remove } = makeService({
      rpc: () => ({ data: null, error: { message: "permission denied" } }),
    });

    const result = await pruneGenerationEvents(service);

    expect(result.failed).toBe("permission denied");
    expect(remove).not.toHaveBeenCalled();
  });

  it("clamps a dangerous retention request before it reaches SQL", async () => {
    const { service, rpc } = makeService();
    await pruneGenerationEvents(service, { days: 0 });
    expect(rpc).toHaveBeenCalledWith("prune_generation_events", { p_days: 7 });
  });
});

describe("runMaintenance", () => {
  it("runs all three jobs and reports them separately", async () => {
    const { service, rpc } = makeService({
      rpc: (fn) => {
        if (fn === "sweep_stale_pending_charges") {
          return { data: [{ user_id: "a", charged: 4, runs: 1, shortfall: 0 }], error: null };
        }
        if (fn === "sweep_abandoned_runs") {
          return {
            data: [{ run_id: "r1", user_id: "a", charged: 2, runs: 1, shortfall: 0 }],
            error: null,
          };
        }
        return { data: [{ deleted_thumb_path: "a.webp" }], error: null };
      },
    });

    const result = await runMaintenance(service);

    expect(rpc).toHaveBeenCalledTimes(3);
    expect(result.settle.charged).toBe(4);
    expect(result.runs.runs).toBe(1);
    expect(result.runs.charged).toBe(2);
    expect(result.prune.rowsDeleted).toBe(1);
  });

  /**
   * A closed tab leaves a run at 'running' forever. Left alone those rows
   * permanently inflate the history page's run counts with runs that are
   * neither successes nor failures.
   */
  it("closes abandoned runs and totals what they still owed", async () => {
    const { service, rpc } = makeService({
      rpc: (fn) =>
        fn === "sweep_abandoned_runs"
          ? {
              data: [
                { run_id: "r1", user_id: "a", charged: 5, runs: 2, shortfall: 0 },
                { run_id: "r2", user_id: "b", charged: 0, runs: 0, shortfall: 0 },
              ],
              error: null,
            }
          : { data: [], error: null },
    });

    const result = await sweepAbandonedRuns(service);

    expect(result).toEqual({
      runs: 2,
      charged: 5,
      nodeRuns: 2,
      shortfall: 0,
      failed: null,
    });
    expect(rpc).toHaveBeenCalledWith("sweep_abandoned_runs", {
      p_minutes: 60,
      p_limit: 500,
    });
  });

  // Same staleness argument as the charge sweep: closing a run that is still
  // going would settle a live workflow mid-flight.
  it("clamps the staleness window before it reaches SQL", async () => {
    const { service, rpc } = makeService({ rpc: () => ({ data: [], error: null }) });
    await sweepAbandonedRuns(service, { minutes: 0, limit: 99999 });
    expect(rpc).toHaveBeenCalledWith("sweep_abandoned_runs", {
      p_minutes: 1,
      p_limit: 5000,
    });
  });

  it("reports an abandoned-run failure instead of throwing", async () => {
    const { service } = makeService({
      rpc: () => ({ data: null, error: { message: "deadlock" } }),
    });
    const result = await sweepAbandonedRuns(service);
    expect(result.failed).toBe("deadlock");
    expect(result.runs).toBe(0);
  });

  it("treats no abandoned runs as a clean no-op", async () => {
    const { service } = makeService({ rpc: () => ({ data: [], error: null }) });
    expect(await sweepAbandonedRuns(service)).toMatchObject({
      runs: 0,
      charged: 0,
      failed: null,
    });
  });

  /**
   * One broken job must not hide the other. A prune that fails while settling
   * works is exactly the state where an operator needs both facts.
   */
  it("still runs the prune when the settle sweep fails", async () => {
    const { service } = makeService({
      rpc: (fn) =>
        fn === "sweep_stale_pending_charges"
          ? { data: null, error: { message: "deadlock" } }
          : { data: [{ deleted_thumb_path: null }], error: null },
    });

    const result = await runMaintenance(service);

    expect(result.settle.failed).toBe("deadlock");
    expect(result.prune.failed).toBeNull();
    expect(result.prune.rowsDeleted).toBe(1);
  });
});
