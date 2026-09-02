/**
 * The run feed reader.
 *
 * Three rules are under test, and each of them is a thing the page would
 * otherwise state wrongly:
 *
 *   * a broken read must not arrive looking like "you have never run
 *     anything" — the most alarming thing this page could claim;
 *   * a run with no workflow, and a run whose workflow was deleted, are
 *     different facts and neither is a blank cell;
 *   * the totals describe the filtered set, so they come off the row and are
 *     never re-derived from the page.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listUserRunHistory } from "../history";

let rpc: ReturnType<typeof vi.fn>;

function client(): SupabaseClient {
  return { rpc } as unknown as SupabaseClient;
}

/** A row as user_run_history returns it, with the fields under test overridden. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    project_id: "wf_1_abc",
    project_name: "Product shot",
    project_exists: true,
    status: "completed",
    started_at: "2026-08-28T10:00:00Z",
    finished_at: "2026-08-28T10:01:18Z",
    duration_ms: 78000,
    credits_charged: 42,
    shortfall: null,
    node_count: 6,
    models: ["nano-banana", "gpt-4.1-mini"],
    events_total: 4,
    events_failed: 0,
    total_count: 137,
    total_credits: 5821,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  rpc = vi.fn();
});

describe("listUserRunHistory", () => {
  it("reads through the caller's client so auth.uid() has someone to be", async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });

    await listUserRunHistory(client(), { status: "failed", q: "shot", offset: 25 });

    expect(rpc).toHaveBeenCalledWith("user_run_history", {
      p_limit: 25,
      p_offset: 25,
      p_status: "failed",
      p_q: "shot",
    });
  });

  it("maps a row onto the entry the table renders", async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });

    const page = await listUserRunHistory(client());

    expect(page.failed).toBeNull();
    expect(page.runs).toHaveLength(1);
    expect(page.runs[0]).toMatchObject({
      id: "11111111-1111-1111-1111-111111111111",
      projectId: "wf_1_abc",
      projectName: "Product shot",
      projectExists: true,
      status: "completed",
      durationMs: 78000,
      creditsCharged: 42,
      models: ["nano-banana", "gpt-4.1-mini"],
    });
  });

  it("reports a failed read rather than returning an empty history", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const page = await listUserRunHistory(client());

    // The distinction this whole shape exists for: an error must never be
    // indistinguishable from an account that has never run anything.
    expect(page.failed).toBe("boom");
    expect(page.runs).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.totalCredits).toBe(0);
  });

  it("keeps an empty result distinct from a failed one", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    const page = await listUserRunHistory(client());

    expect(page.failed).toBeNull();
    expect(page.runs).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("carries a run whose canvas was never saved", async () => {
    // No projects row was ever written, so the run records a null project_id.
    // It is the only place this spend is visible, so it must survive the map.
    rpc.mockResolvedValue({
      data: [row({ project_id: null, project_name: null, project_exists: false })],
      error: null,
    });

    const page = await listUserRunHistory(client());

    expect(page.runs[0].projectId).toBeNull();
    expect(page.runs[0].projectName).toBeNull();
    expect(page.runs[0].projectExists).toBe(false);
    // The money is still on the row. That is the point of keeping it.
    expect(page.runs[0].creditsCharged).toBe(42);
  });

  it("keeps the snapshot name of a workflow that has since been deleted", async () => {
    rpc.mockResolvedValue({
      data: [row({ project_exists: false })],
      error: null,
    });

    const page = await listUserRunHistory(client());

    // A name to show, but nowhere to send the reader — the cell renders it
    // without a link rather than offering one that 404s.
    expect(page.runs[0].projectName).toBe("Product shot");
    expect(page.runs[0].projectExists).toBe(false);
  });

  it("defaults projectExists to false when the flag is absent", async () => {
    rpc.mockResolvedValue({ data: [row({ project_exists: undefined })], error: null });

    const page = await listUserRunHistory(client());

    // Fails closed onto "no workflow to open": a row we could not resolve must
    // not hand out a link.
    expect(page.runs[0].projectExists).toBe(false);
  });

  it("takes the totals off the row, not from the page", async () => {
    rpc.mockResolvedValue({
      data: [row(), row({ id: "22222222-2222-2222-2222-222222222222" })],
      error: null,
    });

    const page = await listUserRunHistory(client());

    // Two rows on screen, 137 runs and 5,821 credits in the filtered set. A
    // total re-derived from the page would say 2 and 84.
    expect(page.runs).toHaveLength(2);
    expect(page.total).toBe(137);
    expect(page.totalCredits).toBe(5821);
  });

  it("keeps an unsettled charge null rather than zero", async () => {
    rpc.mockResolvedValue({
      data: [row({ status: "running", finished_at: null, duration_ms: null, credits_charged: null })],
      error: null,
    });

    const page = await listUserRunHistory(client());

    // "0 credits" says this run was free. Null says we do not have the figure
    // yet, which is the truth for a run that has not settled.
    expect(page.runs[0].creditsCharged).toBeNull();
    expect(page.runs[0].durationMs).toBeNull();
    expect(page.runs[0].finishedAt).toBeNull();
  });

  it("clamps the page size so one caller cannot ask for the whole ledger", async () => {
    rpc.mockResolvedValue({ data: [], error: null });

    await listUserRunHistory(client(), { limit: 5000, offset: -3 });

    expect(rpc).toHaveBeenCalledWith(
      "user_run_history",
      expect.objectContaining({ p_limit: 100, p_offset: 0 })
    );
  });
});
