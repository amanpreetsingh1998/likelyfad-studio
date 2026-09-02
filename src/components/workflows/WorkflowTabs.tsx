/**
 * Workflows | Runs.
 *
 * LINKS, NOT CLIENT STATE. The whole page is built to first-paint with real
 * numbers instead of a skeleton that resolves a moment later — that is why
 * `page.tsx` reads a page on the server and seeds the list with it. A tab held
 * in React state would throw that away for the second tab: opening Runs would
 * always cost a fetch and a loading state, which is precisely the shape this
 * page was written to avoid.
 *
 * It also makes a tab addressable. `?tab=runs` can be linked, bookmarked and
 * refreshed into; a tab that lives only in state loses its place on every
 * reload and cannot be sent to anyone.
 *
 * The links deliberately carry no other query. `?q=` on the workflows tab
 * searches workflow names; the runs feed searches its own, and inheriting a
 * needle typed for a different list would show a filtered page that the user
 * never asked for and did not see themselves type.
 */

import Link from "next/link";

export type WorkflowTab = "workflows" | "runs";

/** Anything unrecognised is the workflow list — the tab that always has content. */
export function normaliseTab(value: string | undefined): WorkflowTab {
  return value === "runs" ? "runs" : "workflows";
}

const TABS: { key: WorkflowTab; href: string; label: string }[] = [
  { key: "workflows", href: "/workflows", label: "Workflows" },
  { key: "runs", href: "/workflows?tab=runs", label: "Runs" },
];

export function WorkflowTabs({ active }: { active: WorkflowTab }) {
  return (
    <nav
      aria-label="Workflow views"
      className="mb-6 flex items-center gap-1 border-b border-neutral-800"
    >
      {TABS.map((tab) => {
        const current = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
              current
                ? "border-neutral-200 text-neutral-100"
                : "border-transparent text-neutral-500 hover:border-neutral-700 hover:text-neutral-300"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
