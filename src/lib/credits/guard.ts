/**
 * The credit gate that wraps a generation route.
 *
 * Written as a wrapper rather than a few lines inside each route because the
 * routes have many early returns — /api/generate alone has a return per
 * provider branch — and a charge that has to be undone on every one of those
 * paths is a bug waiting to happen. Wrapping means the refund is decided once,
 * from the response, no matter which branch produced it.
 *
 * Also the place where auth lands on these routes. proxy.ts deliberately lets
 * /api/* through (a redirect would hand fetch() an HTML page instead of a
 * parseable error), leaving each route to gate itself — and before this,
 * /api/generate and /api/llm did not, so an unauthenticated POST could spend
 * the server's provider keys.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import {
  InsufficientCreditsError,
  refundSpend,
  spendForRun,
} from "./server";
import type { RunCostInput } from "./pricing";

/** Sent on every gated response so the UI can update without a refetch. */
export const BALANCE_HEADER = "X-Credits-Balance";
export const CHARGED_HEADER = "X-Credits-Charged";

type Handler = (request: NextRequest) => Promise<Response>;

/**
 * Authenticate, charge, run, refund-on-failure.
 *
 * `costFrom` receives the parsed request body and returns what to charge.
 * It runs on the server against the server's own price table — the body is
 * only consulted for which model was asked for, never for a price.
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
    // handler's own request.json() throwing on an already-consumed stream.
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

    let spend;
    try {
      spend = await spendForRun(
        auth.user.id,
        cost,
        `${cost.kind} run`,
        { route: new URL(request.url).pathname }
      );
    } catch (err) {
      if (err instanceof InsufficientCreditsError) {
        return NextResponse.json(
          {
            success: false,
            error: err.message,
            code: "insufficient_credits",
            required: err.required,
            balance: err.balance,
          },
          // 402 Payment Required: the one status that means exactly this. The
          // client keys its "buy credits" prompt off it.
          { status: 402 }
        );
      }
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[credits] charge failed:", message);
      return NextResponse.json(
        { success: false, error: `Credit check failed: ${message}` },
        { status: 500 }
      );
    }

    let response: Response;
    try {
      response = await handler(request);
    } catch (err) {
      // The handler threw before reaching a provider — nothing was spent
      // downstream, so the charge goes back.
      await refundSpend(
        auth.user.id,
        spend.transactionId,
        spend.charged,
        "Run failed before dispatch"
      );
      throw err;
    }

    if (await shouldRefund(response)) {
      await refundSpend(
        auth.user.id,
        spend.transactionId,
        spend.charged,
        "Run failed"
      );
      const headers = new Headers(response.headers);
      headers.set(BALANCE_HEADER, String(spend.balance + spend.charged));
      headers.set(CHARGED_HEADER, "0");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    const headers = new Headers(response.headers);
    headers.set(BALANCE_HEADER, String(spend.balance));
    headers.set(CHARGED_HEADER, String(spend.charged));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

/**
 * Did this run fail in a way that deserves the credits back?
 *
 * A non-2xx always does. A 200 carrying `success: false` does too — these
 * routes report provider failures that way rather than with a status code.
 *
 * Note this reads a CLONE: the caller still returns the original stream.
 */
async function shouldRefund(response: Response): Promise<boolean> {
  if (!response.ok) return true;

  try {
    const clone = response.clone();
    const text = await clone.text();
    if (!text) return false;
    const parsed = JSON.parse(text);
    return parsed?.success === false;
  } catch {
    // Not JSON, or a stream we cannot re-read — a 2xx we cannot inspect is
    // treated as a success. Refunding on doubt would hand back credits for
    // runs that did reach the provider.
    return false;
  }
}
