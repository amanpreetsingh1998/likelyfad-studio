/**
 * A run's status, with the distinction that matters spelled out on hover.
 *
 * SHARED RATHER THAN COPIED, and that is the point of the file. Two feeds show
 * run status now — one workflow's runs in the drawer, and every run in the
 * Runs tab — and the semantics here are not decoration:
 *
 *   `cancelled` is a decision the user made.
 *   `abandoned` is a tab that closed, swept later by maintenance.
 *
 * They look identical in the ledger and mean different things to whoever is
 * asking why a run stopped. A second copy of this chip is a second place for
 * that distinction to be quietly collapsed into "it did not finish", which
 * would tell a user they stopped something they did not.
 */

export function RunStatusChip({ status }: { status: string }) {
  const style =
    status === "completed"
      ? "border-emerald-900/60 bg-emerald-950/40 text-emerald-300"
      : status === "running"
      ? "border-sky-900/60 bg-sky-950/40 text-sky-300"
      : status === "failed"
      ? "border-red-900/60 bg-red-950/40 text-red-300"
      : "border-neutral-700 bg-neutral-800/60 text-neutral-400";

  const title =
    status === "abandoned"
      ? "The browser never reported how this run ended — usually a closed tab. It was closed out by the maintenance sweep, and its charges were still settled."
      : status === "cancelled"
      ? "Stopped from the canvas. Nodes that had already reached a provider were still charged."
      : status === "running"
      ? "Still going, or the tab closed before it reported back. Maintenance closes a run left open too long as abandoned."
      : undefined;

  return (
    <span
      title={title}
      className={`rounded-full border px-2 py-0.5 text-[11px] ${style} ${
        title ? "cursor-help" : ""
      }`}
    >
      {status}
    </span>
  );
}
