/**
 * Overview — the stats board, once Phase 2 lands.
 *
 * For now it confirms the gate works end to end and names the admin whose
 * session got through, which is the one thing worth seeing on a surface whose
 * whole purpose is that almost nobody can reach it.
 */

import { requireAdmin } from "@/lib/admin/guard";
import { PlaceholderPanel } from "@/components/admin/PlaceholderPanel";

// The admins lookup must run per request; a cached admin identity is a stale
// answer to the only question this page asks.
export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const gate = await requireAdmin();

  // Unreachable in practice — proxy.ts turns a non-admin away before routing.
  // Kept because "unreachable" is a property of today's proxy config, not of
  // this file, and the failure mode if that changes is silent data exposure.
  if (!gate.ok) return null;

  const email = gate.user.email ?? gate.user.id;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Overview</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Signed in as <span className="text-neutral-200">{email}</span> — the
          sole admin.
        </p>
      </div>

      <PlaceholderPanel
        title="Statistics"
        phase="Phase 2"
        items={[
          "Signups, activation funnel, DAU/WAU/MAU, retention cohorts",
          "₹ revenue, credits purchased, paying users, pack mix",
          "Credit liability outstanding, burn rate, free-tier subsidy",
          "Runs by model and provider, success rate, p50/p95 latency",
          "Realized margin per model — provider USD vs credits billed vs ₹ collected",
          "Unsettled pending charges, unpriced-model 409s, error breakdown",
        ]}
        note="Revenue, credits, signups and run counts are all derivable from data you already store, so these charts need no new writes — only the API route and the chart components."
      />
    </div>
  );
}
