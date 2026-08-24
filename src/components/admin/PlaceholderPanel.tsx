/**
 * A panel standing in for a surface that is planned but not built.
 *
 * Exists so the shell is honest: an empty page reads as broken, and a page
 * full of zeroed-out charts reads as working-but-wrong. This says what is
 * coming and which phase owns it.
 *
 * Delete each usage as the real surface replaces it.
 */

export function PlaceholderPanel({
  title,
  phase,
  items,
  note,
}: {
  title: string;
  phase: string;
  items: string[];
  note?: string;
}) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-5">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-medium text-neutral-200">{title}</h2>
        <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[11px] font-medium text-neutral-400">
          {phase}
        </span>
      </div>

      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li
            key={item}
            className="flex gap-2.5 text-sm text-neutral-400 leading-relaxed"
          >
            <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-600" />
            {item}
          </li>
        ))}
      </ul>

      {note && (
        <p className="mt-4 border-t border-neutral-800 pt-3 text-xs leading-relaxed text-neutral-500">
          {note}
        </p>
      )}
    </section>
  );
}
