/**
 * The credit gate that wraps a generation route.
 *
 * Charging happens once per WORKFLOW, not once per node — so this wrapper does
 * not debit. It authenticates, checks the user can afford what they are about
 * to run, and records a pending charge that /api/credits/settle later bills in
 * a single transaction.
 *
 * Recording server-side rather than letting the browser tally its own total is
 * the part that matters: the client chooses *when* to settle, never *how much*.
 *
 * Also the place where auth lands on these routes. proxy.ts deliberately lets
 * /api/* through (a redirect would hand fetch() an HTML page instead of a
 * parseable error), leaving each route to gate itself — and before this,
 * /api/generate and /api/llm did not, so an unauthenticated POST could spend
 * the server's provider keys.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import { getBalance, getPendingTotal, recordPendingCharge } from "./server";
import { creditCostForRun, type RunCostInput } from "./pricing";

/** Balance minus what this run's workflow already owes. */
export const BALANCE_HEADER = "X-Credits-Balance";
/** What this node run added to the pending total. */
export const CHARGED_HEADER = "X-Credits-Pending";

type Handler = (request: NextRequest) => Promise<Response>;

/**
 * Authenticate, check affordability, record, run.
 *
 * `costFrom` receives the parsed request body and returns what to charge. It
 * runs on the server against the server's own rate card — the body is only
 * consulted for which model was asked for, never for a price.
 */
export function withCredits(
  costFrom: (body: Record<string, unknown>) => RunCostInput,
  handler: Handler
): Handler {
  return async (request: NextRequest): Promise<Response> => {
    const auth = await getAuthedContext();
    if (!auth) {
      return NextResponse.json(
        { success: false, error: "Not signed in" },
        { status: 401 }
      );
    }

    // Clone so the handler still gets an unread body. Next's request bodies
    // are one-shot streams; reading here without cloning would leave the
    // handler's own request.json() throwing on a consumed stream.
    let body: Record<string, unknown>;
    try {
      body = await request.clone().json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const cost = costFrom(body);
    const charge = creditCostForRun(cost);

    // Affordability is checked against balance MINUS what this workflow has
    // already run up. Without the pending term a user with 10 credits could
    // start a 40-node workflow and only discover the problem at settlement,
    // by which point every provider call is already paid for.
    let balance: number;
    let pending: number;
    try {
      [balance, pending] = await Promise.all([
        getBalance(auth.user.id),
        getPendingTotal(auth.user.id),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[credits] balance check failed:", message);
      return NextResponse.json(
        { success: false, error: `Credit check failed: ${message}` },
        { status: 500 }
      );
    }

    const available = balance - pending;
    if (available < charge) {
      return NextResponse.json(
        {
          success: false,
          error: `Not enough credits: this step costs ${charge}, you have ${Math.max(
            0,
            available
          )} available.`,
          code: "insufficient_credits",
          required: charge,
          balance: available,
        },
        // 402 Payment Required: the one status that means exactly this. The
        // client keys its "buy credits" prompt off it.
        { status: 402 }
      );
    }

    const response = await handler(request);

    // Only a run that actually reached a provider is worth billing. A failed
    // one records nothing, so there is no refund path to get wrong.
    if (await didSucceed(response)) {
      try {
        pending = await recordPendingCharge(auth.user.id, charge, cost);
      } catch (err) {
        // The generation succeeded; failing to record the charge must not turn
        // that into an error for the user. Logged loudly — it is lost revenue.
        console.error(
          "[credits] FAILED TO RECORD CHARGE — unbilled run:",
          err instanceof Error ? err.message : err,
          { userId: auth.user.id, charge }
        );
      }
    }

    const headers = new Headers(response.headers);
    headers.set(BALANCE_HEADER, String(balance - pending));
    headers.set(CHARGED_HEADER, String(pending));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/**
 * Did this run reach a provider?
 *
 * A non-2xx did not. A 200 carrying `success: false` did not either — these
 * routes report provider failures that way rather than with a status code.
 *
 * Note this reads a CLONE: the caller still returns the original stream.
 */
async function didSucceed(response: Response): Promise<boolean> {
  if (!response.ok) return false;

  try {
    const text = await response.clone().text();
    if (!text) return true;
    return JSON.parse(text)?.success !== false;
  } catch {
    // Not JSON, or a stream we cannot re-read. A 2xx we cannot inspect is
    // treated as a success — declining to bill on doubt would make every
    // streaming response free.
    return true;
  }
}
