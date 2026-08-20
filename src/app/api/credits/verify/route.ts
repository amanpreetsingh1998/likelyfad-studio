/**
 * POST /api/credits/verify — grant credits after a successful checkout.
 *
 * Body: { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 *
 * Three independent checks before a single credit is granted:
 *   1. the HMAC signature proves Razorpay produced this callback,
 *   2. a fetch of the payment proves it actually captured (a signature is
 *      valid on a failed payment too),
 *   3. the credit amount comes from the order's own `notes`, not the request.
 *
 * This is the fast path — the user is watching a spinner. The webhook at
 * ./webhook is the slow path that catches the case where the browser closes
 * before this fires. Both grant under the same `ref`, so whichever arrives
 * second is absorbed by the ledger's unique index.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import { grantCredits } from "@/lib/credits/server";
import { findPack } from "@/lib/credits/pricing";
import {
  fetchRazorpayPayment,
  verifyCheckoutSignature,
} from "@/lib/credits/razorpay";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const orderId = body?.razorpay_order_id;
    const paymentId = body?.razorpay_payment_id;
    const signature = body?.razorpay_signature;

    if (!orderId || !paymentId || !signature) {
      return NextResponse.json(
        { error: "razorpay_order_id, razorpay_payment_id and razorpay_signature are required" },
        { status: 400 }
      );
    }

    // 1. Did Razorpay sign this?
    if (!verifyCheckoutSignature({ orderId, paymentId, signature })) {
      console.warn("[credits] rejected payment with bad signature", { paymentId });
      return NextResponse.json(
        { error: "Payment signature verification failed" },
        { status: 400 }
      );
    }

    // 2. Did it actually capture, and is it the buyer's own payment?
    const payment = await fetchRazorpayPayment(paymentId);

    if (payment.order_id !== orderId) {
      return NextResponse.json(
        { error: "Payment does not belong to this order" },
        { status: 400 }
      );
    }

    if (payment.status !== "captured" && payment.status !== "authorized") {
      return NextResponse.json(
        { error: `Payment is not complete (status: ${payment.status})` },
        { status: 400 }
      );
    }

    // The notes were written by us at order creation, so this identifies the
    // buyer independently of who is calling. A signed-in user replaying
    // someone else's payment id gets nothing.
    if (payment.notes?.user_id !== auth.user.id) {
      console.warn("[credits] payment/user mismatch", {
        paymentId,
        caller: auth.user.id,
      });
      return NextResponse.json(
        { error: "Payment does not belong to this account" },
        { status: 403 }
      );
    }

    // 3. Amount from the server-side pack table, cross-checked against what
    //    Razorpay says was charged.
    const pack = findPack(payment.notes?.pack_id ?? "");
    if (!pack) {
      return NextResponse.json(
        { error: "Payment refers to an unknown credit pack" },
        { status: 400 }
      );
    }

    if (payment.amount !== pack.amountInPaise) {
      console.error("[credits] amount mismatch", {
        paymentId,
        paid: payment.amount,
        expected: pack.amountInPaise,
      });
      return NextResponse.json(
        { error: "Paid amount does not match the pack price" },
        { status: 400 }
      );
    }

    const balance = await grantCredits({
      userId: auth.user.id,
      amount: pack.credits,
      kind: "purchase",
      reason: `${pack.name} pack`,
      ref: `razorpay:${paymentId}`,
      metadata: {
        order_id: orderId,
        payment_id: paymentId,
        pack_id: pack.id,
        amount_paise: payment.amount,
      },
    });

    return NextResponse.json({ success: true, balance, credited: pack.credits });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[credits] verify failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
