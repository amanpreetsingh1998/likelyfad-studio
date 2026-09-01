/**
 * The proxy is the app's authorization gate. Every page a user is not allowed
 * to see is refused here and nowhere else, so this file is the test for who
 * can reach what.
 *
 * Two rules it has to hold at once, and they interact:
 *
 *   1. The studio (/) and the dashboard (/admin/*) are admin-only.
 *   2. A refused non-admin is sent to /workflows.
 *
 * Get rule 2 wrong — send them to "/" as the code used to — and a non-admin
 * hitting /admin is redirected to /, which is also admin-only, which redirects
 * again, forever. A browser reports that as a broken site, not a closed door,
 * so the loop case has a test of its own.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}));

import { proxy } from "../proxy";

const ADMIN = "11111111-1111-1111-1111-111111111111";
const USER = "22222222-2222-2222-2222-222222222222";

/** What the admins table hands back for this request. */
function adminRow(userId: string | null) {
  mockFrom.mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: userId ? { user_id: userId } : null,
          error: null,
        }),
      }),
    }),
  });
}

function signedIn(id: string | null) {
  mockGetUser.mockResolvedValue({ data: { user: id ? { id } : null } });
}

function request(path: string) {
  return new NextRequest(new URL(`http://localhost:3000${path}`));
}

/** Location header, or null when the response was let through. */
async function locationFor(path: string): Promise<string | null> {
  const response = await proxy(request(path));
  const location = response.headers.get("location");
  return location ? new URL(location).pathname + new URL(location).search : null;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "http://supabase.test";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  adminRow(ADMIN);
});

describe("signed out", () => {
  beforeEach(() => signedIn(null));

  it.each(["/", "/workflows", "/admin", "/admin/users"])(
    "sends %s to sign-in, remembering where they were",
    async (path) => {
      expect(await locationFor(path)).toBe(
        `/signin?next=${encodeURIComponent(path)}`
      );
    }
  );

  it.each(["/signin", "/auth/callback", "/auth/error"])(
    "leaves %s reachable, or there is no way back in",
    async (path) => {
      expect(await locationFor(path)).toBeNull();
    }
  );

  // A redirect would hand fetch() an HTML page with a 200 instead of the 401
  // it knows how to handle.
  it.each(["/api/workflows", "/api/credits", "/api/admin/stats"])(
    "lets %s through to gate itself",
    async (path) => {
      expect(await locationFor(path)).toBeNull();
    }
  );
});

describe("signed in, but not the admin", () => {
  beforeEach(() => {
    signedIn(USER);
    adminRow(ADMIN);
  });

  // The rule this change introduced.
  it("refuses the studio", async () => {
    expect(await locationFor("/")).toBe("/workflows");
  });

  it("refuses the dashboard", async () => {
    expect(await locationFor("/admin")).toBe("/workflows");
    expect(await locationFor("/admin/users")).toBe("/workflows");
  });

  // The loop case. Sending them to "/" would bounce straight back here.
  it("never redirects to a page it would refuse again", async () => {
    for (const path of ["/", "/admin", "/admin/audit"]) {
      const target = await locationFor(path);
      expect(target).toBe("/workflows");
      // And the target itself must be reachable, or the loop is just longer.
      expect(await locationFor(target as string)).toBeNull();
    }
  });

  it("lets them have the one page that is theirs", async () => {
    expect(await locationFor("/workflows")).toBeNull();
  });

  it("still lets the API answer for itself", async () => {
    expect(await locationFor("/api/workflows")).toBeNull();
  });
});

describe("signed in as the admin", () => {
  beforeEach(() => {
    signedIn(ADMIN);
    adminRow(ADMIN);
  });

  it.each(["/", "/workflows", "/admin", "/admin/users", "/admin/audit"])(
    "reaches %s",
    async (path) => {
      expect(await locationFor(path)).toBeNull();
    }
  );
});

describe("the gate fails closed", () => {
  beforeEach(() => signedIn(USER));

  // "A row came back" is not a pass — the comparison is what matters.
  it("refuses when the row belongs to someone else", async () => {
    adminRow(ADMIN);
    expect(await locationFor("/")).toBe("/workflows");
  });

  it("refuses when no admin has been seeded", async () => {
    adminRow(null);
    expect(await locationFor("/")).toBe("/workflows");
    expect(await locationFor("/admin")).toBe("/workflows");
  });

  it("refuses when the admins table cannot be read", async () => {
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: null,
            error: { message: "relation does not exist" },
          }),
        }),
      }),
    });
    expect(await locationFor("/admin")).toBe("/workflows");
  });
});

describe("without Supabase credentials", () => {
  // No session to refresh and no way to sign in, so gating would only produce
  // a redirect loop. Deliberately open rather than hard-failing every page.
  it("lets requests through rather than looping", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    expect(await locationFor("/")).toBeNull();
    expect(await locationFor("/admin")).toBeNull();
  });
});
