// @vitest-environment node

/**
 * The feed's filters decide what a moderator sees, which means a wrong one
 * hides work rather than breaking visibly. These cover the two ways that
 * happens: a filter that reaches SQL when it should not have, and a failed
 * read that renders as an empty, reassuring queue.
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_FEED_SIZE,
  getModerationFeed,
  normalizeFeedSize,
  normalizeKind,
  normalizeState,
  normalizeUserId,
} from "../moderation";

/**
 * A client stub covering the two rpc calls and the storage signing the feed
 * makes. Signing is stubbed to fail, which is also a case worth holding:
 * unsignable thumbnails must not take the feed down with them.
 */
function stubClient(
  rpc: (fn: string, args: Record<string, unknown>) => unknown
) {
  return {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => rpc(fn, args)),
    storage: {
      from: () => ({
        createSignedUrls: async () => ({
          data: null,
          error: { message: "no bucket" },
        }),
      }),
    },
  } as unknown as SupabaseClient & { rpc: ReturnType<typeof vi.fn> };
}

const ROW = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  thumb_path: "aaaaaaaa.webp",
  moderation_state: "flagged",
  total_count: 12,
};

const COUNTS = {
  total: 12,
  unreviewed: 5,
  flagged: 4,
  cleared: 3,
  removed: 1,
  flagged_users: 2,
};

describe("normalizeState", () => {
  it("accepts only the states the check constraint allows", () => {
    expect(normalizeState("flagged")).toBe("flagged");
    expect(normalizeState("cleared")).toBe("cleared");
    expect(normalizeState("unreviewed")).toBe("unreviewed");
  });

  it("treats anything else as no filter rather than as an error", () => {
    // "All" is a filter the UI offers, so an unknown value degrades to it —
    // but it must not reach SQL, where it would match no row and empty the
    // queue.
    expect(normalizeState("deleted")).toBeNull();
    expect(normalizeState("")).toBeNull();
    expect(normalizeState(null)).toBeNull();
  });
});

describe("normalizeKind", () => {
  it("treats an unset select as no filter", () => {
    // The empty option's value is "", and passing that through would filter
    // the feed down to rows whose kind is the empty string: none of them.
    expect(normalizeKind("")).toBeNull();
    expect(normalizeKind("   ")).toBeNull();
    expect(normalizeKind(null)).toBeNull();
  });

  it("passes a real kind through, capped", () => {
    expect(normalizeKind(" image ")).toBe("image");
    expect(normalizeKind("k".repeat(200))?.length).toBe(40);
  });
});

describe("normalizeUserId", () => {
  it("takes a uuid and nothing else", () => {
    expect(normalizeUserId(ROW.user_id)).toBe(ROW.user_id);
    expect(normalizeUserId("not-a-uuid")).toBeNull();
    expect(normalizeUserId(12)).toBeNull();
  });
});

describe("normalizeFeedSize", () => {
  it("defaults when absent and clamps when absurd", () => {
    expect(normalizeFeedSize(null)).toBe(DEFAULT_FEED_SIZE);
    expect(normalizeFeedSize("abc")).toBe(DEFAULT_FEED_SIZE);
    expect(normalizeFeedSize(0)).toBe(1);
    expect(normalizeFeedSize(9999)).toBe(100);
  });
});

describe("getModerationFeed", () => {
  it("sends normalised filters to SQL", async () => {
    const client = stubClient((fn) =>
      fn === "admin_moderation_counts"
        ? { data: COUNTS, error: null }
        : { data: [ROW], error: null }
    );

    await getModerationFeed(client, {
      search: "  nude  ",
      state: "bogus",
      kind: "",
      userId: "nope",
      limit: "5000",
      offset: "-2",
    });

    expect(client.rpc).toHaveBeenCalledWith("admin_moderation_feed", {
      p_search: "nude",
      p_state: null,
      p_kind: null,
      p_user: null,
      p_limit: 100,
      p_offset: 0,
    });
  });

  it("survives thumbnails it cannot sign", async () => {
    // The picture is the first thing a moderator looks at, but the prompt and
    // the account are what the row is for — losing the signature must not lose
    // the card.
    const client = stubClient((fn) =>
      fn === "admin_moderation_counts"
        ? { data: COUNTS, error: null }
        : { data: [ROW], error: null }
    );

    const feed = await getModerationFeed(client);

    expect(feed.rows).toHaveLength(1);
    expect(feed.rows[0].thumb_url).toBeNull();
    expect(feed.rows[0].moderation_state).toBe("flagged");
    expect(feed.failed).toBe(false);
  });

  it("takes the total from the window function", async () => {
    const client = stubClient((fn) =>
      fn === "admin_moderation_counts"
        ? { data: COUNTS, error: null }
        : { data: [ROW], error: null }
    );

    const feed = await getModerationFeed(client);
    expect(feed.total).toBe(12);
    expect(feed.counts).toEqual(COUNTS);
  });

  it("leaves the tab counts null when only the count query failed", async () => {
    // Null, not zeroed. A zero on the Flagged tab says the queue is clear,
    // which is the one thing it must never say without knowing.
    const client = stubClient((fn) =>
      fn === "admin_moderation_counts"
        ? { data: null, error: { message: "boom" } }
        : { data: [ROW], error: null }
    );

    const feed = await getModerationFeed(client);
    expect(feed.counts).toBeNull();
    expect(feed.rows).toHaveLength(1);
    expect(feed.failed).toBe(false);
  });

  it("reports a failed feed rather than an empty one", async () => {
    const client = stubClient((fn) =>
      fn === "admin_moderation_counts"
        ? { data: COUNTS, error: null }
        : { data: null, error: { message: "boom" } }
    );

    const feed = await getModerationFeed(client);
    expect(feed.failed).toBe(true);
    expect(feed.rows).toEqual([]);
  });
});
