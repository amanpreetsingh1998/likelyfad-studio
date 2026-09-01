/**
 * Four states render as "nothing on screen", and three of them are different
 * facts. The one that must never be mistaken for the others is a failed read:
 * telling a user they have no workflows when the query broke is the single
 * most alarming thing this page could do.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { WorkflowHistoryEntry, WorkflowHistoryPage } from "@/lib/workflows/history";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// The drawer fetches on mount; it has its own tests.
vi.mock("../RunDrawer", () => ({
  RunDrawer: ({ projectId }: { projectId: string }) => (
    <div data-testid="run-drawer">{projectId}</div>
  ),
}));

import { HistoryList } from "../HistoryList";

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
      models: ["nano-banana-pro"],
    },
    creditsRange: null,
    estimate: { credits: 38, durationMs: 120000, partial: false, models: [] },
    ...overrides,
  };
}

function page(overrides: Partial<WorkflowHistoryPage> = {}): WorkflowHistoryPage {
  return { entries: [entry()], total: 1, failed: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => page(),
  } as Response));
});

describe("the four empty-ish states", () => {
  it("paints the seeded page without fetching again", () => {
    render(<HistoryList initial={page()} initialSearch="" />);
    expect(screen.getByText("Product shot")).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  // The one that matters most.
  it("says a failed read is our fault, not an empty account", () => {
    render(
      <HistoryList
        initial={{ entries: [], total: 0, failed: "permission denied" }}
        initialSearch=""
      />
    );
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.getByText(/not an empty account/i)).toBeTruthy();
    expect(screen.queryByText(/no saved workflows yet/i)).toBeNull();
  });

  it("offers a way forward to a genuinely new account", () => {
    render(
      <HistoryList initial={{ entries: [], total: 0, failed: null }} initialSearch="" />
    );
    expect(screen.getByText(/no saved workflows yet/i)).toBeTruthy();
  });

  it("distinguishes a filter that matched nothing from an empty account", () => {
    render(
      <HistoryList
        initial={{ entries: [], total: 0, failed: null }}
        initialSearch="banana"
      />
    );
    expect(screen.getByText(/No workflow matches/)).toBeTruthy();
    expect(screen.queryByText(/no saved workflows yet/i)).toBeNull();
  });
});

describe("search and sort", () => {
  it("debounces the search into one request", async () => {
    render(<HistoryList initial={page()} initialSearch="" />);
    const box = screen.getByLabelText("Search workflows");

    fireEvent.change(box, { target: { value: "p" } });
    fireEvent.change(box, { target: { value: "pr" } });
    fireEvent.change(box, { target: { value: "pro" } });

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain("q=pro");
  });

  it("asks for a column, never a direction", async () => {
    render(<HistoryList initial={page()} initialSearch="" />);
    fireEvent.change(screen.getByLabelText("Sort"), { target: { value: "cost" } });

    await waitFor(() => expect(fetch).toHaveBeenCalled(), { timeout: 2000 });
    const url = String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(url).toContain("sort=cost");
    expect(url).not.toContain("dir=");
    expect(url).not.toContain("order=");
  });

  // Otherwise page 3 of "everything" becomes page 3 of a filter with one match.
  it("returns to the first page when the filter changes", async () => {
    render(
      <HistoryList
        initial={{ entries: [entry()], total: 100, failed: null }}
        initialSearch=""
      />
    );
    fireEvent.click(screen.getByText("Next"));
    await waitFor(() => expect(fetch).toHaveBeenCalled(), { timeout: 2000 });
    (fetch as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.change(screen.getByLabelText("Search workflows"), {
      target: { value: "shot" },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalled(), { timeout: 2000 });
    expect(String((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain(
      "offset=0"
    );
  });

  it("reports a fetch that failed through the same channel as the server's", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("offline"));
    render(<HistoryList initial={page()} initialSearch="" />);
    fireEvent.change(screen.getByLabelText("Search workflows"), {
      target: { value: "x" },
    });
    await waitFor(
      () => expect(screen.getByText(/could not be loaded/i)).toBeTruthy(),
      { timeout: 2000 }
    );
  });
});

describe("paging", () => {
  it("hides the pager when everything fits", () => {
    render(<HistoryList initial={page()} initialSearch="" />);
    expect(screen.queryByText("Next")).toBeNull();
  });

  it("shows the pager and the position when it does not", () => {
    render(
      <HistoryList
        initial={{ entries: [entry()], total: 100, failed: null }}
        initialSearch=""
      />
    );
    expect(screen.getByText(/1–1 of 100/)).toBeTruthy();
    expect(screen.getByText("Next")).toBeTruthy();
  });

  it("cannot go back from the first page", () => {
    render(
      <HistoryList
        initial={{ entries: [entry()], total: 100, failed: null }}
        initialSearch=""
      />
    );
    expect(screen.getByText("Previous").hasAttribute("disabled")).toBe(true);
  });
});

describe("opening things", () => {
  it("navigates to the canvas with the workflow named in the URL", () => {
    render(<HistoryList initial={page()} initialSearch="" />);
    fireEvent.click(screen.getByText("Open"));
    expect(mockPush).toHaveBeenCalledWith("/?project=wf_1_abc");
  });

  it("opens the run drawer for the workflow whose count was clicked", () => {
    render(<HistoryList initial={page()} initialSearch="" />);
    fireEvent.click(screen.getByText("7"));
    expect(screen.getByTestId("run-drawer").textContent).toBe("wf_1_abc");
  });
});
