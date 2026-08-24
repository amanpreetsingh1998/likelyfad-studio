/**
 * Run work after the response has been sent.
 *
 * The moderation log fetches provider URLs and runs a sharp resize. Neither
 * belongs between the user and their generated image, so both are deferred
 * with Next's after().
 *
 * after() throws when called outside a request scope — in a unit test, or from
 * a runtime that does not implement it. That must not take the route down with
 * it: the work is bookkeeping, and the caller has already produced the thing
 * the user asked for. So a throw falls back to running detached, which is what
 * after() approximates anyway.
 *
 * Errors inside the work itself are swallowed here as a last resort. Every
 * function in events.ts already handles its own, so reaching this catch means
 * something unforeseen — logged rather than left to surface as an unhandled
 * rejection that could take the process down.
 */

import { after } from "next/server";

export function deferAfterResponse(work: () => Promise<unknown>): void {
  const guarded = () =>
    work().catch((err) => {
      console.error(
        "[moderation] deferred work failed:",
        err instanceof Error ? err.message : err
      );
    });

  try {
    after(guarded);
  } catch {
    void guarded();
  }
}
