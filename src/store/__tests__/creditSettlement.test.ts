/**
 * The credit bugs that were invisible, pinned.
 *
 * Two of them, both of which every existing suite was green against:
 *
 * 1. THE BALANCE CAME BACK ON REFRESH. A generation response reports the
 *    *spendable* figure (ledger minus unsettled charges) and GET /api/credits
 *    reported the *ledger* figure. Neither was wrong; they answered different
 *    questions, and the badge read them as the same one. So a run counted the
 *    number down and a reload put it back — which looks exactly like credits
 *    not being charged, and was indistinguishable from it.
 *
 * 2. TWO OF THE THREE EXECUTION PATHS NEVER SETTLED. Only executeWorkflow
 *    closed a run. "Run selected" and the regenerate button — the most-used
 *    action in the app — recorded pending charges through the credit gate and
 *    left them for a maintenance sweep that is only running if someone wired
 *    up a scheduler.
 *
 * These are asserted at the seam that actually broke: what the store believes
 * after each kind of response, and whether a settlement request is made at
 * all. The amount itself is deliberately not asserted here — the server owns
 * that, and a test that let the client decide it would be testing the
 * vulnerability rather than the fix.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  availableCredits,
  drainUnsettledRuns,
  settleRun,
  syncBalanceFromResponse,
  useCreditStore,
} from "@/store/creditStore";

const UNSETTLED_KEY = "likelyfad-studio-unsettled-runs";

/** A gated generation response: 40 spendable, 60 already run up. */
function generationResponse(): Response {
  return new Response(JSON.stringify({ success: true }), {
    headers: {
      "X-Credits-Balance": "40",
      "X-Credits-Pending": "60",
    },
  });
}

function creditsPayload(balance: number, pending: number) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      balance,
      pending,
      available: Math.max(0, balance - pending),
      transactions: [],
      packs: [],
      signupGrant: 0,
      purchaseEnabled: false,
    }),
  };
}

beforeEach(() => {
  window.localStorage.clear();
  useCreditStore.setState({
    balance: null,
    pending: 0,
    transactions: [],
    packs: [],
    lastReceipt: null,
    settleError: null,
    loading: false,
    error: null,
  });
  vi.restoreAllMocks();
});

describe("the balance a refresh reports", () => {
  it("agrees with the balance a run reported", async () => {
    // Mid-run: the header says 40 spendable against 60 pending.
    syncBalanceFromResponse(generationResponse());
    const duringRun = availableCredits(useCreditStore.getState());
    expect(duringRun).toBe(40);

    // Now reload. The ledger still says 100 because nothing has settled yet —
    // which is exactly the state this bug lived in.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(creditsPayload(100, 60)));
    await useCreditStore.getState().refresh();

    const afterRefresh = availableCredits(useCreditStore.getState());
    expect(afterRefresh).toBe(duringRun);
    // The regression, stated as itself: the number must not go up.
    expect(afterRefresh).not.toBe(100);
  });

  it("keeps the ledger figure and the spendable figure apart", () => {
    syncBalanceFromResponse(generationResponse());
    // The ledger balance is the sum of the two headers, and is what a grant
    // adds to. Collapsing them into one field is what started all of this.
    expect(useCreditStore.getState().balance).toBe(100);
    expect(useCreditStore.getState().pending).toBe(60);
  });

  it("reports nothing rather than zero before the first read", () => {
    // A badge that flashes 0 at someone with plenty reads as a charge they
    // did not make.
    expect(availableCredits({ balance: null, pending: 0 })).toBeNull();
  });

  it("never reports a negative balance", () => {
    expect(availableCredits({ balance: 10, pending: 25 })).toBe(0);
  });
});

describe("settlement failures", () => {
  it("is loud about a server error instead of returning quietly", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'column reference "balance" is ambiguous',
        json: async () => ({}),
      })
    );

    await settleRun("completed", "run-1");

    // The line that would have surfaced a month of unbilled runs on day one.
    expect(error).toHaveBeenCalled();
    expect(useCreditStore.getState().settleError).toContain("500");
  });

  it("parks an undeliverable run and replays it on the next load", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await settleRun("completed", "run-1");

    const queued = JSON.parse(window.localStorage.getItem(UNSETTLED_KEY) ?? "[]");
    expect(queued).toEqual([{ status: "completed", runId: "run-1" }]);

    // Back online.
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url === "/api/credits/settle"
        ? {
            ok: true,
            status: 200,
            json: async () => ({ charged: 32, balance: 68, runs: 2, shortfall: 0 }),
          }
        : creditsPayload(68, 0)
    );
    vi.stubGlobal("fetch", fetchMock);

    await drainUnsettledRuns();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/credits/settle",
      expect.objectContaining({ method: "POST" })
    );
    expect(window.localStorage.getItem(UNSETTLED_KEY)).toBeNull();
  });

  it("does not queue the same run twice", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    await settleRun("completed", "run-1");
    await settleRun("completed", "run-1");

    const queued = JSON.parse(window.localStorage.getItem(UNSETTLED_KEY) ?? "[]");
    expect(queued).toHaveLength(1);
  });

  it("does not retry a signed-out settlement", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 401, text: async () => "", json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    await settleRun("completed", "run-1");

    // Hammering the route will not produce a session.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("what the server is allowed to decide", () => {
  it("sends the run id and the status, and no amount", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url === "/api/credits/settle"
        ? { ok: true, status: 200, json: async () => ({ charged: 0, balance: 100, runs: 0, shortfall: 0 }) }
        : creditsPayload(100, 0)
    );
    vi.stubGlobal("fetch", fetchMock);

    await settleRun("cancelled", "run-7");

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ status: "cancelled", runId: "run-7" });
    // The whole pending-charges design exists so this stays true.
    expect(Object.keys(body)).not.toContain("credits");
    expect(Object.keys(body)).not.toContain("amount");
  });

  it("falls back to the user-wide path when there is no run", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) =>
      url === "/api/credits/settle"
        ? { ok: true, status: 200, json: async () => ({ charged: 5, balance: 95, runs: 1, shortfall: 0 }) }
        : creditsPayload(95, 0)
    );
    vi.stubGlobal("fetch", fetchMock);

    await settleRun("completed", null);

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      status: "completed",
    });
  });
});
