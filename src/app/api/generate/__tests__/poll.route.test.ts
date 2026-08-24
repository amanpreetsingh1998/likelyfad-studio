/**
 * The poll route was unauthenticated until the moderation log needed a user to
 * attribute completions to. Closing it was a security fix as much as a feature
 * one, so the cases below pin the refusal — and specifically that it happens
 * before the server's Kie key is spent.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const {
  mockGetAuthedContext,
  mockCheckKieTaskOnce,
  mockFetchKieMediaResult,
  mockCompleteGenerationEvent,
} = vi.hoisted(() => ({
  mockGetAuthedContext: vi.fn(),
  mockCheckKieTaskOnce: vi.fn(),
  mockFetchKieMediaResult: vi.fn(),
  mockCompleteGenerationEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  getAuthedContext: mockGetAuthedContext,
}));

vi.mock("../providers/kie", () => ({
  checkKieTaskOnce: mockCheckKieTaskOnce,
  fetchKieMediaResult: mockFetchKieMediaResult,
  isVeoModel: () => false,
}));

vi.mock("@/lib/moderation/events", () => ({
  completeGenerationEvent: mockCompleteGenerationEvent,
}));

// Runs the deferred work inline so assertions do not race the response.
vi.mock("@/lib/moderation/defer", () => ({
  deferAfterResponse: (work: () => Promise<unknown>) => {
    void work();
  },
}));

import { POST } from "../poll/route";

const USER = "11111111-1111-1111-1111-111111111111";

function pollRequest(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/generate/poll", {
    method: "POST",
    body: JSON.stringify({
      taskId: "task-1",
      provider: "kie",
      modelId: "veo-3",
      modelName: "Veo 3",
      mediaType: "video",
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.KIE_API_KEY = "test-key";
  mockGetAuthedContext.mockResolvedValue({ user: { id: USER } });
});

describe("POST /api/generate/poll", () => {
  it("401s a signed-out caller", async () => {
    mockGetAuthedContext.mockResolvedValue(null);

    const response = await POST(pollRequest());

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Not signed in");
  });

  it("refuses before spending the provider key", async () => {
    // The whole point of the fix: an anonymous caller could previously burn
    // KIE_API_KEY quota just by hitting this endpoint.
    mockGetAuthedContext.mockResolvedValue(null);

    await POST(pollRequest());

    expect(mockCheckKieTaskOnce).not.toHaveBeenCalled();
  });

  it("still rejects a bad body before asking who is calling", async () => {
    const response = await POST(pollRequest({ taskId: "" }));

    expect(response.status).toBe(400);
    expect(mockGetAuthedContext).not.toHaveBeenCalled();
  });

  it("completes the pending event against the caller's own id", async () => {
    mockCheckKieTaskOnce.mockResolvedValue({ status: "completed", data: {} });
    mockFetchKieMediaResult.mockResolvedValue({
      success: true,
      outputs: [{ url: "https://cdn.example/clip.mp4", mimeType: "video/mp4" }],
    });

    await POST(pollRequest());

    expect(mockCompleteGenerationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        taskId: "task-1",
        status: "succeeded",
        output: "https://cdn.example/clip.mp4",
      })
    );
  });

  it("records a provider failure rather than leaving the row pending forever", async () => {
    mockCheckKieTaskOnce.mockResolvedValue({
      status: "failed",
      error: "content policy",
    });

    const response = await POST(pollRequest());

    expect(response.status).toBe(500);
    expect(mockCompleteGenerationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER, status: "failed" })
    );
  });

  it("does not touch the log while the task is still processing", async () => {
    mockCheckKieTaskOnce.mockResolvedValue({ status: "processing" });

    const response = await POST(pollRequest());

    expect((await response.json()).polling).toBe(true);
    expect(mockCompleteGenerationEvent).not.toHaveBeenCalled();
  });
});
