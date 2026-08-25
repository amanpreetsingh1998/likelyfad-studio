/**
 * Act on one generation.
 *
 *   PATCH  /api/admin/content/[id]  — { state: "flagged" | "cleared" | "unreviewed", reason? }
 *   DELETE /api/admin/content/[id]  — remove the thumbnail, keep the record
 *
 * Both write an admin_actions row. The event carries the current state; the
 * log carries who decided it and when — deriving one from the other was the
 * design 0009's header rejected.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import {
  normalizeState,
  removeContent,
  setModerationState,
} from "@/lib/admin/moderation";
import { logAdminAction } from "@/lib/admin/users";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/**
 * The account's email, for the log's snapshot.
 *
 * Read through the same detail function the Users page uses rather than
 * joining it into every feed row: an action is rare, a feed page is not.
 */
async function targetEmail(
  service: Parameters<typeof logAdminAction>[0],
  userId: string
): Promise<string | null> {
  const { data } = await service.rpc("admin_user_detail", { p_user_id: userId });
  return (data as { email?: string } | null)?.email ?? null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();

  let body: { state?: unknown; reason?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const state = normalizeState(body.state);
  if (!state) {
    return NextResponse.json(
      { error: 'state must be "unreviewed", "flagged" or "cleared"' },
      { status: 400 }
    );
  }

  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : null;

  try {
    const row = await setModerationState(
      gate.service,
      id,
      state,
      gate.user.id,
      reason
    );
    if (!row) return notFound();

    await logAdminAction(gate.service, {
      actorId: gate.user.id,
      actorEmail: gate.user.email ?? null,
      action: state === "flagged" ? "flag_content" : "clear_content",
      targetUserId: row.user_id,
      targetEmail: await targetEmail(gate.service, row.user_id),
      details: { event_id: id, state, reason },
    });

    return NextResponse.json({ ok: true, id, state });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not update" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!UUID_RE.test(id)) return notFound();

  let reason: string | null = null;
  try {
    const body = await request.json();
    if (typeof body?.reason === "string" && body.reason.trim()) {
      reason = body.reason.trim().slice(0, 500);
    }
  } catch {
    // A body is optional here — removing a picture needs no argument, unlike
    // deleting an account.
  }

  try {
    const row = await removeContent(gate.service, id);
    if (!row) return notFound();

    await logAdminAction(gate.service, {
      actorId: gate.user.id,
      actorEmail: gate.user.email ?? null,
      action: "remove_content",
      targetUserId: row.user_id,
      targetEmail: await targetEmail(gate.service, row.user_id),
      details: { event_id: id, reason },
    });

    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not remove" },
      { status: 500 }
    );
  }
}
