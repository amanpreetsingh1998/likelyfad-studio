/**
 * The viewer is where a suspension decision gets made, so the two failures
 * that matter are rendering the wrong element for the media, and showing an
 * empty box when the honest answer is "the evidence is gone, and here is why".
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ModerationRow } from "@/lib/admin/moderation";
import { MediaViewer } from "../MediaViewer";

function row(overrides: Partial<ModerationRow> = {}): ModerationRow {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    user_id: "11111111-1111-1111-1111-111111111111",
    email: "them@example.com",
    kind: "image",
    provider: "fal",
    model_id: "fal-ai/flux-pro",
    prompt: "a red chair",
    output_kind: "image",
    output_text: null,
    status: "succeeded",
    credits_charged: 4,
    duration_ms: 5000,
    created_at: "2026-08-28T10:00:00Z",
    moderation_state: "unreviewed",
    moderated_at: null,
    moderation_reason: null,
    content_removed_at: null,
    user_flags: 0,
    total_count: 1,
    thumb_url: "https://signed.test/thumb.webp",
    media_url: "https://signed.test/full.png",
    media_type: "image/png",
    media_bytes: 4 * 1024 * 1024,
    ...overrides,
  } as ModerationRow;
}

function open(overrides: Partial<ModerationRow> = {}) {
  return render(<MediaViewer row={row(overrides)} onClose={vi.fn()} />);
}

describe("rendering by stored MIME type", () => {
  it("shows an image in an img", () => {
    const { container } = open({ media_type: "image/png" });
    const img = container.querySelector("img[src='https://signed.test/full.png']");
    expect(img).toBeTruthy();
  });

  // The runs that previously had no visual record at all.
  it("shows a video in a player with controls", () => {
    const { container } = open({ media_type: "video/mp4", kind: "video" });
    const video = container.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.hasAttribute("controls")).toBe(true);
  });

  it("shows audio in a player", () => {
    const { container } = open({ media_type: "audio/mpeg", kind: "audio" });
    expect(container.querySelector("audio")).toBeTruthy();
  });

  /**
   * From the stored type, never the key's extension. A provider CDN link often
   * carries no extension or the wrong one, which is how an audio track ends up
   * in an image tag showing a broken icon.
   */
  it("trusts the type over the URL's extension", () => {
    const { container } = open({
      media_url: "https://signed.test/output.png",
      media_type: "video/mp4",
    });
    expect(container.querySelector("video")).toBeTruthy();
    expect(container.querySelector("img[src*='output.png']")).toBeNull();
  });

  it("offers a download for a type it cannot render", () => {
    open({ media_type: "model/gltf-binary", kind: "3d" });
    expect(screen.getByText(/download output/i)).toBeTruthy();
  });

  it("says how large the output is before it is opened", () => {
    open({ media_bytes: 4 * 1024 * 1024 });
    expect(screen.getByText(/4\.0 MB/)).toBeTruthy();
  });
});

/**
 * Four different facts that all render as an empty box if you let them, and
 * only one is a fault worth chasing. A moderator has to know whether the
 * evidence is missing because it was taken down, because it was never kept,
 * or because the run never produced anything.
 */
describe("when there is nothing to show, it says which nothing", () => {
  it("explains a removal", () => {
    open({ media_url: null, thumb_url: null, content_removed_at: "2026-08-29T00:00:00Z" });
    expect(screen.getByText(/removed by an admin/i)).toBeTruthy();
  });

  it("explains a run that never came back", () => {
    open({ media_url: null, thumb_url: null, status: "pending" });
    expect(screen.getByText(/has not come back/i)).toBeTruthy();
  });

  it("explains a failed run", () => {
    open({ media_url: null, thumb_url: null, status: "failed" });
    expect(screen.getByText(/run failed/i)).toBeTruthy();
  });

  // Over the ceiling, or the provider link expired before we fetched it.
  it("explains a thumbnail with no full copy, and still shows the thumbnail", () => {
    const { container } = open({ media_url: null });
    expect(screen.getByText(/only a thumbnail was kept/i)).toBeTruthy();
    expect(container.querySelector("img[src='https://signed.test/thumb.webp']")).toBeTruthy();
  });

  it("says plainly when nothing at all was stored", () => {
    open({ media_url: null, thumb_url: null });
    expect(screen.getByText(/no output was stored/i)).toBeTruthy();
  });
});

describe("the dialog", () => {
  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<MediaViewer row={row()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("names whose output it is and when", () => {
    open();
    expect(screen.getByText(/them@example.com/)).toBeTruthy();
    expect(screen.getByText("fal-ai/flux-pro")).toBeTruthy();
  });

  it("keeps the prompt beside the picture, which is half the judgement", () => {
    open({ prompt: "a red chair" });
    expect(screen.getByText("a red chair")).toBeTruthy();
  });
});
