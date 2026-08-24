import { PlaceholderPanel } from "@/components/admin/PlaceholderPanel";

export const dynamic = "force-dynamic";

export default function AdminUsersPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-100">Users</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Every account, what they spend, and what they have made.
        </p>
      </div>

      <PlaceholderPanel
        title="User table"
        phase="Phase 3"
        items={[
          "Email, name, signed up, last active, balance, lifetime ₹, credits spent",
          "Projects, generations, flag count, account status",
          "Row detail: Overview / Projects / Generations / Ledger / Flags",
          "Actions: grant credits, refund, suspend, delete, view-as",
        ]}
        note="Buildable against existing data — auth.users, user_credits, credit_transactions and pending_charges already carry every column above except generations and flags, which Phase 1 starts recording."
      />
    </div>
  );
}
