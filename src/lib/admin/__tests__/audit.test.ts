// @vitest-environment node

/**
 * An audit log is read when something has already gone wrong, so its failure
 * modes matter more than most: a filter that silently matches everything, a
 * broken query that renders as "nothing was ever done here", and a details
 * renderer that drops the one key it was not written to expect.
 */

import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_LOG_SIZE,
  actionLabel,
  describeDetail,
  getAuditLog,
  isDestructive,
  normalizeAction,
  normalizeLogSize,
  normalizeTarget,
} from "../audit";

function stubClient(rpc: (fn: string, args: Record<string, unknown>) => unknown) {
  return {
    rpc: vi.fn(async (fn: string, args: Record<string, unknown>) => rpc(fn, args)),
  } as unknown as SupabaseClient & { rpc: ReturnType<typeof vi.fn> };
}

const ROW = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  actor_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  actor_email: "admin@example.com",
  action: "grant_credits",
  target_user_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  target_email: "user@example.com",
  target_exists: true,
  details: { amount: 500, reason: "Goodwill" },
  created_at: "2026-08-25T10:00:00Z",
  total_count: 3,
};

const SUMMARY = {
  total: 3,
  by_action: { grant_credits: 2, delete_user: 1 },
  first_at: "2026-08-01T00:00:00Z",
  last_at: "2026-08-25T10:00:00Z",
};

describe("normalizeAction", () => {
  it("treats blank as no filter", () => {
    expect(normalizeAction("")).toBeNull();
    expect(normalizeAction("  ")).toBeNull();
    expect(normalizeAction(null)).toBeNull();
  });

  it("passes an unknown action through rather than dropping the filter", () => {
    // The column is free text and a later version may write actions this
    // build has never heard of. Whitelisting here would turn a chip for one
    // of them into "show me everything", which is the opposite of what the
    // reader asked for.
    expect(normalizeAction("archive_project")).toBe("archive_project");
    expect(normalizeAction("x".repeat(200))?.length).toBe(40);
  });
});

describe("normalizeTarget", () => {
  it("takes a uuid and nothing else", () => {
    expect(normalizeTarget(ROW.target_user_id)).toBe(ROW.target_user_id);
    expect(normalizeTarget("user@example.com")).toBeNull();
  });
});

describe("normalizeLogSize", () => {
  it("defaults when absent and clamps when absurd", () => {
    expect(normalizeLogSize(null)).toBe(DEFAULT_LOG_SIZE);
    expect(normalizeLogSize("abc")).toBe(DEFAULT_LOG_SIZE);
    expect(normalizeLogSize(0)).toBe(1);
    expect(normalizeLogSize(100000)).toBe(200);
  });
});

describe("actionLabel and isDestructive", () => {
  it("names the actions it knows and echoes the ones it does not", () => {
    expect(actionLabel("delete_user")).toBe("Deleted account");
    // An unlabelled action still has to render as something, and the stored
    // value is the honest fallback.
    expect(actionLabel("archive_project")).toBe("archive_project");
  });

  it("marks only the irreversible ones", () => {
    expect(isDestructive("delete_user")).toBe(true);
    expect(isDestructive("remove_content")).toBe(true);
    expect(isDestructive("grant_credits")).toBe(false);
    expect(isDestructive("suspend")).toBe(false);
  });
});

describe("describeDetail", () => {
  it("formats the keys it knows", () => {
    expect(describeDetail("amount", 500)).toBe("500 credits");
    expect(describeDetail("reason", "spam")).toContain("spam");
    expect(describeDetail("state", "flagged")).toBe("set to flagged");
  });

  it("shows an unknown key rather than dropping it", () => {
    // details is jsonb so a new action can record what it needs without a
    // migration. A renderer that only knew today's keys would quietly hide
    // tomorrow's evidence.
    expect(describeDetail("shadow_banned", true)).toBe("shadow_banned: true");
  });

  it("omits the keys that exist only to make a row reconstructable", () => {
    expect(describeDetail("request_id", "abc")).toBe("");
    expect(describeDetail("signed_up_at", "2026-01-01")).toBe("");
  });

  it("renders nothing for an absent value", () => {
    expect(describeDetail("reason", null)).toBe("");
    expect(describeDetail("amount", undefined)).toBe("");
  });
});

describe("getAuditLog", () => {
  it("sends normalised filters to SQL", async () => {
    const client = stubClient((fn) =>
      fn === "admin_actions_summary"
        ? { data: SUMMARY, error: null }
        : { data: [ROW], error: null }
    );

    await getAuditLog(client, {
      action: "  suspend  ",
      target: "not-a-uuid",
      search: "  ada  ",
      limit: "9999",
      offset: "-4",
    });

    expect(client.rpc).toHaveBeenCalledWith("admin_actions_list", {
      p_action: "suspend",
      p_target: null,
      p_search: "ada",
      p_limit: 200,
      p_offset: 0,
    });
  });

  it("takes the total from the window function", async () => {
    const client = stubClient((fn) =>
      fn === "admin_actions_summary"
        ? { data: SUMMARY, error: null }
        : { data: [ROW], error: null }
    );

    const log = await getAuditLog(client);
    expect(log.total).toBe(3);
    expect(log.rows[0].target_exists).toBe(true);
    expect(log.summary?.by_action.delete_user).toBe(1);
  });

  it("leaves the chip counts null when only the summary failed", async () => {
    const client = stubClient((fn) =>
      fn === "admin_actions_summary"
        ? { data: null, error: { message: "boom" } }
        : { data: [ROW], error: null }
    );

    const log = await getAuditLog(client);
    expect(log.summary).toBeNull();
    expect(log.rows).toHaveLength(1);
    expect(log.failed).toBe(false);
  });

  it("reports a failed read rather than an empty log", async () => {
    // "No admin actions recorded" is a reassuring thing to be told, and the
    // worst possible thing to be told wrongly.
    const client = stubClient((fn) =>
      fn === "admin_actions_summary"
        ? { data: SUMMARY, error: null }
        : { data: null, error: { message: "boom" } }
    );

    const log = await getAuditLog(client);
    expect(log.failed).toBe(true);
    expect(log.rows).toEqual([]);
  });
});
