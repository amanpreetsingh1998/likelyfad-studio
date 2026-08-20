/**
 * POST /api/credits/webhook — Razorpay's server-to-server payment notice.
 *
 * The safety net for the money path. /api/credits/verify only runs if the
 * user's browser survives long enough to call it; a closed tab, a dead phone
 * or a redirect-based payment method all leave a captured payment with no
 * credits granted. Razorpay retries this endpoint until it gets a 2xx.
 *
 * Setup: Razorpay dashboard → Settings → Webhooks → add
 *   URL:    https://<your-domain>/api/credits/webhook
 *   Events: payment.captured
 *   Secret: the same value as RAZORPAY_WEBHOOK_SECRET in .env.local
 *
 * There is no session here — the caller is Razorpay, not a user. The signature
 * IS the authentication, which is why the raw body has to be read before any
 * parsing: re-serialising JSON changes the bytes and breaks the HMAC.
 */

import { NextRequest, NextResponse } from "next/server";
import { grantCredits } from "@/lib/credits/server";
import { findPack } from "@/lib/credits/pricing";
import { verifyWebhookSignature } from "@/lib/credits/razorpay";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const signature = request.headers.get("x-razorpay-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  // Raw text, not request.json() — see the note above.
  const rawBody = await request.text();

  if (!verifyWebhookSignature(rawBody, signature)) {
    console.warn("[credits] webhook rejected: bad signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  try {
    const event = JSON.parse(rawBody);

    if (event?.event !== "payment.captured") {
      // Acknowledged, ignored. A non-2xx would make Razorpay retry an event we
      // are never going to act on.
      return NextResponse.json({ received: true, ignored: event?.event });
    }

    const payment = event?.payload?.payment?.entity;
    const userId = payment?.notes?.user_id;
    const pack = findPack(payment?.notes?.pack_id ?? "");

    if (!userId || !pack) {
      console.warn("[credits] webhook payment missing notes", {
        paymentId: payment?.id,
      });
      // Still a 200: nothing we can do with it, and a retry would not help.
      return NextResponse.json({ received: true, ignored: "missing notes" });
    }

    if (payment.amount !== pack.amountInPaise) {
      console.error("[credits] webhook amount mismatch", {
        paymentId: payment.id,
        paid: payment.amount,
        expected: pack.amountInPaise,
      });
      return NextResponse.json({ received: true, ignored: "amount mismatch" });
    }

    // Same ref as the verify route — whichever path arrives second is a no-op.
    await grantCredits({
      userId,
      amount: pack.credits,
      kind: "purchase",
      reason: `${pack.name} pack`,
      ref: `razorpay:${payment.id}`,
      metadata: {
        order_id: payment.order_id,
        payment_id: payment.id,
        pack_id: pack.id,
        amount_paise: payment.amount,
        source: "webhook",
      },
    });

    return NextResponse.json({ received: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[credits] webhook failed:", message);
    // A 500 makes Razorpay retry, which is what we want for a transient
    // database failure on a payment that really did capture.
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
