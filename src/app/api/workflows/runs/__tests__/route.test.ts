/**
 * The run id is minted here and nowhere else. What matters is that the route
 * never takes an id from the caller, always stamps the id auth verified, and
 * that a failure to record history is not turned into a failure to work.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockGetAuthedContext, mockStartRun } = vi.hoisted(() => ({
  mockGetAuthedContext: vi.fn(),
  mockStartRun: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getAuthedContext: mockGetAuthedContext,
}));

vi.mock("@/lib/workflows/runs", () => ({ startRun: mockStartRun }));

import { POST } from "../route";

const USER = "11111111-1111-1111-1111-111111111111";
const RUN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAuthedContext.mockResolvedValue({ user: { id: USER }, supabase: {} });
  mockStartRun.mockResolvedValue(RUN);
});

describe("POST /api/workflows/runs", () => {
  it("refuses a caller with no session", async () => {
    mockGetAuthedContext.mockResolvedValue(null);
    const response = await POST(request({}));
    expect(response.status).toBe(401);
    expect(mockStartRun).not.toHaveBeenCalled();
  });

  it("returns the id the server minted", async () => {
    const response = await POST(request({ projectId: "wf_1_abc" }));
    expect(await response.json()).toEqual({ runId: RUN });
  });

  // The whole reason the id is server-minted: a client-chosen one would let a
  // user file their charges under somebody else's run.
  it("stamps the id auth verified, never one from the body", async () => {
    await POST(request({ userId: "someone-else", user_id: "someone-else" }));
    expect(mockStartRun).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER })
    );
  });

  it("passes the workflow through as a grouping key", async () => {
    await POST(request({ projectId: "wf_1_abc", projectName: "Shot", nodeCount: 6 }));
    expect(mockStartRun).toHaveBeenCalledWith({
      userId: USER,
      projectId: "wf_1_abc",
      projectName: "Shot",
      nodeCount: 6,
    });
  });

  it("drops fields of the wrong type rather than storing them", async () => {
    await POST(request({ projectId: 42, projectName: {}, nodeCount: "eight" }));
    expect(mockStartRun).toHaveBeenCalledWith({
      userId: USER,
      projectId: null,
      projectName: null,
      nodeCount: null,
    });
  });

  it("survives a body that is not JSON at all", async () => {
    const bad = {
      json: async () => {
        throw new Error("Unexpected token");
      },
    } as unknown as NextRequest;
    const response = await POST(bad);
    expect(response.status).toBe(200);
  });

  // A null id is a success. The workflow runs; only the history entry is lost.
  it("answers 200 with a null id when the run could not be opened", async () => {
    mockStartRun.mockResolvedValue(null);
    const response = await POST(request({}));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ runId: null });
  });
});
