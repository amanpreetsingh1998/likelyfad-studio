"use client";

import { SignInPanel } from "./SignInPanel";

/** Full-page sign-in. The form itself lives in SignInPanel. */
export function SignInScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-neutral-950 px-6">
      <SignInPanel />
    </div>
  );
}
