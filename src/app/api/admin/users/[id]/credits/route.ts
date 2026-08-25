/**
 * POST /api/admin/users/[id]/credits — move credits by hand.
 *
 *   { amount, reason, requestId? }   → a grant   (kind 'admin')
 *   { transactionId, reason? }       → a refund  (kind 'refund')
 *
 * Both go through grant_credits(), which is the only writer of the balance
 * (0003 §3) — this route never touches user_credits directly, for the same
 * reason nothing else does: the ledger is the truth and the balance is
 * maintained from it.
 *
 * BOTH PATHS ARE IDEMPOTENT, BY REF.
 *
 * A refund's ref is the refunded spend's own id, so refunding twice pays out
 * once. A grant's ref is a request id the client mints per submission, so a
 * double-click or a retried request grants once. The partial unique index on
 * (user_id, ref) is what enforces it — not a check in this file.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getUserDetail, logAdminAction } from "@/lib/admin/users";
import { grantCredits } from "@/lib/credits/server";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A ceiling on a hand-typed grant.
 *
 * Not a policy about generosity — a guard against a slipped zero. Credits are
 * money owed as compute, and there is no "undo grant": taking them back would
 * mean a debit the balance might no longer cover.
 */
const MAX_MANUAL_GRANT = 100_000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: {
    amount?: unknown;
    reason?: unknown;
    requestId?: unknown;
    transactionId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const target = await getUserDetail(gate.service, id).catch(() => null);
  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : null;

  // ---------------------------------------------------------------- refund
  if (typeof body.transactionId === "string") {
    const txnId = body.transactionId;
    if (!UUID_RE.test(txnId)) {
      return NextResponse.json(
        { error: "transactionId is not a transaction" },
        { status: 400 }
      );
    }

    // Filtered by user_id as well as id. Matching on the transaction alone
    // would let a mistyped id refund one account's spend into another's
    // balance — the same reasoning as the poll route's (user_id, task_id).
    const { data: txn, error: txnError } = await gate.service
      .from("credit_transactions")
      .select("id, amount, kind, reason")
      .eq("id", txnId)
      .eq("user_id", id)
      .maybeSingle();

    if (txnError) {
      return NextResponse.json({ error: txnError.message }, { status: 500 });
    }
    if (!txn) {
      return NextResponse.json(
        { error: "No such transaction for this account." },
        { status: 404 }
      );
    }
    if (txn.kind !== "spend" || txn.amount >= 0) {
      return NextResponse.json(
        { error: "Only a spend can be refunded." },
        { status: 400 }
      );
    }

    const amount = Math.abs(txn.amount as number);

    try {
      const balance = await grantCredits({
        userId: id,
        amount,
        kind: "refund",
        reason: reason ?? `Refund: ${txn.reason ?? "run"}`,
        // The spend's own id. A second attempt hits the unique index and
        // returns the current balance unchanged.
        ref: txn.id as string,
        metadata: { refund_of: txn.id, by: gate.user.email ?? gate.user.id },
      });

      await logAdminAction(gate.service, {
        actorId: gate.user.id,
        actorEmail: gate.user.email ?? null,
        action: "refund",
        targetUserId: id,
        targetEmail: target.email,
        details: { amount, transaction_id: txn.id, reason },
      });

      return NextResponse.json({ ok: true, amount, balance });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Refund failed" },
        { status: 500 }
      );
    }
  }

  // ----------------------------------------------------------------- grant
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive whole number of credits." },
      { status: 400 }
    );
  }
  if (amount > MAX_MANUAL_GRANT) {
    return NextResponse.json(
      { error: `A single grant is capped at ${MAX_MANUAL_GRANT} credits.` },
      { status: 400 }
    );
  }

  const requestId =
    typeof body.requestId === "string" && UUID_RE.test(body.requestId)
      ? body.requestId
      : crypto.randomUUID();

  try {
    const balance = await grantCredits({
      userId: id,
      amount,
      kind: "admin",
      reason: reason ?? "Admin grant",
      ref: `admin:${requestId}`,
      metadata: { by: gate.user.email ?? gate.user.id, request_id: requestId },
    });

    await logAdminAction(gate.service, {
      actorId: gate.user.id,
      actorEmail: gate.user.email ?? null,
      action: "grant_credits",
      targetUserId: id,
      targetEmail: target.email,
      details: { amount, reason, request_id: requestId },
    });

    return NextResponse.json({ ok: true, amount, balance });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Grant failed" },
      { status: 500 }
    );
  }
}
