/**
 * The admin gate is the only thing standing between a signed-in user and every
 * other user's data, so the cases that matter here are the refusals — and
 * specifically the ones that fail *open* if the code is written slightly wrong.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetAuthedContext, mockMaybeSingle, mockGetServiceClient } =
  vi.hoisted(() => ({
    mockGetAuthedContext: vi.fn(),
    mockMaybeSingle: vi.fn(),
    mockGetServiceClient: vi.fn(),
  }));

vi.mock("@/lib/supabase/server", () => ({
  getAuthedContext: mockGetAuthedContext,
  getServiceClient: mockGetServiceClient,
}));

import { isAdmin, requireAdmin } from "../guard";

const ADMIN_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_ID = "22222222-2222-2222-2222-222222222222";

/** Stands in for the admins-table read: .from().select().eq().maybeSingle() */
function stubAdminsTable() {
  mockGetServiceClient.mockReturnValue({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  stubAdminsTable();
});

describe("isAdmin", () => {
  it("accepts the seeded admin", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { user_id: ADMIN_ID }, error: null });
    await expect(isAdmin(ADMIN_ID)).resolves.toBe(true);
  });

  it("rejects a different user even though a row came back", async () => {
    // The row exists — it just is not theirs. A guard that checked only for
    // the presence of a row would hand this caller the whole dashboard.
    mockMaybeSingle.mockResolvedValue({ data: { user_id: ADMIN_ID }, error: null });
    await expect(isAdmin(OTHER_ID)).resolves.toBe(false);
  });

  it("rejects everyone when no admin is seeded", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(isAdmin(ADMIN_ID)).resolves.toBe(false);
  });

  it("fails closed when the admins table cannot be read", async () => {
    // Missing migration, revoked grant, network blip. None of these mean yes.
    mockMaybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'relation "admins" does not exist' },
    });
    await expect(isAdmin(ADMIN_ID)).resolves.toBe(false);
  });

  it("fails closed when the service client cannot be built", async () => {
    // Thrown, not returned — this is what a missing SUPABASE_SERVICE_ROLE_KEY
    // looks like, and it must be a refusal rather than a 500.
    mockGetServiceClient.mockImplementation(() => {
      throw new Error("Supabase service credentials not configured");
    });
    await expect(isAdmin(ADMIN_ID)).resolves.toBe(false);
  });

  it("fails closed on an undefined user id rather than matching an absent row", async () => {
    // undefined === undefined would be true if the row came back without the
    // column selected. Guard against the shape, not just the value.
    mockMaybeSingle.mockResolvedValue({ data: {}, error: null });
    await expect(isAdmin(undefined as unknown as string)).resolves.toBe(false);
  });
});

describe("requireAdmin", () => {
  it("401s a signed-out caller without touching the admins table", async () => {
    mockGetAuthedContext.mockResolvedValue(null);

    const gate = await requireAdmin();

    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.response.status).toBe(401);
    expect(mockMaybeSingle).not.toHaveBeenCalled();
  });

  it("404s a signed-in non-admin, rather than confirming the surface exists", async () => {
    mockGetAuthedContext.mockResolvedValue({ user: { id: OTHER_ID } });
    mockMaybeSingle.mockResolvedValue({ data: { user_id: ADMIN_ID }, error: null });

    const gate = await requireAdmin();

    expect(gate.ok).toBe(false);
    if (gate.ok) return;
    expect(gate.response.status).toBe(404);
  });

  it("withholds the service client from a non-admin", async () => {
    mockGetAuthedContext.mockResolvedValue({ user: { id: OTHER_ID } });
    mockMaybeSingle.mockResolvedValue({ data: { user_id: ADMIN_ID }, error: null });

    const gate = await requireAdmin();

    // The union has no `service` on the failure branch, so this is really a
    // type-level guarantee — asserted at runtime too, because the whole point
    // of the gate is that the RLS bypass is unreachable without passing it.
    expect(gate).not.toHaveProperty("service");
  });

  it("hands the admin their identity and a service client", async () => {
    const user = { id: ADMIN_ID, email: "admin@example.com" };
    mockGetAuthedContext.mockResolvedValue({ user });
    mockMaybeSingle.mockResolvedValue({ data: { user_id: ADMIN_ID }, error: null });

    const gate = await requireAdmin();

    expect(gate.ok).toBe(true);
    if (!gate.ok) return;
    expect(gate.user).toBe(user);
    expect(gate.service).toBeDefined();
  });
});
