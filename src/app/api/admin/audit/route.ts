/**
 * GET /api/admin/audit?action=&target=&q=&limit=&offset= — the action log.
 *
 * Read-only, and there is no route that writes here: rows are written by the
 * handlers that take the actions, and nothing edits or deletes one. An audit
 * log with an edit endpoint is not an audit log.
 *
 * Gated by requireAdmin(): 401 signed out, 404 signed in but not the admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";
import { getAuditLog } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  const params = request.nextUrl.searchParams;
  const log = await getAuditLog(gate.service, {
    action: params.get("action"),
    target: params.get("target"),
    search: params.get("q"),
    limit: params.get("limit"),
    offset: params.get("offset"),
  });

  // 200 with `failed` set rather than a 500 — an empty log and a broken query
  // look identical otherwise, and "nothing has ever been done here" is a
  // reassuring thing to be told wrongly.
  return NextResponse.json(log);
}
