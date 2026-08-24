/**
 * GET /api/admin/me — who the admin is, to whoever can prove they are them.
 *
 * Small on purpose. It is the canonical shape for every /api/admin/* route
 * that follows, and the smoke test for the gate itself: a signed-out caller
 * gets 401, a signed-in non-admin gets 404, the admin gets their own identity
 * back. Nothing else on this surface is worth wiring until those three hold.
 */

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireAdmin();
  if (!gate.ok) return gate.response;

  return NextResponse.json({
    admin: {
      id: gate.user.id,
      email: gate.user.email ?? null,
    },
  });
}
