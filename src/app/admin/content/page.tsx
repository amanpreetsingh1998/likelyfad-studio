/**
 * Content — generated output, newest first, for review.
 *
 * The first page is read on the server so the feed paints with real cards;
 * filters, search and paging then go through /api/admin/content.
 */

import { requireAdmin } from "@/lib/admin/guard";
import { getModerationFeed } from "@/lib/admin/moderation";
import { ContentFeed } from "@/components/admin/content/ContentFeed";

// A cached moderation queue is a queue that shows work already done.
export const dynamic = "force-dynamic";

export default async function AdminContentPage() {
  const gate = await requireAdmin();

  // Unreachable in practice — proxy.ts turns a non-admin away before routing.
  if (!gate.ok) return null;

  // Opens on everything rather than on the unreviewed queue: the first
  // question about a new feed is what is in it, and a filtered first paint
  // looks like an empty log.
  const initial = await getModerationFeed(gate.service);

  return <ContentFeed initial={initial} />;
}
