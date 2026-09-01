/**
 * The credit gate wraps every generation route, so a fault here is a fault on
 * every run — and the one that prompted this file cost a provider call before
 * it surfaced.
 *
 * withCredits used to inspect `response.clone()` and hand `response.body` back
 * untouched. In production that threw
 *
 *   TypeError: Response body object should not be disturbed or locked
 *
 * on a 4 MB image — a 500 after fal had generated and been paid for the
 * picture, so the user saw a failed run for something that had succeeded.
 *
 * HONESTY ABOUT WHAT THESE TESTS DO AND DO NOT PROVE.
 *
 * The old shape could not be reproduced here: clone-then-return-original works
 * in isolation at 4 MB and at 16 MB, for buffered and streamed bodies alike,
 * so whatever drained the original in the real request is not reconstructable
 * from this side. What IS reproducible is the trigger — constructing a
 * Response from a body that has already been read throws exactly that error.
 *
 * So these pin the invariant that makes the whole class impossible rather than
 * the failure itself: the guard reads the handler's body ONCE and returns a
 * body of its own, never the handler's stream object. If that holds, it does
 * not matter what else touched the original.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockGetAuthedContext,
  mockGetBalance,
  mockGetPendingTotal,
  mockRecordPendingCharge,
  mockRecordGenerationEvent,
  mockRunBelongsTo,
} = vi.hoisted(() => ({
  mockGetAuthedContext: vi.fn(),
  mockGetBalance: vi.fn(),
  mockGetPendingTotal: vi.fn(),
  mockRecordPendingCharge: vi.fn(),
  mockRecordGenerationEvent: vi.fn(),
  mockRunBelongsTo: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getAuthedContext: mockGetAuthedContext,
}));

vi.mock("../server", () => ({
  getBalance: mockGetBalance,
  getPendingTotal: mockGetPendingTotal,
  recordPendingCharge: mockRecordPendingCharge,
}));

vi.mock("@/lib/workflows/runs", () => ({ runBelongsTo: mockRunBelongsTo }));

// after() is a route-handler API; outside a request scope the work runs
// detached. Run it inline so assertions can see what was logged.
vi.mock("@/lib/moderation/defer", () => ({
  deferAfterResponse: (work: () => unknown) => {
    void work();
  },
}));

vi.mock("@/lib/moderation/events", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/lib/moderation/events"
  );
  return { ...actual, recordGenerationEvent: mockRecordGenerationEvent };
});

import { withCredits, BALANCE_HEADER, CHARGED_HEADER } from "../guard";

const USER = "11111111-1111-1111-1111-111111111111";

function request(body: unknown): NextRequest {
  return {
    clone: () => ({ json: async () => body }),
    json: async () => body,
  } as unknown as NextRequest;
}

const cost = () => ({ kind: "image" as const, provider: "gemini", modelId: "nano-banana-pro" });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  mockGetAuthedContext.mockResolvedValue({ user: { id: USER }, supabase: {} });
  mockGetBalance.mockResolvedValue(1000);
  mockGetPendingTotal.mockResolvedValue(0);
  mockRecordPendingCharge.mockResolvedValue(5);
  mockRecordGenerationEvent.mockResolvedValue("event-1");
  mockRunBelongsTo.mockResolvedValue(true);
});

describe("the response body survives inspection", () => {
  // The regression, at the size that triggered it.
  it("returns a multi-megabyte body intact", async () => {
    const image = `data:image/png;base64,${"A".repeat(4 * 1024 * 1024)}`;
    const handler = vi.fn(async () =>
      Response.json({ success: true, image })
    );

    const response = await withCredits(cost, handler)(request({}));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.image).toBe(image);
  });

  /**
   * The invariant. The guard consumes the handler's response and answers with
   * a body of its own, so the handler's stream is never handed onward to be
   * read a second time — which is the only way the disturbed/locked error can
   * arise, whatever caused the first read.
   */
  it("consumes the handler's body and returns one of its own", async () => {
    let handed: Response | null = null;
    const handler = vi.fn(async () => {
      handed = Response.json({ success: true, image: "x" });
      return handed;
    });

    const response = await withCredits(cost, handler)(request({}));

    // The guard drained it...
    expect(handed!.bodyUsed).toBe(true);
    // ...and what comes back is not that object, and is still readable.
    expect(response).not.toBe(handed);
    expect((await response.json()).image).toBe("x");
  });

  // The trigger itself, pinned: this is the error the old shape produced.
  it("would have thrown had the handler's body been passed on after reading", async () => {
    const original = Response.json({ success: true, image: "x" });
    await original.text();
    expect(() => new Response(original.body)).toThrow(/disturbed or locked/);
  });

  it("reports a length matching what it actually sends", async () => {
    const handler = vi.fn(async () => Response.json({ success: true, image: "x" }));
    const response = await withCredits(cost, handler)(request({}));

    const declared = Number(response.headers.get("Content-Length"));
    const actual = (await response.arrayBuffer()).byteLength;
    expect(declared).toBe(actual);
  });

  it("passes a non-JSON body through unchanged", async () => {
    const handler = vi.fn(
      async () => new Response("not json at all", { status: 200 })
    );
    const response = await withCredits(cost, handler)(request({}));
    expect(await response.text()).toBe("not json at all");
  });

  it("survives a handler that answers with no body", async () => {
    const handler = vi.fn(async () => new Response(null, { status: 204 }));
    const response = await withCredits(cost, handler)(request({}));
    expect(response.status).toBe(204);
  });

  it("keeps the handler's own headers", async () => {
    const handler = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "X-Custom": "kept", "Content-Type": "application/json" },
        })
    );
    const response = await withCredits(cost, handler)(request({}));
    expect(response.headers.get("X-Custom")).toBe("kept");
  });
});

describe("what gets billed", () => {
  it("records a charge for a run that reached a provider", async () => {
    const handler = vi.fn(async () => Response.json({ success: true, image: "x" }));
    await withCredits(cost, handler)(request({}));
    expect(mockRecordPendingCharge).toHaveBeenCalled();
  });

  // A 200 carrying success:false is how these routes report a provider
  // failure. Billing it would charge for nothing.
  it("does not bill a 200 that reports failure in the body", async () => {
    const handler = vi.fn(async () =>
      Response.json({ success: false, error: "provider refused" })
    );
    await withCredits(cost, handler)(request({}));
    expect(mockRecordPendingCharge).not.toHaveBeenCalled();
  });

  it("does not bill a non-2xx", async () => {
    const handler = vi.fn(async () =>
      Response.json({ error: "boom" }, { status: 502 })
    );
    await withCredits(cost, handler)(request({}));
    expect(mockRecordPendingCharge).not.toHaveBeenCalled();
  });

  // Declining to bill on doubt would make every unreadable response free.
  it("bills a 2xx it could not parse", async () => {
    const handler = vi.fn(async () => new Response("binary-ish", { status: 200 }));
    await withCredits(cost, handler)(request({}));
    expect(mockRecordPendingCharge).toHaveBeenCalled();
  });

  it("still logs the provider's message on a failure", async () => {
    const handler = vi.fn(async () =>
      Response.json({ success: false, error: "provider refused" })
    );
    await withCredits(cost, handler)(request({}));
    expect(mockRecordGenerationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed", error: "provider refused" })
    );
  });

  it("stamps the balance headers", async () => {
    const handler = vi.fn(async () => Response.json({ success: true, image: "x" }));
    const response = await withCredits(cost, handler)(request({}));
    expect(response.headers.get(BALANCE_HEADER)).toBe("995");
    expect(response.headers.get(CHARGED_HEADER)).toBe("5");
  });

  it("refuses an unaffordable run without calling the handler", async () => {
    mockGetBalance.mockResolvedValue(0);
    const handler = vi.fn(async () => Response.json({ success: true }));
    const response = await withCredits(cost, handler)(request({}));
    expect(response.status).toBe(402);
    expect(handler).not.toHaveBeenCalled();
  });

  it("refuses a caller with no session", async () => {
    mockGetAuthedContext.mockResolvedValue(null);
    const handler = vi.fn(async () => Response.json({ success: true }));
    expect((await withCredits(cost, handler)(request({}))).status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  // Losing the charge is lost revenue, not the user's problem: their image
  // exists and they must still receive it.
  it("returns the image even when recording the charge fails", async () => {
    mockRecordPendingCharge.mockRejectedValue(new Error("db down"));
    const handler = vi.fn(async () => Response.json({ success: true, image: "x" }));
    const response = await withCredits(cost, handler)(request({}));
    expect(response.status).toBe(200);
    expect((await response.json()).image).toBe("x");
  });
});
