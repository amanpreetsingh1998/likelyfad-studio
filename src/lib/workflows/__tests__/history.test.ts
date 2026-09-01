/**
 * The history reader turns SQL rows into the two kinds of number the page
 * shows, and the whole feature turns on never confusing them: a measured cost
 * from a run that happened, and an estimate derived from the graph.
 *
 * The other rule under test is that a broken read never arrives looking like
 * an empty account.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listWorkflowHistory, listWorkflowRuns } from "../history";

const RUN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

let rpc: ReturnType<typeof vi.fn>;

function client(): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

/** A row as the SQL function returns it, with the fields under test overridden. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    project_id: "wf_1_abc",
    title: "Product shot",
    description: null,
    node_count: 6,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-20T00:00:00Z",
    est_credits: 38,
    est_duration_ms: 120000,
    est_partial: false,
    est_models: ["nano-banana"],
    run_count: 7,
    success_count: 6,
    failed_count: 1,
    last_run_at: "2026-08-28T10:00:00Z",
    last_run_status: "completed",
    last_success_at: "2026-08-28T10:01:18Z",
    last_success_credits: 42,
    last_success_duration_ms: 78000,
    last_success_models: ["nano-banana", "gpt-4.1-mini"],
    credits_min: 38,
    credits_max: 61,
    total_count: 1,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  rpc = vi.fn();
});

describe("listWorkflowHistory", () => {
  it("reads through the caller's client so auth.uid() has someone to be", async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });
    await listWorkflowHistory(client(), { q: "shot", sort: "cost" });
    expect(rpc).toHaveBeenCalledWith("user_workflow_history", {
      p_limit: 25,
      p_offset: 0,
      p_q: "shot",
      p_sort: "cost",
    });
  });

  it("reports the measured cost of the last successful run", async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });
    const { entries } = await listWorkflowHistory(client());
    expect(entries[0].lastSuccess).toEqual({
      at: "2026-08-28T10:01:18Z",
      credits: 42,
      durationMs: 78000,
      models: ["nano-banana", "gpt-4.1-mini"],
    });
  });

  // The distinction the page turns on: no measured figure means the UI must
  // fall back to the estimate AND say that is what it is doing.
  it("reports no measured figure at all when nothing has succeeded", async () => {
    rpc.mockResolvedValue({
      data: [
        row({
          last_success_at: null,
          last_success_credits: null,
          last_success_duration_ms: null,
          last_success_models: [],
          success_count: 0,
        }),
      ],
      error: null,
    });
    const { entries } = await listWorkflowHistory(client());
    expect(entries[0].lastSuccess).toBeNull();
    // The estimate is still carried, for the UI to label as an estimate.
    expect(entries[0].estimate.credits).toBe(38);
  });

  it("carries the partial-estimate flag rather than silently totalling", async () => {
    rpc.mockResolvedValue({ data: [row({ est_partial: true })], error: null });
    const { entries } = await listWorkflowHistory(client());
    expect(entries[0].estimate.partial).toBe(true);
  });

  it("reports a range only when successful runs actually disagree", async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });
    expect((await listWorkflowHistory(client())).entries[0].creditsRange).toEqual({
      min: 38,
      max: 61,
    });
  });

  // "38–38" says nothing and invites the reader to think two runs differed.
  it("reports no range when every successful run cost the same", async () => {
    rpc.mockResolvedValue({
      data: [row({ credits_min: 42, credits_max: 42 })],
      error: null,
    });
    expect((await listWorkflowHistory(client())).entries[0].creditsRange).toBeNull();
  });

  it("takes the total from the window function", async () => {
    rpc.mockResolvedValue({
      data: [row({ total_count: 137 }), row({ total_count: 137 })],
      error: null,
    });
    expect((await listWorkflowHistory(client())).total).toBe(137);
  });

  it("reports zero total for an account with no workflows", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const page = await listWorkflowHistory(client());
    expect(page).toEqual({ entries: [], total: 0, failed: null });
  });

  // The case that must never look like the case above.
  it("reports a failed read instead of an empty account", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { message: 'function "user_workflow_history" does not exist' },
    });
    const page = await listWorkflowHistory(client());
    expect(page.entries).toEqual([]);
    expect(page.failed).toContain("does not exist");
  });

  it("clamps a limit that would ask for the whole table", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await listWorkflowHistory(client(), { limit: 10000 });
    expect(rpc.mock.calls[0][1].p_limit).toBe(100);
  });

  it("refuses a negative offset and a zero limit", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await listWorkflowHistory(client(), { limit: 0, offset: -5 });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_limit: 1, p_offset: 0 });
  });

  it("names an untitled workflow rather than rendering a blank row", async () => {
    rpc.mockResolvedValue({ data: [row({ title: null })], error: null });
    expect((await listWorkflowHistory(client())).entries[0].title).toBe(
      "Untitled workflow"
    );
  });

  it("survives a null model array from a run whose events were pruned", async () => {
    rpc.mockResolvedValue({
      data: [row({ last_success_models: null, est_models: null })],
      error: null,
    });
    const entry = (await listWorkflowHistory(client())).entries[0];
    expect(entry.lastSuccess?.models).toEqual([]);
    expect(entry.estimate.models).toEqual([]);
  });
});

describe("listWorkflowRuns", () => {
  it("asks for one workflow's runs", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await listWorkflowRuns(client(), "wf_1_abc", { limit: 10, offset: 20 });
    expect(rpc).toHaveBeenCalledWith("workflow_run_history", {
      p_project_id: "wf_1_abc",
      p_limit: 10,
      p_offset: 20,
    });
  });

  it("maps a run row", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: RUN,
          status: "completed",
          started_at: "2026-08-28T10:00:00Z",
          finished_at: "2026-08-28T10:01:18Z",
          duration_ms: 78000,
          credits_charged: 42,
          shortfall: 0,
          node_count: 6,
          models: ["nano-banana"],
          events_total: 6,
          events_failed: 0,
          total_count: 1,
        },
      ],
      error: null,
    });
    const { runs, total } = await listWorkflowRuns(client(), "wf_1_abc");
    expect(total).toBe(1);
    expect(runs[0]).toMatchObject({
      id: RUN,
      status: "completed",
      durationMs: 78000,
      creditsCharged: 42,
      eventsTotal: 6,
    });
  });

  // A run still going has no duration yet. Showing 0 would read as instant.
  it("leaves an unfinished run's duration null", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          id: RUN,
          status: "running",
          started_at: "2026-08-28T10:00:00Z",
          finished_at: null,
          duration_ms: null,
          credits_charged: null,
          total_count: 1,
        },
      ],
      error: null,
    });
    const { runs } = await listWorkflowRuns(client(), "wf_1_abc");
    expect(runs[0].durationMs).toBeNull();
    expect(runs[0].creditsCharged).toBeNull();
  });

  it("reports a failed read rather than an empty run list", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    const page = await listWorkflowRuns(client(), "wf_1_abc");
    expect(page.runs).toEqual([]);
    expect(page.failed).toBe("permission denied");
  });
});
