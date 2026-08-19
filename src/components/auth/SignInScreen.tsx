"use client";

import { SignInPanel } from "./SignInPanel";
import { SignInSplash } from "./SignInSplash";

/**
 * Full-page sign-in: the canvas on the left, the form on the right.
 *
 * The splash collapses below lg, leaving the panel centred on its own — on a
 * phone the form is the only thing worth the width.
 */
export function SignInScreen() {
  return (
    <div className="flex h-screen bg-neutral-950">
      <SignInSplash />
      <div className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-10 lg:max-w-[480px]">
        <SignInPanel />
      </div>
    </div>
  );
}
