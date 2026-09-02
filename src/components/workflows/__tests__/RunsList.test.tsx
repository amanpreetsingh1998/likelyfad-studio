/**
 * The Runs tab.
 *
 * What is worth pinning here is not the layout but the claims the table makes
 * about money and about workflows that are no longer there:
 *
 *   * a failed read must not read as "you have never run anything";
 *   * a run with no workflow, and one whose workflow was deleted, each render
 *     as themselves and neither offers a link that goes nowhere;
 *   * an unsettled run shows no charge rather than a zero, because a zero is a
 *     number a reader believes;
 *   * the totals shown are the filtered set's, not the page's.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { UserRunEntry, UserRunPage } from "@/lib/workflows/history";

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

import { RunsList } from "../RunsList";

function run(overrides: Partial<UserRunEntry> = {}): UserRunEntry {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    projectId: "wf_1_abc",
    projectName: "Product shot",
    projectExists: true,
    status: "completed",
    startedAt: "2026-08-28T10:00:00Z",
    finishedAt: "2026-08-28T10:01:18Z",
    durationMs: 78000,
    creditsCharged: 42,
    shortfall: null,
    nodeCount: 6,
    models: ["fal-ai/flux-pro/v1.1-ultra"],
    eventsTotal: 4,
    eventsFailed: 0,
    ...overrides,
  };
}

function page(overrides: Partial<UserRunPage> = {}): UserRunPage {
  return { runs: [run()], total: 1, totalCredits: 42, failed: null, ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("RunsList", () => {
  it("renders a run with its measured cost and wall clock", () => {
    render(<RunsList initial={page()} canOpenStudio />);

    // Scoped to the table: the totals strip carries the same figures for the
    // whole filtered set, and the two must not be confused for one another.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Product shot")).toBeInTheDocument();
    expect(table.getByText("completed")).toBeInTheDocument();
    expect(table.getByText("42")).toBeInTheDocument();
    expect(table.getByText("1m 18s")).toBeInTheDocument();
    // The provider prefix spends width without distinguishing anything.
    expect(table.getByText("flux-pro/v1.1-ultra")).toBeInTheDocument();
  });

  it("says the read failed instead of claiming an empty history", () => {
    render(
      <RunsList
        initial={page({ runs: [], total: 0, totalCredits: 0, failed: "boom" })}
        canOpenStudio
      />
    );

    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/have not run anything/i)).not.toBeInTheDocument();
  });

  it("distinguishes an empty account from an empty filter", () => {
    const { unmount } = render(
      <RunsList initial={page({ runs: [], total: 0, totalCredits: 0 })} canOpenStudio />
    );
    expect(screen.getByText(/have not run anything yet/i)).toBeInTheDocument();
    unmount();

    // Same emptiness, different fact, once a filter is on.
    render(
      <RunsList initial={page({ runs: [], total: 0, totalCredits: 0 })} canOpenStudio />
    );
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    expect(screen.getByText(/No run matches this filter/i)).toBeInTheDocument();
  });

  it("shows a run made on a canvas that was never saved", () => {
    render(
      <RunsList
        initial={page({
          runs: [run({ projectId: null, projectName: null, projectExists: false })],
        })}
        canOpenStudio
      />
    );

    // The only surface this spend appears on at all.
    const table = within(screen.getByRole("table"));
    expect(table.getByText("Unsaved workflow")).toBeInTheDocument();
    expect(table.getByText("42")).toBeInTheDocument();
  });

  it("names a deleted workflow but offers no link to it", () => {
    render(
      <RunsList initial={page({ runs: [run({ projectExists: false })] })} canOpenStudio />
    );

    expect(screen.getByText("Product shot")).toBeInTheDocument();
    expect(screen.getByText("(deleted)")).toBeInTheDocument();
    // A dead link on the very row documenting the deletion is worse than none.
    expect(
      screen.queryByRole("button", { name: /Product shot/ })
    ).not.toBeInTheDocument();
  });

  it("opens a live workflow in the studio for an admin, and the run page otherwise", () => {
    const { unmount } = render(<RunsList initial={page()} canOpenStudio />);
    fireEvent.click(screen.getByRole("button", { name: "Product shot" }));
    expect(mockPush).toHaveBeenCalledWith("/?project=wf_1_abc");
    unmount();

    mockPush.mockClear();
    render(<RunsList initial={page()} canOpenStudio={false} />);
    fireEvent.click(screen.getByRole("button", { name: "Product shot" }));
    // The studio is admin-only; sending a user there is a redirect back here,
    // which reads as a broken link rather than a closed door.
    expect(mockPush).toHaveBeenCalledWith("/workflows/wf_1_abc/run");
  });

  it("shows no charge for a run that has not settled, rather than zero", () => {
    render(
      <RunsList
        initial={page({
          runs: [
            run({
              status: "running",
              finishedAt: null,
              durationMs: null,
              creditsCharged: null,
            }),
          ],
          totalCredits: 0,
        })}
        canOpenStudio
      />
    );

    const table = within(screen.getByRole("table"));
    expect(table.getByText("running")).toBeInTheDocument();
    // Credits and time both render an em dash. Neither renders a zero: "0
    // credits" says this run was free, which is a different claim from "we do
    // not have that figure yet".
    expect(table.queryByText("0")).not.toBeInTheDocument();
    expect(table.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the filtered set's totals, not the page's", () => {
    render(
      <RunsList
        initial={page({ runs: [run()], total: 137, totalCredits: 5821 })}
        canOpenStudio
      />
    );

    // One row on screen. The strip describes all 137.
    expect(screen.getByText("137")).toBeInTheDocument();
    expect(screen.getByText("5,821")).toBeInTheDocument();
  });

  it("sends the status filter to the server and resets to the first page", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => page({ runs: [], total: 0, totalCredits: 0 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<RunsList initial={page()} canOpenStudio />);
    fireEvent.click(screen.getByRole("button", { name: "Abandoned" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("status=abandoned");
    expect(url).toContain("offset=0");
  });

  it("reports a fetch that fails through the same channel as a failed read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));

    render(<RunsList initial={page()} canOpenStudio />);
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));

    await waitFor(() =>
      expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument()
    );
    // And never as "you have not run anything".
    expect(screen.queryByText(/have not run anything/i)).not.toBeInTheDocument();
  });
});
