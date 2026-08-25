/**
 * Users — every account, what they spend, and what they have made.
 *
 * The first page is read here, on the server, so the table paints with real
 * rows; search, sort and paging then go through /api/admin/users without a
 * navigation. Same shape as the Overview page, for the same reason.
 */

import { requireAdmin } from "@/lib/admin/guard";
import { listUsers } from "@/lib/admin/users";
import { UsersDashboard } from "@/components/admin/users/UsersDashboard";

// Accounts, balances and suspensions must be current per request. A cached
// user list is a list that shows a suspended account as active.
export const dynamic = "force-dynamic";

export default async function AdminUsersPage({
  searchParams,
}: {
  // ?q= is how the Content feed links to an account: a card names the email,
  // and following it should land on that account rather than on page one of
  // everyone.
  searchParams: Promise<{ q?: string }>;
}) {
  const gate = await requireAdmin();

  // Unreachable in practice — proxy.ts turns a non-admin away before routing.
  // Kept for the reason the Overview page keeps it: "unreachable" is a
  // property of today's proxy config, not of this file.
  if (!gate.ok) return null;

  const { q } = await searchParams;
  const initial = await listUsers(gate.service, { search: q });

  return (
    <UsersDashboard
      initial={initial}
      adminId={gate.user.id}
      initialSearch={initial.search ?? ""}
    />
  );
}
