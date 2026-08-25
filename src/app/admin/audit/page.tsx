/**
 * Audit — every action taken from this dashboard.
 *
 * First page read on the server like the others. `?target=` narrows it to one
 * account, which is how the Users drawer links to an account's history.
 */

import { requireAdmin } from "@/lib/admin/guard";
import { getAuditLog } from "@/lib/admin/audit";
import { AuditLog } from "@/components/admin/audit/AuditLog";

// A cached audit log is a log that has not caught up with the thing you are
// checking it for.
export const dynamic = "force-dynamic";

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ target?: string; action?: string; q?: string }>;
}) {
  const gate = await requireAdmin();

  // Unreachable in practice — proxy.ts turns a non-admin away before routing.
  if (!gate.ok) return null;

  const { target, action, q } = await searchParams;
  const initial = await getAuditLog(gate.service, { target, action, search: q });

  return <AuditLog initial={initial} />;
}
