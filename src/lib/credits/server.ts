/**
 * Credit operations, server side only.
 *
 * Every function here goes through the service-role client, because the SQL
 * functions are granted to service_role alone (see 0003_credits.sql §5). That
 * is the deliberate shape: a user must not be able to call grant_credits() on
 * themselves from the browser console. The ownership check that makes this
 * safe is the caller's job — every route below is entered only after
 * getAuthedContext() has verified the JWT, and passes that verified id.
 */

import { getServiceClient } from "@/lib/supabase/server";
import type { RunCostInput } from "./pricing";

export class InsufficientCreditsError extends Error {
  readonly required: number;
  readonly balance: number;

  constructor(required: number, balance: number) {
    super(
      `Not enough credits: this run costs ${required}, balance is ${balance}.`
    );
    this.name = "InsufficientCreditsError";
    this.required = required;
    this.balance = balance;
  }
}

/** Current balance. Returns 0 for a user with no row yet. */
export async function getBalance(userId: string): Promise<number> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("user_credits")
    .select("balance")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not read credit balance: ${error.message}`);
  return data?.balance ?? 0;
}

/**
 * Record a node run that has already happened, to be billed at settlement.
 *
 * Returns the user's new unsettled total, which the route stamps on the
 * response so the UI can show a live "this run so far" figure.
 */
export async function recordPendingCharge(
  userId: string,
  credits: number,
  cost: RunCostInput
): Promise<number> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("record_pending_charge", {
    p_user_id: userId,
    p_credits: credits,
    p_kind: cost.kind,
    p_model_id: cost.modelId ?? null,
  });

  if (error) throw new Error(`Could not record charge: ${error.message}`);
  return (data as number) ?? 0;
}

/** Credits this user has run up but not yet been billed for. */
export async function getPendingTotal(userId: string): Promise<number> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("pending_charges")
    .select("credits")
    .eq("user_id", userId)
    .is("settled_at", null);

  if (error) throw new Error(`Could not read pending charges: ${error.message}`);
  return (data ?? []).reduce((sum, row) => sum + (row.credits as number), 0);
}

export type SettlementResult = {
  /** Credits actually debited. */
  charged: number;
  /** Balance after the debit. */
  balance: number;
  /** How many node runs this covered. */
  runs: number;
  /** Credits owed that the balance could not cover. Normally 0. */
  shortfall: number;
};

/**
 * Bill everything this user has run since their last settlement, in one debit.
 *
 * Called when a workflow finishes. Idempotent in the way that matters: it bills
 * unsettled rows and marks them settled, so calling it twice charges once.
 */
export async function settlePendingCharges(
  userId: string,
  reason = "Workflow run"
): Promise<SettlementResult> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("settle_pending_charges", {
    p_user_id: userId,
    p_reason: reason,
  });

  if (error) throw new Error(`Could not settle run: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { charged: 0, balance: 0, runs: 0, shortfall: 0 };

  return {
    charged: row.charged as number,
    balance: row.balance as number,
    runs: row.runs as number,
    shortfall: row.shortfall as number,
  };
}

/**
 * Throw away pending charges for a workflow that never dispatched anything.
 * Nothing was spent, so there is nothing to bill.
 */
export async function discardPendingCharges(userId: string): Promise<number> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("discard_pending_charges", {
    p_user_id: userId,
  });
  if (error) {
    console.error("[credits] discard failed:", error.message);
    return 0;
  }
  return (data as number) ?? 0;
}

/** Add credits — used by the Razorpay grant path and any admin top-up. */
export async function grantCredits(params: {
  userId: string;
  amount: number;
  kind: "purchase" | "admin" | "signup" | "refund";
  reason?: string;
  /** Idempotency key. A repeat is a no-op returning the current balance. */
  ref?: string;
  metadata?: Record<string, unknown>;
}): Promise<number> {
  const supabase = getServiceClient();
  const { data, error } = await supabase.rpc("grant_credits", {
    p_user_id: params.userId,
    p_amount: params.amount,
    p_kind: params.kind,
    p_reason: params.reason ?? null,
    p_ref: params.ref ?? null,
    p_metadata: params.metadata ?? {},
  });

  if (error) throw new Error(`Could not grant credits: ${error.message}`);
  return (data as number) ?? 0;
}

export type LedgerEntry = {
  id: string;
  amount: number;
  kind: string;
  reason: string | null;
  created_at: string;
};

/** Recent ledger rows, newest first — the "history" list in the UI. */
export async function getRecentTransactions(
  userId: string,
  limit = 25
): Promise<LedgerEntry[]> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from("credit_transactions")
    .select("id, amount, kind, reason, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Could not read ledger: ${error.message}`);
  return (data ?? []) as LedgerEntry[];
}
