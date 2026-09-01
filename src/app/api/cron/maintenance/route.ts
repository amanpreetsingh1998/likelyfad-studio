/**
 * POST /api/cron/maintenance — the scheduled job this project never had.
 *
 * Runs both maintenance sweeps:
 *   - settles pending charges the browser abandoned (the closed-tab billing
 *     leak documented in CLAUDE.md);
 *   - deletes generation_events past the retention window, and their
 *     thumbnails.
 *
 * POST, not GET, because it moves money and deletes rows; a GET endpoint that
 * does either is one prefetch away from doing it by accident.
 *
 * There is no session here — see src/lib/maintenance/guard.ts. Call it from
 * any scheduler:
 *
 *   curl -X POST https://<domain>/api/cron/maintenance \
 *        -H "Authorization: Bearer $CRON_SECRET"
 *
 * Hourly is the intended cadence. Running it more often is harmless: settling
 * finds nothing new inside the staleness window, and pruning is a no-op once
 * the tail is gone.
 *
 * Always answers 200 when the caller is authorised, even if a job failed. The
 * body reports each job separately, and `ok` says whether both succeeded — a
 * scheduler that only watches the status code would otherwise retry a broken
 * prune forever while a working settle rode along with it.
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase/server";
import { requireCron } from "@/lib/maintenance/guard";
import { runMaintenance } from "@/lib/maintenance/sweep";

export const dynamic = "force-dynamic";

/** Pruning a long backlog can walk a lot of rows on the first run. */
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const gate = requireCron(request);
  if (!gate.ok) return gate.response;

  // Overrides are for operators running a one-off from a shell, not for the
  // scheduled call. Every one of them is clamped in sweep.ts rather than
  // trusted — `?days=0` would otherwise erase the entire moderation record.
  const params = request.nextUrl.searchParams;
  const opts = {
    minutes: params.has("minutes") ? Number(params.get("minutes")) : undefined,
    limit: params.has("limit") ? Number(params.get("limit")) : undefined,
    days: params.has("days") ? Number(params.get("days")) : undefined,
  };

  let service;
  try {
    service = getServiceClient();
  } catch (err) {
    // getServiceClient throws when SUPABASE_SERVICE_ROLE_KEY is missing. That
    // is a deployment fault, not a caller fault, and the scheduler should see
    // it as one.
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[maintenance] service client unavailable:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }

  const result = await runMaintenance(service, opts);
  const ok = result.settle.failed === null && result.prune.failed === null;

  console.log("[maintenance] run complete", {
    ok,
    settledUsers: result.settle.users,
    creditsCharged: result.settle.charged,
    rowsPruned: result.prune.rowsDeleted,
    thumbsOrphaned: result.prune.thumbsOrphaned,
  });

  return NextResponse.json({ ok, ...result });
}
