/**
 * GET /api/credits — the signed-in user's balance, packs, and recent ledger.
 *
 * One round trip so the header badge and the buy modal can share a fetch.
 *
 * PENDING IS REPORTED TOO, AND THAT IS THE POINT.
 *
 * This route used to answer with the ledger balance alone, while the balance
 * header on a generation response reported the ledger balance MINUS unsettled
 * charges. Both were correct and they were answering different questions, so
 * every reload appeared to hand the user their credits back: the badge had
 * been counting down against pending charges the reload knew nothing about.
 *
 * Sending both numbers is what makes the two agree. The client subtracts them
 * in one place (`availableCredits`) rather than each surface deciding for
 * itself which figure it meant.
 */

import { NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import {
  getBalance,
  getPendingTotal,
  getRecentTransactions,
} from "@/lib/credits/server";
import { CREDIT_PACKS, SIGNUP_GRANT_CREDITS } from "@/lib/credits/pricing";
import { isRazorpayConfigured } from "@/lib/credits/razorpay";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const [balance, pending, transactions] = await Promise.all([
      getBalance(auth.user.id),
      getPendingTotal(auth.user.id),
      getRecentTransactions(auth.user.id),
    ]);

    return NextResponse.json({
      balance,
      pending,
      // Sent already computed as well as in parts. The client derives it
      // anyway; having the server state it means a future caller that reads
      // only one field reads the spendable one.
      available: Math.max(0, balance - pending),
      transactions,
      packs: CREDIT_PACKS,
      signupGrant: SIGNUP_GRANT_CREDITS,
      // The modal shows a "payments not configured" note rather than opening a
      // checkout that would fail on the first click.
      purchaseEnabled: isRazorpayConfigured(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[credits] balance read failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
