/**
 * This route serves one account's run history keyed by an id from the URL,
 * which is the exact shape that shipped unguarded on /api/images/[id]. The
 * tests that matter are the ownership ones.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockGetAuthedContext, mockListWorkflowRuns } = vi.hoisted(() => ({
  mockGetAuthedContext: vi.fn(),
  mockListWorkflowRuns: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getAuthedContext: mockGetAuthedContext,
}));

vi.mock("@/lib/workflows/history", () => ({
  listWorkflowRuns: mockListWorkflowRuns,
}));

import { GET } from "../route";

const USER = "11111111-1111-1111-1111-111111111111";
const PROJECT = "wf_1_abc";

let projectLookup: { data: unknown; error: unknown };

function supabase() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => projectLookup }),
      }),
    }),
  };
}

function request(url = `http://localhost/api/workflows/${PROJECT}/runs`): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

const params = { params: Promise.resolve({ id: PROJECT }) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  projectLookup = { data: { id: PROJECT, name: "Product shot" }, error: null };
  mockGetAuthedContext.mockResolvedValue({
    user: { id: USER },
    supabase: supabase(),
  });
  mockListWorkflowRuns.mockResolvedValue({ runs: [], total: 0, failed: null });
});

describe("GET /api/workflows/[id]/runs", () => {
  it("refuses a caller with no session", async () => {
    mockGetAuthedContext.mockResolvedValue(null);
    expect((await GET(request(), params)).status).toBe(401);
  });

  // The load-bearing case. Authenticated is not the same as entitled.
  it("answers 404 for a workflow the caller does not own", async () => {
    projectLookup = { data: null, error: null };
    const response = await GET(request(), params);
    expect(response.status).toBe(404);
    expect(mockListWorkflowRuns).not.toHaveBeenCalled();
  });

  it("does not confirm the workflow exists to someone probing ids", async () => {
    projectLookup = { data: null, error: null };
    const body = await (await GET(request(), params)).json();
    expect(body.error).toBe("Workflow not found");
  });

  it("returns the runs for a workflow the caller owns", async () => {
    mockListWorkflowRuns.mockResolvedValue({
      runs: [{ id: "r1", status: "completed" }],
      total: 1,
      failed: null,
    });
    const body = await (await GET(request(), params)).json();
    expect(body).toMatchObject({ title: "Product shot", total: 1 });
    expect(body.runs).toHaveLength(1);
  });

  it("scopes the read to the workflow in the path", async () => {
    await GET(request(), params);
    expect(mockListWorkflowRuns).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT,
      expect.anything()
    );
  });

  it("passes pagination through", async () => {
    await GET(
      request(`http://localhost/api/workflows/${PROJECT}/runs?limit=10&offset=20`),
      params
    );
    expect(mockListWorkflowRuns).toHaveBeenCalledWith(expect.anything(), PROJECT, {
      limit: 10,
      offset: 20,
    });
  });

  it("ignores pagination that is not a number", async () => {
    await GET(
      request(`http://localhost/api/workflows/${PROJECT}/runs?limit=all`),
      params
    );
    expect(mockListWorkflowRuns).toHaveBeenCalledWith(expect.anything(), PROJECT, {
      limit: undefined,
      offset: undefined,
    });
  });

  it("reports a broken ownership lookup rather than treating it as not-yours", async () => {
    projectLookup = { data: null, error: { message: "connection reset" } };
    expect((await GET(request(), params)).status).toBe(500);
  });

  // A failed run read is a fact the drawer must be able to state.
  it("passes a failed read through as 200 with a reason", async () => {
    mockListWorkflowRuns.mockResolvedValue({
      runs: [],
      total: 0,
      failed: "permission denied",
    });
    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    expect((await response.json()).failed).toBe("permission denied");
  });
});
