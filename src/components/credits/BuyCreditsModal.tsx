"use client";

/**
 * Buy credits with Razorpay Checkout.
 *
 * The checkout script is loaded on demand rather than in the app shell: most
 * sessions never open this modal, and it is a third-party script on the
 * critical path if it goes in <head>.
 *
 * Nothing here decides a price. The modal posts a pack id, the server looks up
 * what that pack costs, and Razorpay is opened against the order the server
 * created — so a user editing the page cannot buy 12,000 credits for ₹1.
 */

import { useEffect, useState } from "react";
import { useCreditStore } from "@/store/creditStore";
import { formatPackPrice, type CreditPack } from "@/lib/credits/pricing";
import { CREDIT_VALUE_INR } from "@/lib/credits/rates";

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/** Resolves once the Razorpay script is on the page. */
function loadCheckoutScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if ((window as { Razorpay?: unknown }).Razorpay) return resolve();

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${CHECKOUT_SRC}"]`
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Checkout failed to load")));
      return;
    }

    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Checkout failed to load"));
    document.body.appendChild(script);
  });
}

type RazorpayHandlerResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

export function BuyCreditsModal() {
  const open = useCreditStore((s) => s.buyModalOpen);
  const close = useCreditStore((s) => s.closeBuyModal);
  const packs = useCreditStore((s) => s.packs);
  const balance = useCreditStore((s) => s.balance);
  const shortfall = useCreditStore((s) => s.shortfall);
  const purchaseEnabled = useCreditStore((s) => s.purchaseEnabled);
  const refresh = useCreditStore((s) => s.refresh);
  const setBalance = useCreditStore((s) => s.setBalance);

  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Packs arrive with the balance; if the modal is opened before that fetch
  // has happened (a 402 on the very first run) it would otherwise be empty.
  useEffect(() => {
    if (open && packs.length === 0) void refresh();
  }, [open, packs.length, refresh]);

  useEffect(() => {
    if (!open) {
      setError(null);
      setSuccess(null);
      setBusyPack(null);
    }
  }, [open]);

  if (!open) return null;

  async function buy(pack: CreditPack) {
    setError(null);
    setSuccess(null);
    setBusyPack(pack.id);

    try {
      await loadCheckoutScript();

      const orderResponse = await fetch("/api/credits/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: pack.id }),
      });

      const order = await orderResponse.json();
      if (!orderResponse.ok) {
        throw new Error(order?.error ?? `Could not start checkout (HTTP ${orderResponse.status})`);
      }

      const Razorpay = (window as unknown as { Razorpay: new (opts: unknown) => { open: () => void } }).Razorpay;

      const checkout = new Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        order_id: order.orderId,
        name: "Likelyfad Studio",
        description: `${pack.name} — ${pack.credits.toLocaleString()} credits`,
        prefill: { email: order.userEmail },
        theme: { color: "#f59e0b" },
        // Razorpay calls this after a successful payment. The credits are not
        // granted here — this only asks our server to verify and grant. If the
        // tab dies before this fires, the webhook grants them anyway.
        handler: async (response: RazorpayHandlerResponse) => {
          try {
            const verifyResponse = await fetch("/api/credits/verify", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(response),
            });
            const result = await verifyResponse.json();
            if (!verifyResponse.ok) {
              throw new Error(result?.error ?? "Verification failed");
            }
            setBalance(result.balance);
            setSuccess(`${result.credited.toLocaleString()} credits added.`);
            void refresh();
          } catch (err) {
            // The money is taken but the grant did not land. Say so plainly —
            // the webhook will almost certainly settle it within seconds.
            setError(
              `Payment succeeded but crediting failed: ${
                err instanceof Error ? err.message : "unknown error"
              }. Your credits should appear shortly — refresh in a minute.`
            );
          } finally {
            setBusyPack(null);
          }
        },
        modal: {
          ondismiss: () => setBusyPack(null),
        },
      });

      checkout.open();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setBusyPack(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
      onClick={close}
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-neutral-800 px-5 py-4">
          <div>
            <h2 className="text-base font-medium text-neutral-100">Buy credits</h2>
            <p className="mt-0.5 text-xs text-neutral-400">
              {shortfall ? (
                <span className="text-amber-300">
                  That run needs {shortfall.required.toLocaleString()} credits — you have{" "}
                  {shortfall.balance.toLocaleString()}.
                </span>
              ) : (
                <>Balance: {(balance ?? 0).toLocaleString()} credits</>
              )}
            </p>
          </div>
          <button
            onClick={close}
            className="text-neutral-500 transition-colors hover:text-neutral-200"
            aria-label="Close"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {!purchaseEnabled && (
          <div className="mx-5 mt-4 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Payments are not configured yet. Add <code>NEXT_PUBLIC_RAZORPAY_KEY_ID</code> and{" "}
            <code>RAZORPAY_KEY_SECRET</code> to <code>.env.local</code>.
          </div>
        )}

        {error && (
          <div className="mx-5 mt-4 rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}

        {success && (
          <div className="mx-5 mt-4 rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            {success}
          </div>
        )}

        <div className="grid gap-3 p-5 sm:grid-cols-3">
          {packs.map((pack) => (
            <div
              key={pack.id}
              className={`relative flex flex-col rounded-lg border p-4 ${
                pack.popular
                  ? "border-amber-500/60 bg-amber-500/5"
                  : "border-neutral-700 bg-neutral-800/40"
              }`}
            >
              {pack.popular && (
                <span className="absolute -top-2 right-3 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-medium text-black">
                  Popular
                </span>
              )}
              <div className="text-sm font-medium text-neutral-200">{pack.name}</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums text-neutral-100">
                {pack.credits.toLocaleString()}
              </div>
              <div className="text-xs text-neutral-500">credits</div>
              <div className="mt-3 text-lg font-medium text-neutral-200">
                {formatPackPrice(pack)}
              </div>
              <button
                onClick={() => void buy(pack)}
                disabled={busyPack !== null || !purchaseEnabled}
                className={`mt-4 rounded px-3 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  pack.popular
                    ? "bg-amber-500 text-black hover:bg-amber-400"
                    : "bg-neutral-700 text-neutral-100 hover:bg-neutral-600"
                }`}
              >
                {busyPack === pack.id ? "Opening…" : "Buy"}
              </button>
            </div>
          ))}
        </div>

        <p className="border-t border-neutral-800 px-5 py-3 text-[11px] text-neutral-500">
          {/* The peg, stated. Without it a balance in credits is a number with
              no meaning — which is exactly the confusion this line exists to
              remove. */}
          1 credit ≈ ₹{CREDIT_VALUE_INR.toFixed(2)}. Your workflow is billed once
          when the run finishes, for the steps that actually ran.
        </p>
      </div>
    </div>
  );
}
