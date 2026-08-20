/**
 * Razorpay, over plain fetch and node:crypto.
 *
 * No SDK: the two things we need from Razorpay's server API are "create an
 * order" (one authenticated POST) and "verify a signature" (one HMAC). The
 * official package would add a dependency to wrap those, and its bundled types
 * drag in Node globals that Next's route bundler then has to resolve. The REST
 * shape here is stable and documented at
 * https://razorpay.com/docs/api/orders/create.
 *
 * Environment (add to .env.local):
 *   NEXT_PUBLIC_RAZORPAY_KEY_ID   — the key id; public by design, the browser
 *                                   checkout needs it
 *   RAZORPAY_KEY_SECRET           — server only, never expose
 *   RAZORPAY_WEBHOOK_SECRET       — server only, set when you add the webhook
 *                                   in the Razorpay dashboard
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const RAZORPAY_API = "https://api.razorpay.com/v1";

export function razorpayKeyId(): string {
  const id = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
  if (!id) throw new Error("NEXT_PUBLIC_RAZORPAY_KEY_ID is not configured");
  return id;
}

function razorpayKeySecret(): string {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) throw new Error("RAZORPAY_KEY_SECRET is not configured");
  return secret;
}

/** True when both halves of the key pair are present. */
export function isRazorpayConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  );
}

function authHeader(): string {
  const token = Buffer.from(
    `${razorpayKeyId()}:${razorpayKeySecret()}`
  ).toString("base64");
  return `Basic ${token}`;
}

export type RazorpayOrder = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  receipt?: string;
  notes?: Record<string, string>;
};

/**
 * Create an order. `notes` is the important part: Razorpay echoes it back on
 * the payment and in the webhook, which is how the grant path knows which user
 * and which pack a payment belongs to without trusting anything the browser
 * sends back to us.
 */
export async function createRazorpayOrder(params: {
  amountInPaise: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}): Promise<RazorpayOrder> {
  const response = await fetch(`${RAZORPAY_API}/orders`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amountInPaise,
      currency: params.currency,
      receipt: params.receipt,
      notes: params.notes,
      payment_capture: 1,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Razorpay order creation failed (${response.status}): ${text.slice(0, 300)}`
    );
  }

  return (await response.json()) as RazorpayOrder;
}

export type RazorpayPayment = {
  id: string;
  order_id: string;
  status: string;
  amount: number;
  currency: string;
  notes?: Record<string, string>;
};

/**
 * Fetch a payment from Razorpay.
 *
 * The checkout callback's signature proves the browser was not tampering, but
 * it does not prove the payment actually captured — so the grant path asks
 * Razorpay directly rather than believing a status the client passed along.
 */
export async function fetchRazorpayPayment(
  paymentId: string
): Promise<RazorpayPayment> {
  const response = await fetch(`${RAZORPAY_API}/payments/${paymentId}`, {
    headers: { Authorization: authHeader() },
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Razorpay payment lookup failed (${response.status}): ${text.slice(0, 300)}`
    );
  }

  return (await response.json()) as RazorpayPayment;
}

/** Constant-time compare, so a wrong signature leaks nothing through timing. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify the signature Razorpay Checkout hands the browser on success.
 * Signed payload is `order_id|payment_id`, HMAC-SHA256 with the key secret.
 */
export function verifyCheckoutSignature(params: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const expected = createHmac("sha256", razorpayKeySecret())
    .update(`${params.orderId}|${params.paymentId}`)
    .digest("hex");
  return safeEqual(expected, params.signature);
}

/**
 * Verify a webhook delivery. Signed payload is the raw request body, HMAC
 * -SHA256 with the WEBHOOK secret — a different secret from the key secret,
 * and a common thing to get wrong.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}
