/**
 * The generation log is the only record of what users make, so the cases that
 * matter are the ones where it would silently record nothing, record the wrong
 * thing, or let one user's run be attributed to another.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetServiceClient, mockMakeThumbnail } = vi.hoisted(() => ({
  mockGetServiceClient: vi.fn(),
  mockMakeThumbnail: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getServiceClient: mockGetServiceClient,
}));

vi.mock("../thumbnail", () => ({ makeThumbnail: mockMakeThumbnail }));

import {
  completeGenerationEvent,
  outputFromPayload,
  promptFromBody,
  recordGenerationEvent,
} from "../events";

const USER = "11111111-1111-1111-1111-111111111111";
const EVENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

/** Captures what was written, so assertions read the row rather than the calls. */
let inserted: Record<string, unknown> | null;
let updated: Record<string, unknown> | null;
let uploaded: { path: string } | null;
/** Every key uploaded for this call — thumbnail and full media both. */
let uploads: string[];
let selectFilters: Record<string, unknown>;
let selectResult: { data: unknown; error: unknown };
let insertResult: { data: unknown; error: unknown };

function stubSupabase() {
  mockGetServiceClient.mockReturnValue({
    from: () => ({
      insert: (row: Record<string, unknown>) => {
        inserted = row;
        return { select: () => ({ single: async () => insertResult }) };
      },
      update: (row: Record<string, unknown>) => {
        updated = row;
        return { eq: () => Promise.resolve({ error: null }) };
      },
      select: () => {
        const chain = {
          eq: (col: string, val: unknown) => {
            selectFilters[col] = val;
            return chain;
          },
          maybeSingle: async () => selectResult,
        };
        return chain;
      },
    }),
    storage: {
      from: () => ({
        upload: async (path: string) => {
          uploaded = { path };
          uploads.push(path);
          return { error: null };
        },
      }),
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  inserted = null;
  updated = null;
  uploaded = null;
  uploads = [];
  selectFilters = {};
  selectResult = { data: null, error: null };
  insertResult = { data: { id: EVENT }, error: null };
  mockMakeThumbnail.mockResolvedValue(null);
  stubSupabase();
});

describe("recordGenerationEvent", () => {
  it("records the run and returns the event id", async () => {
    const id = await recordGenerationEvent({
      userId: USER,
      kind: "image",
      modelId: "nano-banana-pro",
      provider: "google",
      prompt: "a cat",
      creditsCharged: 7,
      status: "succeeded",
    });

    expect(id).toBe(EVENT);
    expect(inserted).toMatchObject({
      user_id: USER,
      kind: "image",
      model_id: "nano-banana-pro",
      prompt: "a cat",
      credits_charged: 7,
      status: "succeeded",
    });
  });

  it("never throws when the insert fails — a broken log is not the user's error", async () => {
    insertResult = { data: null, error: { message: "relation does not exist" } };

    await expect(
      recordGenerationEvent({ userId: USER, kind: "image", status: "succeeded" })
    ).resolves.toBeNull();
  });

  it("never throws when the client itself blows up", async () => {
    mockGetServiceClient.mockImplementation(() => {
      throw new Error("Supabase service credentials not configured");
    });

    await expect(
      recordGenerationEvent({ userId: USER, kind: "image", status: "succeeded" })
    ).resolves.toBeNull();
  });

  it("still records the row when the thumbnail cannot be made", async () => {
    // The prompt, model and user are what moderation turns on. Losing the
    // picture must not lose the record.
    mockMakeThumbnail.mockResolvedValue(null);
    // And the archive copy fails too — an expired provider link.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 } as Response));

    const id = await recordGenerationEvent({
      userId: USER,
      kind: "video",
      prompt: "a dog",
      status: "succeeded",
      output: "https://cdn.example/clip.mp4",
    });

    expect(id).toBe(EVENT);
    expect(uploads).toEqual([]);
    // Nothing was stored, but the row still learns where the output WAS. That
    // distinction — "we tried and could not" versus "this run made nothing" —
    // is the one a moderator has to be able to draw.
    expect(updated).toMatchObject({
      media_source_url: "https://cdn.example/clip.mp4",
    });
    expect(updated?.media_path).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("records nothing extra when there was no output at all", async () => {
    mockMakeThumbnail.mockResolvedValue(null);

    await recordGenerationEvent({
      userId: USER,
      kind: "llm",
      prompt: "a dog",
      status: "succeeded",
    });

    // No thumbnail, no archive, no source — so no second write to make.
    expect(uploads).toEqual([]);
    expect(updated).toBeNull();
  });

  it("does not put an inline data URL in the source column", async () => {
    // The output itself, not a link to it. Storing it would put the whole
    // payload in a text column for no benefit.
    mockMakeThumbnail.mockResolvedValue(null);

    await recordGenerationEvent({
      userId: USER,
      kind: "image",
      status: "succeeded",
      output: "data:image/png;base64,QQ==",
    });

    expect(updated?.media_source_url).toBeUndefined();
  });

  it("stores the thumbnail under the event id, with no user prefix", async () => {
    // A per-user prefix is the shape that invites a "users may touch their own
    // prefix" policy — which would let the subject delete the evidence.
    mockMakeThumbnail.mockResolvedValue({
      body: Buffer.from("x"),
      contentType: "image/webp",
    });

    await recordGenerationEvent({
      userId: USER,
      kind: "image",
      status: "succeeded",
      output: "data:image/png;base64,AAAA",
    });

    const thumb = uploads.find((key) => key.endsWith(".webp"));
    expect(thumb).toBe(`${EVENT}.webp`);
    // No user prefix, ever: a per-user path is the shape that invites an
    // owner-scoped policy, which would hand the subject their own evidence.
    for (const key of uploads) expect(key).not.toContain(USER);
    expect(updated).toMatchObject({ thumb_path: `${EVENT}.webp` });
  });

  it("truncates a pathological prompt rather than storing it whole", async () => {
    await recordGenerationEvent({
      userId: USER,
      kind: "image",
      prompt: "x".repeat(5000),
      status: "succeeded",
    });

    expect((inserted?.prompt as string).length).toBeLessThanOrEqual(2001);
  });

  it("leaves completed_at null while a run is still pending", async () => {
    await recordGenerationEvent({
      userId: USER,
      kind: "video",
      status: "pending",
      taskId: "task-1",
    });

    expect(inserted).toMatchObject({ completed_at: null, task_id: "task-1" });
  });
});

describe("completeGenerationEvent", () => {
  it("matches on user AND task, never task alone", async () => {
    // Task ids come from the provider. Matching one on its own would let a
    // user complete — and read — someone else's run by guessing it.
    selectResult = { data: { id: EVENT }, error: null };

    await completeGenerationEvent({
      userId: USER,
      taskId: "task-1",
      status: "succeeded",
    });

    expect(selectFilters).toMatchObject({
      user_id: USER,
      task_id: "task-1",
      status: "pending",
    });
  });

  it("does nothing when there is no matching pending row", async () => {
    selectResult = { data: null, error: null };

    await completeGenerationEvent({
      userId: USER,
      taskId: "unknown",
      status: "succeeded",
    });

    expect(updated).toBeNull();
  });

  it("never throws when the lookup errors", async () => {
    selectResult = { data: null, error: { message: "boom" } };

    await expect(
      completeGenerationEvent({ userId: USER, taskId: "t", status: "succeeded" })
    ).resolves.toBeUndefined();
  });
});

describe("promptFromBody", () => {
  it("prefers the top-level prompt", () => {
    expect(promptFromBody({ prompt: "top" })).toBe("top");
  });

  it("falls back to dynamicInputs for schema-driven models", () => {
    expect(promptFromBody({ dynamicInputs: { prompt: "nested" } })).toBe("nested");
  });

  it("joins an array prompt, which schema inputs may deliver", () => {
    expect(promptFromBody({ dynamicInputs: { prompt: ["a", "b"] } })).toBe("a b");
  });

  it("returns null for image-to-image runs that carry no prompt", () => {
    expect(promptFromBody({ images: ["data:..."] })).toBeNull();
    expect(promptFromBody({ prompt: "   " })).toBeNull();
  });
});

describe("outputFromPayload", () => {
  it.each([
    ["image", "image"],
    ["video", "video"],
    ["videoUrl", "video"],
    ["audio", "audio"],
    ["audioUrl", "audio"],
    ["model3dUrl", "3d"],
  ])("reads %s as a %s output", (field, kind) => {
    expect(outputFromPayload({ [field]: "value" })).toEqual({
      output: "value",
      outputKind: kind,
    });
  });

  it("returns nulls for a payload with no media", () => {
    expect(outputFromPayload({ success: true })).toEqual({
      output: null,
      outputKind: null,
    });
    expect(outputFromPayload(null)).toEqual({ output: null, outputKind: null });
  });
});
