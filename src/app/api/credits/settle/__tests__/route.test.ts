/**
 * Settlement is where money moves, and this route is the one place a browser
 * gets to speak to it. The cases that matter are the ones where the body could
 * change what is charged, and the ones where a run that really ended would
 * fail to be billed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockGetAuthedContext, mockSettleRun, mockSettleUser } = vi.hoisted(() => ({
  mockGetAuthedContext: vi.fn(),
  mockSettleRun: vi.fn(),
  mockSettleUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getAuthedContext: mockGetAuthedContext,
}));

vi.mock("@/lib/credits/server", () => ({
  settleWorkflowRun: mockSettleRun,
  settlePendingCharges: mockSettleUser,
}));

import { POST } from "../route";

const USER = "11111111-1111-1111-1111-111111111111";
const RUN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const RESULT = { charged: 42, balance: 58, runs: 3, shortfall: 0 };

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetAuthedContext.mockResolvedValue({ user: { id: USER }, supabase: {} });
  mockSettleRun.mockResolvedValue(RESULT);
  mockSettleUser.mockResolvedValue(RESULT);
});

describe("POST /api/credits/settle", () => {
  it("refuses a caller with no session", async () => {
    mockGetAuthedContext.mockResolvedValue(null);
    expect((await POST(request({}))).status).toBe(401);
  });

  it("bills the one run when a run id is given", async () => {
    await POST(request({ runId: RUN, status: "completed" }));
    expect(mockSettleRun).toHaveBeenCalledWith(USER, RUN, "completed");
    expect(mockSettleUser).not.toHaveBeenCalled();
  });

  // What a client predating this feature sends, and what the paths that are
  // not a workflow execution send.
  it("falls back to user-wide settlement without a run id", async () => {
    await POST(request({ status: "completed" }));
    expect(mockSettleUser).toHaveBeenCalledWith(USER, "Workflow run");
    expect(mockSettleRun).not.toHaveBeenCalled();
  });

  it("labels a non-completed user-wide settlement in the ledger", async () => {
    await POST(request({ status: "cancelled" }));
    expect(mockSettleUser).toHaveBeenCalledWith(USER, "Workflow run (cancelled)");
  });

  // Failed and cancelled runs still pay: every pending row is a provider call
  // that really happened. The status is a label, never a reason to skip.
  it.each(["failed", "cancelled"] as const)("still bills a %s run", async (status) => {
    await POST(request({ runId: RUN, status }));
    expect(mockSettleRun).toHaveBeenCalledWith(USER, RUN, status);
  });

  it("stamps the verified user, never one from the body", async () => {
    await POST(request({ runId: RUN, userId: "someone-else" }));
    expect(mockSettleRun).toHaveBeenCalledWith(USER, RUN, "completed");
  });

  // The invariant the pending-charges design exists to protect.
  it("ignores an amount supplied by the client", async () => {
    const response = await POST(
      request({ runId: RUN, charged: 9999, credits: 9999, amount: 9999 })
    );
    expect(mockSettleRun).toHaveBeenCalledWith(USER, RUN, "completed");
    expect(await response.json()).toMatchObject({ charged: 42 });
  });

  it("coerces an unknown status rather than refusing to close the run", async () => {
    await POST(request({ runId: RUN, status: "banana" }));
    expect(mockSettleRun).toHaveBeenCalledWith(USER, RUN, "completed");
  });

  it("treats an empty run id as absent", async () => {
    await POST(request({ runId: "" }));
    expect(mockSettleUser).toHaveBeenCalled();
    expect(mockSettleRun).not.toHaveBeenCalled();
  });

  it("survives a body that is not JSON", async () => {
    const bad = {
      json: async () => {
        throw new Error("Unexpected token");
      },
    } as unknown as NextRequest;
    expect((await POST(bad)).status).toBe(200);
  });

  it("reports a settlement failure as a 500 rather than a silent success", async () => {
    mockSettleRun.mockRejectedValue(new Error("deadlock detected"));
    const response = await POST(request({ runId: RUN }));
    expect(response.status).toBe(500);
  });

  it("returns the server's figures to the caller", async () => {
    const response = await POST(request({ runId: RUN }));
    expect(await response.json()).toEqual({ success: true, ...RESULT });
  });
});
