"use client";

import { useEffect } from "react";
import { useAuthGateStore } from "@/store/authGateStore";
import { SignInPanel } from "./SignInPanel";

/**
 * Sign-in raised over the canvas by requireAuth().
 *
 * Deliberately an overlay rather than a route: the canvas underneath stays
 * mounted, so whatever the visitor had built is still there afterwards and the
 * action that was blocked can pick up where it left off.
 */
export function SignInModal() {
  const isOpen = useAuthGateStore((s) => s.isOpen);
  const reason = useAuthGateStore((s) => s.reason);
  const close = useAuthGateStore((s) => s.close);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, close]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 px-6"
      // The canvas swallows wheel events for zoom; stop them at the overlay.
      onWheelCapture={(e) => e.stopPropagation()}
      onClick={close}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm rounded-xl border border-neutral-700 bg-neutral-950 px-6 py-8 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <SignInPanel reason={reason} />
      </div>
    </div>
  );
}
