// @vitest-environment node

/**
 * Pure logic — normalisers and a stubbed client — so it runs in node rather
 * than paying for the jsdom environment the config defaults to.
 *
 * The user list is the one admin surface where a wrong answer is invisible.
 *
 * A chart that breaks looks broken. A list that quietly clamps to one row, or
 * shows an empty table because a query failed, looks exactly like a working
 * page reporting a fact — which is why the normalisers and the failure flag
 * are what these tests are about.
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_PAGE_SIZE,
  isSuspended,
  listUsers,
  normalizeOffset,
  normalizePageSize,
  normalizeSearch,
  normalizeSort,
} from "../users";

/** A Supabase client stub with just the rpc surface listUsers touches. */
function stubClient(rpc: (fn: string, args: Record<string, unknown>) => unknown) {
  return { rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => rpc(fn, args)) } as unknown as
    SupabaseClient & { rpc: ReturnType<typeof vi.fn> };
}

describe("normalizePageSize", () => {
  it("treats absent as the default, not as zero", () => {
    // searchParams.get() returns null for a missing param and Number(null) is
    // 0 — which is finite, so a naive check clamps every unparameterised
    // request to a single row.
    expect(normalizePageSize(null)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize("")).toBe(DEFAULT_PAGE_SIZE);
    expect(normalizePageSize("abc")).toBe(DEFAULT_PAGE_SIZE);
  });

  it("clamps to a page a browser can render", () => {
    expect(normalizePageSize(0)).toBe(1);
    expect(normalizePageSize(-5)).toBe(1);
    expect(normalizePageSize(100000)).toBe(100);
    expect(normalizePageSize("40")).toBe(40);
  });
});

describe("normalizeOffset", () => {
  it("refuses a negative offset", () => {
    // Postgres errors on OFFSET -1 rather than treating it as the first page,
    // so the list would fail rather than start over.
    expect(normalizeOffset(-1)).toBe(0);
    expect(normalizeOffset("nope")).toBe(0);
    expect(normalizeOffset("50")).toBe(50);
  });
});

describe("normalizeSort", () => {
  it("accepts only the columns SQL knows how to sort by", () => {
    expect(normalizeSort("balance")).toBe("balance");
    expect(normalizeSort("revenue")).toBe("revenue");
  });

  it("falls back rather than passing an unknown key through", () => {
    // The SQL would ignore it silently, leaving the header highlighting a
    // column the rows are not ordered by.
    expect(normalizeSort("credits_spent; drop table")).toBe("recent");
    expect(normalizeSort(null)).toBe("recent");
    expect(normalizeSort(42)).toBe("recent");
  });
});

describe("normalizeSearch", () => {
  it("treats blank as absent", () => {
    expect(normalizeSearch("   ")).toBeNull();
    expect(normalizeSearch("")).toBeNull();
    expect(normalizeSearch(null)).toBeNull();
  });

  it("trims and caps", () => {
    expect(normalizeSearch("  someone@example.com  ")).toBe("someone@example.com");
    expect(normalizeSearch("x".repeat(5000))?.length).toBe(200);
  });

  it("keeps pattern characters literal", () => {
    // SQL matches with position(), not ilike, so a % is a character to find
    // rather than a wildcard that matches every account.
    expect(normalizeSearch("100%_off")).toBe("100%_off");
  });
});

describe("isSuspended", () => {
  it("reads the ban's expiry, not its presence", () => {
    // GoTrue leaves a lapsed ban's date in place rather than nulling it, so a
    // non-null column does not mean "suspended".
    const past = new Date(Date.now() - 86_400_000).toISOString();
    const future = new Date(Date.now() + 86_400_000).toISOString();

    expect(isSuspended(null)).toBe(false);
    expect(isSuspended(undefined)).toBe(false);
    expect(isSuspended(past)).toBe(false);
    expect(isSuspended(future)).toBe(true);
    expect(isSuspended("not a date")).toBe(false);
  });
});

describe("listUsers", () => {
  const row = {
    user_id: "11111111-1111-4111-8111-111111111111",
    email: "a@example.com",
    total_count: 137,
  };

  it("passes normalised arguments to SQL", async () => {
    const client = stubClient(() => ({ data: [row], error: null }));

    await listUsers(client, {
      search: "  ada  ",
      sort: "nonsense",
      limit: "9999",
      offset: "-3",
    });

    expect(client.rpc).toHaveBeenCalledWith("admin_users_list", {
      p_search: "ada",
      p_sort: "recent",
      p_limit: 100,
      p_offset: 0,
    });
  });

  it("takes the total from the window function, not the page length", async () => {
    const client = stubClient(() => ({ data: [row], error: null }));
    const result = await listUsers(client);

    expect(result.users).toHaveLength(1);
    expect(result.total).toBe(137);
    expect(result.failed).toBe(false);
  });

  it("reports a failed read rather than an empty list", async () => {
    // The whole point of the flag: an empty array from a broken query is
    // indistinguishable from "this app has no users", which is a fact an
    // admin would believe.
    const client = stubClient(() => ({ data: null, error: { message: "boom" } }));
    const result = await listUsers(client);

    expect(result.failed).toBe(true);
    expect(result.users).toEqual([]);
  });

  it("reports a thrown read the same way", async () => {
    const client = stubClient(() => {
      throw new Error("network");
    });
    const result = await listUsers(client);

    expect(result.failed).toBe(true);
  });
});
