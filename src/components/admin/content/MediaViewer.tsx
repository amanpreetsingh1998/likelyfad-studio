"use client";

/**
 * The output at full size, opened over the feed.
 *
 * The thumbnail on a card answers "is this worth a second look". This answers
 * the second look, which is the one a suspension actually rests on: text in an
 * image becomes readable, a face becomes identifiable, and video and audio get
 * a record at all — before this they were judged on their prompt alone.
 *
 * WHY A DIALOG AND NOT A NEW TAB
 *
 * The signed URL is short-lived evidence. Opening it in a tab makes it a link
 * in the browser's history that outlives the review and that a moderator can
 * paste somewhere by accident. Kept inside the page, it is gone with the page.
 */

import { useEffect } from "react";
import type { ModerationRow } from "@/lib/admin/moderation";
import { formatDateTime, formatNumber } from "../charts/format";

export function MediaViewer({
  row,
  onClose,
}: {
  row: ModerationRow;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div
        className="absolute inset-0 bg-neutral-950/85"
        onClick={onClose}
        aria-hidden
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Generated output"
        className="relative flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 shadow-2xl"
      >
        <header className="flex items-start gap-4 border-b border-neutral-800 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-neutral-200">
              {row.model_id ?? "unknown model"}
            </p>
            <p className="mt-0.5 truncate text-xs text-neutral-500">
              {row.email ?? row.user_id} · {formatDateTime(row.created_at)}
              {row.media_bytes ? ` · ${formatBytes(row.media_bytes)}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded px-2 py-1 text-sm text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-neutral-950 p-4">
          <Media row={row} />
        </div>

        {(row.prompt || row.output_text) && (
          <footer className="max-h-40 shrink-0 overflow-y-auto border-t border-neutral-800 px-5 py-3">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-neutral-400">
              {row.prompt || row.output_text}
            </p>
          </footer>
        )}
      </div>
    </div>
  );
}

/**
 * Rendered from the stored MIME type, never from the key's extension.
 *
 * A provider CDN link often carries no extension or the wrong one, which is
 * how a webm audio track ends up inside an image tag showing a broken icon.
 */
function Media({ row }: { row: ModerationRow }) {
  // Our archived copy first. Falling back to the provider's link only when
  // there is no copy, and saying so — a link that 404s next week must read as
  // a provider link expiring, not as evidence we lost.
  const src = row.media_url ?? row.media_source_url;
  if (!src) return <Unavailable row={row} />;

  const fromProvider = !row.media_url;
  const type = (row.media_type ?? guessTypeFromKind(row.output_kind ?? row.kind)).toLowerCase();

  if (type.startsWith("video/")) {
    return (
      <Wrap fromProvider={fromProvider}>
        <video
          src={src}
          controls
          autoPlay={false}
          className="max-h-[70vh] w-auto max-w-full rounded"
        />
      </Wrap>
    );
  }

  if (type.startsWith("audio/")) {
    return <Wrap fromProvider={fromProvider}><audio src={src} controls className="w-full max-w-xl" /></Wrap>;
  }

  if (type.startsWith("image/")) {
    return (
      <Wrap fromProvider={fromProvider}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className="max-h-[70vh] w-auto max-w-full rounded object-contain"
        />
      </Wrap>
    );
  }

  // A 3D model, or something whose type we could not identify. There is no
  // viewer for it here, and a download is the honest offer — the alternative
  // is a blank box that reads as a fault.
  return (
    <a
      href={src}
      download
      className="rounded border border-dashed border-neutral-700 px-6 py-10 text-sm text-neutral-300 transition-colors hover:border-neutral-500 hover:text-neutral-100"
    >
      Download output ({row.media_type ?? "unknown type"})
    </a>
  );
}

/**
 * Why there is nothing to show, specifically.
 *
 * Four different facts that all render as an empty box if you let them, and
 * only one of them is a fault worth chasing. A moderator deciding whether to
 * suspend an account needs to know whether the evidence is missing because it
 * was taken down, because it was too large to keep, or because the log broke.
 */
function Unavailable({ row }: { row: ModerationRow }) {
  const reason = row.content_removed_at
    ? "The media for this run was removed by an admin. The prompt and the account are kept."
    : row.status === "pending"
    ? "This run was dispatched to a provider that answers asynchronously and has not come back. There may never be an output."
    : row.status === "failed"
    ? "This run failed, so there is no output to show."
    : row.thumb_url
    ? "Only a thumbnail was kept for this run — the full output was over the size we store, or its provider link had expired by the time we fetched it."
    : "No output was stored for this run.";

  return (
    <div className="max-w-md px-6 py-10 text-center">
      {/* The thumbnail is better than nothing when it is all there is. */}
      {row.thumb_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={row.thumb_url}
          alt=""
          className="mx-auto mb-4 max-h-48 rounded opacity-80"
        />
      )}
      <p className="text-sm text-neutral-400">{reason}</p>
    </div>
  );
}

/**
 * A banner when what is on screen came from the provider rather than our
 * archive. Unlabelled, the two look identical — and only one of them will
 * still be there next week.
 */
function Wrap({
  fromProvider,
  children,
}: {
  fromProvider: boolean;
  children: React.ReactNode;
}) {
  if (!fromProvider) return <>{children}</>;
  return (
    <div className="flex flex-col items-center gap-2">
      <p className="rounded border border-amber-900/60 bg-amber-950/30 px-2.5 py-1 text-[11px] text-amber-300">
        Shown from the provider — we could not archive a copy of this one, so
        this link will stop working when they expire it.
      </p>
      {children}
    </div>
  );
}

/** For a provider link, where we never stored a MIME type of our own. */
function guessTypeFromKind(kind: string): string {
  if (kind === "video") return "video/mp4";
  if (kind === "audio") return "audio/mpeg";
  if (kind === "3d") return "model/gltf-binary";
  return "image/png";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export { formatBytes };
