/**
 * Overview — the stats board.
 *
 * Stats are read here, on the server, so the first paint carries real numbers
 * instead of a skeleton that resolves a moment later. The window switcher then
 * refetches through /api/admin/stats without a navigation.
 */

import { requireAdmin } from "@/lib/admin/guard";
import { DEFAULT_WINDOW_DAYS, getAdminStats } from "@/lib/admin/stats";
import { OverviewDashboard } from "@/components/admin/OverviewDashboard";

// The figures must be current per request; a cached dashboard is a dashboard
// that lies about the thing you opened it to check.
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const gate = await requireAdmin();

  // Unreachable in practice — proxy.ts turns a non-admin away before routing.
  // Kept because "unreachable" is a property of today's proxy config, not of
  // this file, and the failure mode if that changes is silent data exposure.
  if (!gate.ok) return null;

  const stats = await getAdminStats(gate.service, DEFAULT_WINDOW_DAYS);

  return (
    <OverviewDashboard
      initial={stats}
      adminEmail={gate.user.email ?? gate.user.id}
    />
  );
}
