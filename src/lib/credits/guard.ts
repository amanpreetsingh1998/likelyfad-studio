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
 *
 * And it is where the generation log is written, for the same reason it is
 * where billing happens: this is the one point every run passes through, with
 * the user, the model and the response all in scope at once. The write is
 * deferred with after() so no user waits on it.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import { getBalance, getPendingTotal, recordPendingCharge } from "./server";
import { creditCostForRun, hasKnownPrice, type RunCostInput } from "./pricing";
import { deferAfterResponse } from "@/lib/moderation/defer";
import {
  outputFromPayload,
  promptFromBody,
  recordGenerationEvent,
} from "@/lib/moderation/events";

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

    // Refuse rather than guess. Billing an unpriced model at a category
    // average is how a $1.68 run gets charged like a $0.05 one — and it fails
    // silently, in your favour never.
    if (!hasKnownPrice(cost)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "This model has no recorded price yet, so it cannot be billed. " +
            "Run `npm run fal:pricing` to refresh the price list, or pick another model.",
          code: "unpriced_model",
          modelId: cost.modelId ?? null,
        },
        { status: 409 }
      );
    }

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

    const startedAt = Date.now();
    const response = await handler(request);
    const durationMs = Date.now() - startedAt;

    // Read once, used twice: the billing decision and the generation log both
    // need the parsed payload, and these bodies carry base64 media — parsing
    // one of them a second time is not free.
    const { succeeded, payload } = await inspectResponse(response);

    // Only a run that actually reached a provider is worth billing. A failed
    // one records nothing, so there is no refund path to get wrong.
    if (succeeded) {
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

    logGeneration({
      userId: auth.user.id,
      cost,
      charge: succeeded ? charge : null,
      durationMs,
      body,
      payload,
      succeeded,
    });

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
 * Did this run reach a provider, and what did it say?
 *
 * A non-2xx did not. A 200 carrying `success: false` did not either — these
 * routes report provider failures that way rather than with a status code.
 *
 * Note this reads a CLONE: the caller still returns the original stream.
 */
async function inspectResponse(
  response: Response
): Promise<{ succeeded: boolean; payload: Record<string, unknown> | null }> {
  if (!response.ok) {
    // Still parsed, because the generation log wants the provider's error
    // message and this is the only place it exists.
    return { succeeded: false, payload: await parseBody(response) };
  }

  const payload = await parseBody(response);

  // Not JSON, or a stream we could not re-read. A 2xx we cannot inspect is
  // treated as a success — declining to bill on doubt would make every
  // streaming response free.
  if (!payload) return { succeeded: true, payload: null };

  return { succeeded: payload.success !== false, payload };
}

async function parseBody(
  response: Response
): Promise<Record<string, unknown> | null> {
  try {
    const text = await response.clone().text();
    if (!text) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Log the run for moderation and stats, after the response has gone out.
 *
 * Deferred with after() rather than awaited: this fetches provider URLs and
 * runs a sharp resize, and none of that should sit between the user and their
 * image. after() is a Next 16 route-handler API, so it is guarded — outside a
 * request scope (tests, an older runtime) the work simply runs detached.
 *
 * Every failure inside recordGenerationEvent() is swallowed there. The catch
 * here is for the scheduling itself.
 */
function logGeneration(args: {
  userId: string;
  cost: RunCostInput;
  charge: number | null;
  durationMs: number;
  body: Record<string, unknown>;
  payload: Record<string, unknown> | null;
  succeeded: boolean;
}): void {
  const { payload, succeeded } = args;

  // A dispatched-but-unfinished run: the provider answered with a task id and
  // the media arrives later through /api/generate/poll. Recorded now anyway —
  // the prompt was already sent to a provider, which is the fact moderation
  // cares about, and the poll route fills in the rest.
  const isPending = succeeded && payload?.polling === true;
  const taskId = typeof payload?.taskId === "string" ? payload.taskId : null;

  const { output, outputKind } = outputFromPayload(isPending ? null : payload);

  const work = () =>
    recordGenerationEvent({
      userId: args.userId,
      kind: args.cost.kind,
      provider: args.cost.provider ?? null,
      modelId: args.cost.modelId ?? null,
      prompt: promptFromBody(args.body),
      creditsCharged: args.charge,
      durationMs: args.durationMs,
      status: isPending ? "pending" : succeeded ? "succeeded" : "failed",
      error: typeof payload?.error === "string" ? payload.error : null,
      output,
      // /api/llm answers with `text` and no media field at all.
      outputKind:
        outputKind ?? (typeof payload?.text === "string" ? "text" : null),
      outputText: typeof payload?.text === "string" ? payload.text : null,
      taskId: isPending ? taskId : null,
    });

  deferAfterResponse(work);
}
