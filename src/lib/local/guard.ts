/**
 * The gate on the local-filesystem routes.
 *
 * These nine routes drive the host's filesystem from the browser: they exist so
 * Likelyfad Studio can run as a desktop tool against a directory the user picked
 * from a native file dialog. That is a feature on localhost and a remote
 * filesystem when hosted, which is silently what they became the day this
 * shipped as a SaaS. proxy.ts deliberately lets /api/* through, so nothing else
 * was covering them.
 *
 * They are switched off rather than confined to a root, because arbitrary path
 * access *is* the feature here — the user picks the directory. A root check
 * would break the desktop use case without fixing the hosted one. The cloud
 * path is already parallel and already authenticated: workflowStore's
 * isCloudSave branch persists through /api/likelyfad/*, so a hosted deployment
 * loses nothing by turning these off.
 *
 * Fails closed the same way requireAdmin() and requireCron() do, and answers
 * 404 for the same reason — there is no benefit in confirming the surface
 * exists to whoever just probed for it.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Opt-IN, not opt-out. An unset variable means off, so deploying without
 * setting anything is the safe outcome rather than the exposed one — the same
 * argument as CRON_SECRET refusing every request while it is missing.
 */
function enabled(): boolean {
  return process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES === "1";
}

/**
 * Same-machine check, lifted from the one open-file already had.
 *
 * Defence in depth ONLY. Both Host and X-Forwarded-For are caller-supplied, and
 * a proxy that does not strip them lets a remote caller claim to be localhost —
 * so this must never be the only thing standing in the way. `enabled()` above
 * is the real boundary; this is here so a flag set by mistake in a hosted
 * deployment is not immediately fatal.
 */
function isLoopback(request: NextRequest): boolean {
  // Tolerates a request without headers rather than throwing. A real Next
  // runtime always has them; this only keeps a malformed or hand-built request
  // from turning a guard into a 500, which is how gates fail open in practice.
  const headers = request?.headers;
  if (!headers || typeof headers.get !== "function") return true;

  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(first)) return false;
  }

  const hostname = (headers.get("host") ?? "").split(":")[0];
  if (!hostname) return true;
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

/**
 * Resolve the gate for a local-filesystem handler, or return the response to
 * send. A discriminated union rather than a thrown error, so a handler cannot
 * forget to catch and touch the disk anyway:
 *
 *   const gate = requireLocal(request);
 *   if (!gate.ok) return gate.response;
 */
export function requireLocal(
  request: NextRequest
): { ok: true } | { ok: false; response: NextResponse } {
  if (!enabled() || !isLoopback(request)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not found" }, { status: 404 }),
    };
  }
  return { ok: true };
}
