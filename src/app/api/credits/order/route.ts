/**
 * POST /api/credits/order — start a purchase.
 *
 * Body: { packId: string }
 * Returns the Razorpay order the browser then opens Checkout against.
 *
 * The price comes from CREDIT_PACKS on the server, never from the request:
 * a client that could name its own amount could buy 12,000 credits for ₹1.
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthedContext } from "@/lib/supabase/server";
import { findPack } from "@/lib/credits/pricing";
import {
  createRazorpayOrder,
  isRazorpayConfigured,
  razorpayKeyId,
} from "@/lib/credits/razorpay";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const auth = await getAuthedContext();
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  if (!isRazorpayConfigured()) {
    return NextResponse.json(
      {
        error:
          "Payments are not configured. Add NEXT_PUBLIC_RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.local.",
      },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const pack = findPack(body?.packId);

    if (!pack) {
      return NextResponse.json({ error: "Unknown credit pack" }, { status: 400 });
    }

    // Razorpay caps receipt at 40 characters, and a full uuid plus a prefix is
    // over it — the last 12 of the user id is plenty to trace a payment back.
    const receipt = `cr_${pack.id}_${auth.user.id.slice(-12)}_${Date.now()
      .toString(36)
      .slice(-6)}`.slice(0, 40);

    const order = await createRazorpayOrder({
      amountInPaise: pack.amountInPaise,
      currency: pack.currency,
      receipt,
      // Echoed back on the payment and in the webhook. This is what lets the
      // grant path identify the buyer without trusting the browser.
      notes: {
        user_id: auth.user.id,
        pack_id: pack.id,
        credits: String(pack.credits),
      },
    });

    return NextResponse.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: razorpayKeyId(),
      pack: { id: pack.id, name: pack.name, credits: pack.credits },
      userEmail: auth.user.email ?? "",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[credits] order creation failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
