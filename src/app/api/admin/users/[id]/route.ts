/**
 * One account: read it, suspend it, or delete it.
 *
 *   GET    /api/admin/users/[id]  — detail plus the drawer's three tabs
 *   PATCH  /api/admin/users/[id]  — { action: "suspend" | "unsuspend" }
 *   DELETE /api/admin/users/[id]  — { confirmEmail } — irreversible
 *
 * Every mutating path writes an admin_actions row. The log is the only place
 * these operations leave a trace: a suspension is a column on a GoTrue row
 * that says nothing about who set it or why, and a delete leaves nothing at
 * all.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import {
  getUserDetail,
  getUserGenerations,
  getUserLedger,
  getUserProjects,
  isSuspended,
  logAdminAction,
} from "@/lib/admin/users";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GoTrue expresses an indefinite ban as a very distant expiry rather than a
 * flag, so "suspended" is a duration. A hundred years is the conventional
 * stand-in for forever.
 */
const BAN_FOREVER = "876000h";

function badId() {
  // 404, not 400. The gate above already answers 404 to a non-admin; a
  // different status for a malformed id would tell an unauthorised caller
  // that their id was the only thing wrong.
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

/** Everything the drawer shows, in one round trip per tab. */
async function readTabs(service: SupabaseClient, userId: string) {
  const [projects, generations, ledger] = await Promise.allSettled([
    getUserProjects(service, userId),
    getUserGenerations(service, userId),
    getUserLedger(service, userId),
  ]);

  // One broken tab costs that tab. The failed list is named rather than
  // silently empty, for 0007's reason: an empty tab and a broken one are
  // different facts, and only one of them is a number to believe.
  const failed: string[] = [];
  if (projects.status === "rejected") failed.push("projects");
  if (generations.status === "rejected") failed.push("generations");
  if (ledger.status === "rejected") failed.push("ledger");

  return {
    projects: projects.status === "fulfilled" ? projects.value : [],
    generations: generations.status === "fulfilled" ? generations.value : [],
    ledger: ledger.status === "fulfilled" ? ledger.value.rows : [],
    ledgerTotal: ledger.status === "fulfilled" ? ledger.value.total : 0,
    failed,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();

  try {
    const user = await getUserDetail(gate.service, id);
    if (!user) return badId();

    const tabs = await readTabs(gate.service, id);
    return NextResponse.json({ user, ...tabs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not read account" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();

  // Locking the only admin out of their own account is not a decision anyone
  // makes on purpose, and there is no second admin to undo it.
  if (id === gate.user.id) {
    return NextResponse.json(
      { error: "You cannot suspend your own account." },
      { status: 400 }
    );
  }

  let body: { action?: string; reason?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const suspend = body.action === "suspend";
  if (!suspend && body.action !== "unsuspend") {
    return NextResponse.json(
      { error: 'action must be "suspend" or "unsuspend"' },
      { status: 400 }
    );
  }

  const target = await getUserDetail(gate.service, id).catch(() => null);
  if (!target) return badId();

  const { error } = await gate.service.auth.admin.updateUserById(id, {
    // "none" is GoTrue's clear-the-ban value; an empty string is rejected.
    ban_duration: suspend ? BAN_FOREVER : "none",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await logAdminAction(gate.service, {
    actorId: gate.user.id,
    actorEmail: gate.user.email ?? null,
    action: suspend ? "suspend" : "unsuspend",
    targetUserId: id,
    targetEmail: target.email,
    details: { reason: body.reason?.slice(0, 500) ?? null },
  });

  const user = await getUserDetail(gate.service, id).catch(() => null);
  return NextResponse.json({
    ok: true,
    // The ban takes effect when the user's access token next needs refreshing,
    // which is up to its lifetime away (an hour by default). Reported rather
    // than glossed: an admin who suspends someone mid-workflow should not be
    // told the session is already dead.
    effective: "next token refresh",
    suspended: isSuspended(user?.banned_until ?? null),
    user,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!UUID_RE.test(id)) return badId();

  if (id === gate.user.id) {
    return NextResponse.json(
      { error: "You cannot delete your own account." },
      { status: 400 }
    );
  }

  let body: { confirmEmail?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const target = await getUserDetail(gate.service, id).catch(() => null);
  if (!target) return badId();

  // Typed confirmation, compared server-side. The dialog checks it too, but a
  // client-side check is a courtesy and this is the last irreversible step in
  // the whole dashboard.
  const typed = (body.confirmEmail ?? "").trim().toLowerCase();
  if (!typed || typed !== (target.email ?? "").trim().toLowerCase()) {
    return NextResponse.json(
      { error: "Type the account's email address to confirm." },
      { status: 400 }
    );
  }

  // Collected BEFORE the delete, because generation_events cascades with the
  // account. These objects are about to become unreachable — the rows that
  // point at them are going — so removing them is cleanup, not the loss. The
  // loss is the rows, which is what the confirmation is for.
  const thumbs = await gate.service
    .from("generation_events")
    .select("thumb_path")
    .eq("user_id", id)
    .not("thumb_path", "is", null)
    .then(
      ({ data }) =>
        (data ?? [])
          .map((row) => row.thumb_path as string | null)
          .filter((path): path is string => !!path),
      () => [] as string[]
    );

  // Snapshot the figures worth keeping before they cascade away. After this
  // call the uuid resolves to nothing, so whatever is not in the log is gone.
  const snapshot = {
    balance: target.balance,
    credits_spent: target.credits.spent,
    lifetime_paise: target.credits.lifetime_paise,
    generations: target.runs.total,
    projects: target.projects,
    signed_up_at: target.created_at,
    thumbnails_removed: thumbs.length,
  };

  const { error } = await gate.service.auth.admin.deleteUser(id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (thumbs.length > 0) {
    const { error: storageError } = await gate.service.storage
      .from("moderation")
      .remove(thumbs);
    // Orphaned files are waste, not a failed delete. The account is already
    // gone by this point, so this cannot be reported as an error.
    if (storageError) {
      console.error("[admin] thumbnail cleanup failed:", storageError.message);
    }
  }

  await logAdminAction(gate.service, {
    actorId: gate.user.id,
    actorEmail: gate.user.email ?? null,
    action: "delete_user",
    targetUserId: id,
    targetEmail: target.email,
    details: snapshot,
  });

  return NextResponse.json({ ok: true, deleted: target.email });
}
