/**
 * GET /api/admin/stats?days=30 — everything the Overview page draws.
 *
 * The page renders these server-side on first load, so this route exists for
 * the window switcher, which refetches without a navigation.
 *
 * Gated by requireAdmin() like every route under /api/admin: 401 signed out,
 * 404 signed in but not the admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getAdminStats, normalizeWindow } from "@/lib/admin/stats";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const days = normalizeWindow(request.nextUrl.searchParams.get("days"));
  const stats = await getAdminStats(gate.service, days);

  // 200 even when panels failed. `stats.failed` names them and the UI says so
  // per panel — a 500 here would replace a mostly-working dashboard with
  // nothing at the moment it is most needed.
  return NextResponse.json(stats);
}
