/**
 * The workflows shell.
 *
 * A plain server component with no gate of its own: proxy.ts sends a
 * signed-out visitor to /signin before this ever routes. Same arrangement, and
 * same reasoning, as the admin layout.
 *
 * Narrower than /admin's max-w-7xl. The cards here are four figures and a
 * title; stretched to the admin width their columns drift far enough apart
 * that the eye stops associating a number with its label.
 */

import Link from "next/link";

export default function WorkflowsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <nav className="border-b border-neutral-800">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
          <Link
            href="/"
            className="text-sm text-neutral-400 transition-colors hover:text-neutral-100"
          >
            ← Studio
          </Link>
          <span className="text-sm text-neutral-600">/</span>
          <span className="text-sm text-neutral-200">Workflows</span>
        </div>
      </nav>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
