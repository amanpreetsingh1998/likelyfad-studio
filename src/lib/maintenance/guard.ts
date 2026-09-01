/**
 * The gate on the maintenance endpoint.
 *
 * This route settles money and deletes the moderation record, so it is the one
 * surface in the app that is powerful but has no user behind it — there is no
 * session to check. It authenticates with a shared secret instead.
 *
 * Modelled on `requireAdmin()` in src/lib/admin/guard.ts, and fails closed the
 * same way: a missing secret is a refusal, not a bypass and not a 500. It
 * answers 404 rather than 401 for the same reason that one does — there is no
 * benefit in confirming the surface exists to whoever just probed for it.
 */

import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

/** Hashed before comparing so the compare is fixed-length and constant-time. */
function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Does this request carry the maintenance secret?
 *
 * `Authorization: Bearer <CRON_SECRET>`. Compared with timingSafeEqual on the
 * SHA-256 of each side: comparing the raw strings would both leak length and
 * throw outright on a length mismatch, which is a fine way to turn a guard
 * into a 500.
 */
export function hasCronSecret(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;

  // Fail closed. An unconfigured secret means nobody can run maintenance, not
  // that anybody can. Logged because the alternative is a cron job that has
  // been silently 404ing for a month.
  if (!expected) {
    console.error(
      "[maintenance] CRON_SECRET is not set; refusing every maintenance request"
    );
    return false;
  }

  const header = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!header.startsWith(prefix)) return false;

  const presented = header.slice(prefix.length).trim();
  if (!presented) return false;

  return timingSafeEqual(digest(presented), digest(expected));
}

/**
 * Resolve the gate for a maintenance handler, or return the response to send.
 *
 * A discriminated union rather than a thrown error, so a handler cannot forget
 * to catch and run the job anyway:
 *
 *   const gate = requireCron(request);
 *   if (!gate.ok) return gate.response;
 */
export function requireCron(
  request: NextRequest
): { ok: true } | { ok: false; response: NextResponse } {
  if (!hasCronSecret(request)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }
  return { ok: true };
}
