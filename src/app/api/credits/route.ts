/**
 * GET /api/credits — the signed-in user's balance, packs, and recent ledger.
 *
 * One round trip so the header badge and the buy modal can share a fetch.
 */

import { NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import { getBalance, getRecentTransactions } from "@/lib/credits/server";
import { CREDIT_PACKS, SIGNUP_GRANT_CREDITS } from "@/lib/credits/pricing";
import { isRazorpayConfigured } from "@/lib/credits/razorpay";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const [balance, transactions] = await Promise.all([
      getBalance(auth.user.id),
      getRecentTransactions(auth.user.id),
    ]);

    return NextResponse.json({
      balance,
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
