/**
 * The one rule this module exists to hold: a workflow must still run when
 * history is unavailable. Every failure returns null and the caller carries on.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { startWorkflowRun } from "../startRun";

const RUN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("startWorkflowRun", () => {
  it("returns the id the server minted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ runId: RUN }))
    );
    expect(await startWorkflowRun({ projectId: "wf_1" })).toBe(RUN);
  });

  it("sends the workflow as a grouping key, never a cost", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ runId: RUN }));
    vi.stubGlobal("fetch", fetchMock);

    await startWorkflowRun({
      projectId: "wf_1",
      projectName: "Product shot",
      nodeCount: 6,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workflows/runs");
    expect(JSON.parse(init.body)).toEqual({
      projectId: "wf_1",
      projectName: "Product shot",
      nodeCount: 6,
    });
  });

  it("sends nulls for an unsaved canvas rather than omitting the fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ runId: RUN }));
    vi.stubGlobal("fetch", fetchMock);
    await startWorkflowRun({});
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      projectId: null,
      projectName: null,
      nodeCount: null,
    });
  });

  it("returns null when the server declines", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "Not signed in" }, false, 401))
    );
    expect(await startWorkflowRun({})).toBeNull();
  });

  it("returns null when the route is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({}, false, 404))
    );
    expect(await startWorkflowRun({})).toBeNull();
  });

  it("returns null when the server could not open the run", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ runId: null }))
    );
    expect(await startWorkflowRun({})).toBeNull();
  });

  it("returns null on a non-string id rather than passing it on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ runId: 42 }))
    );
    expect(await startWorkflowRun({})).toBeNull();
  });

  // Offline. The workflow still runs.
  it("swallows a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Failed to fetch")));
    await expect(startWorkflowRun({})).resolves.toBeNull();
  });

  it("swallows a body that is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Unexpected token <");
        },
      } as unknown as Response)
    );
    await expect(startWorkflowRun({})).resolves.toBeNull();
  });
});
