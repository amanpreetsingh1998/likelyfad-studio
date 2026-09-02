/**
 * A run row is the join target that makes "what did this workflow cost"
 * answerable, so the cases that matter are the ones where it would attribute a
 * run to the wrong account, or where a failure to record history would be
 * allowed to stop someone working.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetServiceClient } = vi.hoisted(() => ({
  mockGetServiceClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: mockGetServiceClient,
}));

import {
  finishRun,
  normaliseRunStatus,
  runBelongsTo,
  startRun,
} from "../runs";

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const RUN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

let inserted: Record<string, unknown> | null;
let updated: Record<string, unknown> | null;
let updateFilters: Record<string, unknown>;
let insertResult: { data: unknown; error: unknown };
let selectResult: { data: unknown; error: unknown };
/** What the `projects` lookup in resolveProjectId sees. */
let projectResult: { data: unknown; error: unknown };
let updateResult: { error: unknown };

function stubSupabase() {
  mockGetServiceClient.mockReturnValue({
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserted = row;
        return { select: () => ({ single: async () => insertResult }) };
      },
      update: (row: Record<string, unknown>) => {
        updated = row;
        const chain = {
          eq: (col: string, val: unknown) => {
            updateFilters[col] = val;
            return chain;
          },
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve(updateResult).then(resolve),
        };
        return chain;
      },
      select: () => {
        const chain = {
          eq: () => chain,
          maybeSingle: async () =>
            table === "projects" ? projectResult : selectResult,
        };
        return chain;
      },
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  inserted = null;
  updated = null;
  updateFilters = {};
  insertResult = { data: { id: RUN }, error: null };
  selectResult = { data: { user_id: USER }, error: null };
  projectResult = {
    data: { user_id: USER, is_published: false, deleted_at: null },
    error: null,
  };
  updateResult = { error: null };
  stubSupabase();
});

describe("startRun", () => {
  it("returns the id the server minted", async () => {
    expect(await startRun({ userId: USER })).toBe(RUN);
  });

  it("stamps the verified user id on the row", async () => {
    await startRun({ userId: USER, projectId: "wf_1_abc" });
    expect(inserted).toMatchObject({
      user_id: USER,
      project_id: "wf_1_abc",
      status: "running",
    });
  });

  it("snapshots the project name, so a rename cannot rewrite history", async () => {
    await startRun({ userId: USER, projectName: "  Product shot  " });
    expect(inserted?.project_name).toBe("Product shot");
  });

  it("stores no name rather than an empty one", async () => {
    await startRun({ userId: USER, projectName: "   " });
    expect(inserted?.project_name).toBeNull();
  });

  it("clamps a pathological name instead of storing a document", async () => {
    await startRun({ userId: USER, projectName: "x".repeat(500) });
    expect((inserted?.project_name as string).length).toBe(200);
  });

  it("floors a fractional node count and refuses a negative one", async () => {
    await startRun({ userId: USER, nodeCount: 7.9 });
    expect(inserted?.node_count).toBe(7);
    await startRun({ userId: USER, nodeCount: -3 });
    expect(inserted?.node_count).toBe(0);
  });

  it("ignores a node count that is not a number", async () => {
    await startRun({ userId: USER, nodeCount: NaN });
    expect(inserted?.node_count).toBeNull();
  });

  // The load-bearing case: history must never be able to stop a user working.
  it("returns null rather than throwing when the row cannot be written", async () => {
    insertResult = { data: null, error: { message: "relation does not exist" } };
    expect(await startRun({ userId: USER })).toBeNull();
  });

  it("returns null when the client itself throws", async () => {
    mockGetServiceClient.mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
    });
    expect(await startRun({ userId: USER })).toBeNull();
  });
});

/**
 * The project id arrives in a request body and this row is written through the
 * service client, so RLS is protecting nothing here. An id the caller has no
 * business naming must not reach the row: the run feed joins it back to
 * `projects` to title the row, which turns a forged id into a read of another
 * account's workflow name and an existence oracle for any id at all.
 *
 * Refusal is silent and costs nothing — the run still opens, still bills and
 * still settles, and simply reads as an unsaved workflow.
 */
describe("startRun — project attribution", () => {
  it("stores an id the caller owns", async () => {
    await startRun({ userId: USER, projectId: "wf_1_abc" });
    expect(inserted?.project_id).toBe("wf_1_abc");
  });

  // The leak this check exists to close.
  it("refuses another user's private workflow, and still opens the run", async () => {
    projectResult = {
      data: { user_id: OTHER, is_published: false, deleted_at: null },
      error: null,
    };
    expect(await startRun({ userId: USER, projectId: "wf_seed_1" })).toBe(RUN);
    expect(inserted?.project_id).toBeNull();
  });

  // /workflows/[id]/run is the only surface a non-admin has, and every run
  // made there is against a workflow somebody else owns. Refusing these would
  // strand all of them on the feed as "Unsaved workflow".
  it("accepts another user's PUBLISHED workflow", async () => {
    projectResult = {
      data: { user_id: OTHER, is_published: true, deleted_at: null },
      error: null,
    };
    await startRun({ userId: USER, projectId: "wf_seed_1" });
    expect(inserted?.project_id).toBe("wf_seed_1");
  });

  it("refuses a published workflow that has been soft-deleted", async () => {
    projectResult = {
      data: {
        user_id: OTHER,
        is_published: true,
        deleted_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    };
    await startRun({ userId: USER, projectId: "wf_seed_1" });
    expect(inserted?.project_id).toBeNull();
  });

  // Owning it is the question being asked. Whether it is still somewhere to
  // navigate to is the feed's own, answered by project_exists.
  it("keeps the caller's own workflow even once soft-deleted", async () => {
    projectResult = {
      data: {
        user_id: USER,
        is_published: false,
        deleted_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    };
    await startRun({ userId: USER, projectId: "wf_1_abc" });
    expect(inserted?.project_id).toBe("wf_1_abc");
  });

  it("stores nothing for an id that names no workflow", async () => {
    projectResult = { data: null, error: null };
    await startRun({ userId: USER, projectId: "wf_nope" });
    expect(inserted?.project_id).toBeNull();
  });

  // A failed lookup is not a reason to trust an unverified id.
  it("fails closed when the lookup errors", async () => {
    projectResult = { data: null, error: { message: "timeout" } };
    await startRun({ userId: USER, projectId: "wf_1_abc" });
    expect(inserted?.project_id).toBeNull();
  });

  it("does not go looking when no id was supplied", async () => {
    await startRun({ userId: USER });
    expect(inserted?.project_id).toBeNull();
    await startRun({ userId: USER, projectId: "   " });
    expect(inserted?.project_id).toBeNull();
  });
});

describe("finishRun", () => {
  it("filters on the pair, never the run id alone", async () => {
    await finishRun(USER, RUN, "completed");
    expect(updateFilters).toMatchObject({ id: RUN, user_id: USER });
  });

  it("only closes a run that is still running, so a re-close cannot reopen it", async () => {
    await finishRun(USER, RUN, "cancelled");
    expect(updateFilters.status).toBe("running");
    expect(updated).toMatchObject({ status: "cancelled" });
  });

  it("reports failure without throwing", async () => {
    updateResult = { error: { message: "boom" } };
    expect(await finishRun(USER, RUN, "failed")).toBe(false);
  });
});

describe("runBelongsTo", () => {
  it("passes only when the owner matches the caller", async () => {
    expect(await runBelongsTo(USER, RUN)).toBe(true);
  });

  // "A row came back" is not a pass — this is the check that stops one user
  // filing charges against another user's run.
  it("refuses a run owned by someone else", async () => {
    selectResult = { data: { user_id: OTHER }, error: null };
    expect(await runBelongsTo(USER, RUN)).toBe(false);
  });

  it("refuses when no row exists", async () => {
    selectResult = { data: null, error: null };
    expect(await runBelongsTo(USER, RUN)).toBe(false);
  });

  it("fails closed when the lookup errors", async () => {
    selectResult = { data: null, error: { message: "timeout" } };
    expect(await runBelongsTo(USER, RUN)).toBe(false);
  });
});

describe("normaliseRunStatus", () => {
  it("keeps the three statuses a client may report", () => {
    expect(normaliseRunStatus("completed")).toBe("completed");
    expect(normaliseRunStatus("failed")).toBe("failed");
    expect(normaliseRunStatus("cancelled")).toBe("cancelled");
  });

  // A run that ended must close. Rejecting an unknown label would leave the
  // row 'running' for the maintenance sweep to reopen forever.
  it("falls back to completed rather than refusing to close a run", () => {
    expect(normaliseRunStatus("abandoned")).toBe("completed");
    expect(normaliseRunStatus("' or 1=1--")).toBe("completed");
    expect(normaliseRunStatus(undefined)).toBe("completed");
    expect(normaliseRunStatus(42)).toBe("completed");
  });
});
