/**
 * The drawer is where the card's single headline number stops being a claim
 * about every run. So the things worth pinning are: that the variance is
 * actually shown, that a run still in flight is not reported as free, and that
 * `abandoned` is not quietly relabelled as something the user chose to do.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { WorkflowRunEntry } from "@/lib/workflows/history";
import { RunDrawer } from "../RunDrawer";

function run(overrides: Partial<WorkflowRunEntry> = {}): WorkflowRunEntry {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    status: "completed",
    startedAt: "2026-08-28T10:00:00Z",
    finishedAt: "2026-08-28T10:01:18Z",
    durationMs: 78000,
    creditsCharged: 42,
    shortfall: 0,
    nodeCount: 6,
    models: ["nano-banana-pro"],
    eventsTotal: 6,
    eventsFailed: 0,
    ...overrides,
  };
}

function stubFetch(body: unknown, ok = true, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok, status, json: async () => body } as Response)
  );
}

function open() {
  return render(
    <RunDrawer projectId="wf_1_abc" title="Product shot" onClose={vi.fn()} />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reading the runs", () => {
  it("asks for the workflow in the path", async () => {
    stubFetch({ runs: [], total: 0, failed: null });
    open();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toBe(
      "/api/workflows/wf_1_abc/runs"
    );
  });

  it("shows each run with its cost and wall clock", async () => {
    stubFetch({
      title: "Product shot",
      runs: [run(), run({ id: "b", creditsCharged: 61, durationMs: 122000 })],
      total: 2,
      failed: null,
    });
    open();
    await waitFor(() => expect(screen.getByText("42")).toBeTruthy());
    // The variance the card's single figure hides.
    expect(screen.getByText("61")).toBeTruthy();
    expect(screen.getByText("1m 18s")).toBeTruthy();
    expect(screen.getByText("2m 2s")).toBeTruthy();
  });

  it("says a workflow has no runs rather than showing an empty table", async () => {
    stubFetch({ runs: [], total: 0, failed: null });
    open();
    await waitFor(() =>
      expect(screen.getByText(/has not been run yet/i)).toBeTruthy()
    );
  });

  // "No runs" and "we could not read the runs" must not look alike.
  it("reports a failed read as a failure", async () => {
    stubFetch({ runs: [], total: 0, failed: "permission denied" });
    open();
    await waitFor(() =>
      expect(screen.getByText(/could not be read/i)).toBeTruthy()
    );
    expect(screen.queryByText(/has not been run yet/i)).toBeNull();
  });

  it("explains a 404 as a deleted workflow rather than a raw status", async () => {
    stubFetch({ error: "Workflow not found" }, false, 404);
    open();
    await waitFor(() =>
      expect(screen.getByText(/no longer exists/i)).toBeTruthy()
    );
  });

  it("survives the network going away", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    open();
    await waitFor(() => expect(screen.getByText(/offline/i)).toBeTruthy());
  });
});

describe("figures that are absent rather than zero", () => {
  it("does not report an unsettled run as free", async () => {
    stubFetch({
      runs: [run({ status: "running", finishedAt: null, durationMs: null, creditsCharged: null })],
      total: 1,
      failed: null,
    });
    open();
    await waitFor(() => expect(screen.getByText("running")).toBeTruthy());
    expect(screen.queryByText("0")).toBeNull();
  });

  it("flags credits a balance could not cover", async () => {
    stubFetch({
      runs: [run({ creditsCharged: 10, shortfall: 5 })],
      total: 1,
      failed: null,
    });
    open();
    await waitFor(() => expect(screen.getByText(/\+5 owed/)).toBeTruthy());
  });

  it("counts the nodes that failed inside an otherwise fine run", async () => {
    stubFetch({
      runs: [run({ eventsFailed: 2 })],
      total: 1,
      failed: null,
    });
    open();
    await waitFor(() => expect(screen.getByText("2 failed")).toBeTruthy());
  });
});

describe("statuses", () => {
  // Abandoned is not a decision the user made; cancelled is. Collapsing them
  // would tell someone they stopped a run they did not stop.
  it("keeps abandoned distinct from cancelled, and explains it", async () => {
    stubFetch({
      runs: [
        run({ id: "a", status: "abandoned" }),
        run({ id: "b", status: "cancelled" }),
      ],
      total: 2,
      failed: null,
    });
    open();
    await waitFor(() => expect(screen.getByText("abandoned")).toBeTruthy());
    expect(screen.getByText("cancelled")).toBeTruthy();
    expect(
      screen.getByText("abandoned").getAttribute("title")
    ).toMatch(/never reported how this run ended/i);
  });

  it("explains that a cancelled run still paid for what dispatched", async () => {
    stubFetch({ runs: [run({ status: "cancelled" })], total: 1, failed: null });
    open();
    await waitFor(() => expect(screen.getByText("cancelled")).toBeTruthy());
    expect(screen.getByText("cancelled").getAttribute("title")).toMatch(
      /still charged/i
    );
  });
});

describe("pruned events", () => {
  // The reason cost and duration are stored on the run row and not recomputed.
  it("explains an empty model list on a run that did reach providers", async () => {
    stubFetch({
      runs: [run({ models: [], eventsTotal: 4 })],
      total: 1,
      failed: null,
    });
    open();
    await waitFor(() => expect(screen.getByText("42")).toBeTruthy());
    const cell = screen.getByTitle(/retention window/i);
    expect(cell).toBeTruthy();
  });
});

describe("closing", () => {
  it("closes on Escape", async () => {
    stubFetch({ runs: [], total: 0, failed: null });
    const onClose = vi.fn();
    render(
      <RunDrawer projectId="wf_1_abc" title="Product shot" onClose={onClose} />
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("names the workflow before the fetch lands", () => {
    stubFetch({ runs: [], total: 0, failed: null });
    open();
    expect(screen.getByText("Product shot")).toBeTruthy();
  });
});
