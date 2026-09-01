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
let updateResult: { error: unknown };

function stubSupabase() {
  mockGetServiceClient.mockReturnValue({
    from: () => ({
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
          maybeSingle: async () => selectResult,
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
