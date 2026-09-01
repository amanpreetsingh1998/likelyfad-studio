/**
 * The card's whole job is to never quote a number it cannot back.
 *
 * Three states have to stay visually distinguishable: a measured figure from a
 * run that really happened, an estimate derived from the graph, and no figure
 * at all. The failure mode this file guards is the third and second silently
 * rendering as the first — a "0" or an unlabelled prediction that a user reads
 * as what their workflow costs.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { WorkflowHistoryEntry } from "@/lib/workflows/history";
import { HistoryCard } from "../HistoryCard";

function entry(overrides: Partial<WorkflowHistoryEntry> = {}): WorkflowHistoryEntry {
  return {
    projectId: "wf_1_abc",
    title: "Product shot",
    description: null,
    nodeCount: 6,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-20T00:00:00Z",
    runCount: 7,
    successCount: 6,
    failedCount: 1,
    lastRunAt: "2026-08-28T10:00:00Z",
    lastRunStatus: "completed",
    lastSuccess: {
      at: "2026-08-28T10:01:18Z",
      credits: 42,
      durationMs: 78000,
      models: ["nano-banana-pro", "gpt-4.1-mini"],
    },
    creditsRange: { min: 38, max: 61 },
    estimate: {
      credits: 38,
      durationMs: 120000,
      partial: false,
      models: ["nano-banana-pro"],
    },
    ...overrides,
  };
}

function renderCard(e: WorkflowHistoryEntry) {
  return render(
    <HistoryCard entry={e} onOpen={vi.fn()} onOpenRuns={vi.fn()} />
  );
}

describe("a workflow with a successful run", () => {
  it("shows the measured cost, not the estimate", () => {
    renderCard(entry());
    expect(screen.getByText("42 credits")).toBeTruthy();
    expect(screen.queryByText(/~38 credits/)).toBeNull();
  });

  it("dates the figure, so it reads as one run rather than an average", () => {
    renderCard(entry());
    expect(screen.getByText(/last run 28 Aug/)).toBeTruthy();
  });

  it("shows the range, so one number does not imply it describes them all", () => {
    renderCard(entry());
    expect(screen.getByText(/ranged 38–61 across 6 runs/)).toBeTruthy();
  });

  it("omits the range when every successful run cost the same", () => {
    renderCard(entry({ creditsRange: null }));
    expect(screen.queryByText(/ranged/)).toBeNull();
  });

  it("shows wall clock in workflow units, not node units", () => {
    renderCard(entry());
    // 78 000 ms. "78.0s" would be the node-level formatter's answer.
    expect(screen.getByText("1m 18s")).toBeTruthy();
    expect(screen.getByText("wall clock")).toBeTruthy();
  });

  it("shows the models the run actually used, not the graph's", () => {
    renderCard(entry());
    expect(screen.getByText("gpt-4.1-mini")).toBeTruthy();
    expect(screen.queryByText("from the graph")).toBeNull();
  });
});

describe("a workflow that has never run", () => {
  const never = entry({
    runCount: 0,
    successCount: 0,
    failedCount: 0,
    lastRunAt: null,
    lastRunStatus: null,
    lastSuccess: null,
    creditsRange: null,
  });

  // The estimate must be reachable — it is the only figure available — but it
  // must never be mistaken for a measurement.
  it("falls back to the estimate and marks it as one", () => {
    renderCard(never);
    expect(screen.getByText("~38 credits")).toBeTruthy();
    expect(screen.getAllByText("estimate").length).toBeGreaterThan(0);
  });

  it("says the workflow has not run rather than showing zero runs", () => {
    renderCard(never);
    expect(screen.getByText("Not run yet")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  it("labels graph-derived models as such", () => {
    renderCard(never);
    expect(screen.getByText("from the graph")).toBeTruthy();
  });
});

describe("a workflow that has run but never succeeded", () => {
  // Distinct from "never run", and the more actionable of the two.
  const failing = entry({
    runCount: 4,
    successCount: 0,
    failedCount: 4,
    lastRunStatus: "failed",
    lastSuccess: null,
    creditsRange: null,
    estimate: { credits: 0, durationMs: 0, partial: false, models: [] },
  });

  it("does not claim the workflow has never been run", () => {
    renderCard(failing);
    expect(screen.getByText("No successful run")).toBeTruthy();
  });

  it("says how many runs did not finish", () => {
    renderCard(failing);
    expect(screen.getByText(/4 of 4 did not finish/)).toBeTruthy();
  });

  it("still offers the run list, which is where the failures are", () => {
    const onOpenRuns = vi.fn();
    render(
      <HistoryCard entry={failing} onOpen={vi.fn()} onOpenRuns={onOpenRuns} />
    );
    fireEvent.click(screen.getByText("4"));
    expect(onOpenRuns).toHaveBeenCalled();
  });
});

describe("an estimate that could not be completed", () => {
  const partial = entry({
    runCount: 0,
    successCount: 0,
    failedCount: 0,
    lastRunAt: null,
    lastSuccess: null,
    creditsRange: null,
    estimate: {
      credits: 38,
      durationMs: 120000,
      partial: true,
      models: ["nano-banana-pro", "fal-ai/mystery"],
    },
  });

  // Mirrors the 409 unpriced_model refusal: a floor, stated as a floor.
  it("says 'at least' rather than quoting a total it cannot back", () => {
    renderCard(partial);
    expect(screen.getByText("at least 38 credits")).toBeTruthy();
    expect(screen.queryByText("~38 credits")).toBeNull();
  });

  it("says which part it could not price", () => {
    renderCard(partial);
    expect(screen.getByText("partial estimate")).toBeTruthy();
    expect(screen.getByText("some models unpriced")).toBeTruthy();
  });
});

describe("the subtitle", () => {
  it("prefers what the user wrote", () => {
    renderCard(entry({ description: "Shots for the autumn catalogue" }));
    expect(screen.getByText("Shots for the autumn catalogue")).toBeTruthy();
  });

  // Derived on read, never stored, so it cannot go stale against an edit.
  it("derives a line when there is no description", () => {
    renderCard(entry({ description: null }));
    expect(screen.getByText(/6 nodes/)).toBeTruthy();
  });

  it("falls back to a phrase rather than an empty line", () => {
    renderCard(
      entry({
        description: null,
        nodeCount: 0,
        lastSuccess: null,
        estimate: { credits: 0, durationMs: 0, partial: false, models: [] },
      })
    );
    expect(screen.getByText("No description")).toBeTruthy();
  });
});

describe("models", () => {
  it("caps the chips and counts the rest", () => {
    renderCard(
      entry({
        lastSuccess: {
          at: "2026-08-28T10:01:18Z",
          credits: 42,
          durationMs: 78000,
          models: ["a", "b", "c", "d", "e"],
        },
      })
    );
    expect(screen.getByText("+2")).toBeTruthy();
  });

  // The provider prefix is identical on every chip, so it spends width
  // without distinguishing anything. The full id stays in the title.
  it("trims the provider prefix but keeps it in the tooltip", () => {
    renderCard(
      entry({
        lastSuccess: {
          at: "2026-08-28T10:01:18Z",
          credits: 42,
          durationMs: 78000,
          models: ["fal-ai/flux-pro"],
        },
      })
    );
    const chip = screen.getByTitle("fal-ai/flux-pro");
    expect(chip.textContent).toBe("flux-pro");
  });

  it("says none rather than showing an empty row", () => {
    renderCard(
      entry({
        lastSuccess: null,
        estimate: { credits: 0, durationMs: 0, partial: false, models: [] },
      })
    );
    expect(screen.getByText("None yet")).toBeTruthy();
  });
});

describe("opening a workflow", () => {
  it("hands the canvas the workflow the card names", () => {
    const onOpen = vi.fn();
    render(
      <HistoryCard entry={entry()} onOpen={onOpen} onOpenRuns={vi.fn()} />
    );
    fireEvent.click(screen.getByText("Open"));
    expect(onOpen).toHaveBeenCalled();
  });
});
