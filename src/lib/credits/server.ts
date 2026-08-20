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
import { creditCostForRun, type RunCostInput } from "./pricing";

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

export type SpendResult = {
  /** Ledger row id. Hand this to refundSpend() if the run then fails. */
  transactionId: string;
  /** Balance after the debit. */
  balance: number;
  /** What was charged. */
  charged: number;
};

/**
 * Debit for a run, atomically.
 *
 * Charged UP FRONT rather than on success, because the expensive half is the
 * provider call and it happens whether or not we like the result. Async video
 * jobs make this sharper still: /api/generate returns a task id long before
 * any money is spent downstream, so there is no later moment at which we could
 * reliably charge. refundSpend() is the compensating half for runs that never
 * reach the provider at all.
 */
export async function spendForRun(
  userId: string,
  cost: RunCostInput,
  reason: string,
  metadata: Record<string, unknown> = {}
): Promise<SpendResult> {
  const charged = creditCostForRun(cost);
  const supabase = getServiceClient();

  const { data, error } = await supabase.rpc("spend_credits", {
    p_user_id: userId,
    p_amount: charged,
    p_reason: reason,
    p_metadata: { ...metadata, ...cost },
  });

  if (error) {
    // The SQL raises this by name when the conditional UPDATE matches nothing.
    if (error.message.includes("insufficient_credits")) {
      throw new InsufficientCreditsError(charged, await getBalance(userId));
    }
    throw new Error(`Could not charge credits: ${error.message}`);
  }

  // The function RETURNS TABLE, so PostgREST hands back an array of one row.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Could not charge credits: no result from ledger");

  return {
    transactionId: row.transaction_id as string,
    balance: row.balance as number,
    charged,
  };
}

/**
 * Give back a spend that never became a provider call.
 *
 * Keyed on the spend's own transaction id, so a retried refund is absorbed by
 * the ledger's unique index rather than paying out twice. Never throws: a
 * failed refund must not turn a failed generation into a 500 that hides the
 * original error, so it logs and moves on.
 */
export async function refundSpend(
  userId: string,
  transactionId: string,
  amount: number,
  reason: string
): Promise<void> {
  try {
    const supabase = getServiceClient();
    const { error } = await supabase.rpc("grant_credits", {
      p_user_id: userId,
      p_amount: amount,
      p_kind: "refund",
      p_reason: reason,
      p_ref: `refund:${transactionId}`,
      p_metadata: { refunded_transaction: transactionId },
    });
    if (error) {
      console.error("[credits] refund failed:", error.message, { transactionId });
    }
  } catch (err) {
    console.error("[credits] refund threw:", err);
  }
}

/** Add credits — used by the Razorpay grant path and any admin top-up. */
export async function grantCredits(params: {
  userId: string;
  amount: number;
  kind: "purchase" | "admin" | "signup";
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
