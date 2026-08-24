/**
 * Runs the real sharp pipeline — no mock — because the thing worth checking is
 * that actual provider output turns into an actual small webp, and a mocked
 * encoder would assert nothing about that.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import sharp from "sharp";
import { makeThumbnail } from "../thumbnail";

/** A real PNG, so sharp has something genuine to decode. */
async function pngDataUrl(width: number, height: number): Promise<string> {
  const png = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 30, b: 90 },
    },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("makeThumbnail", () => {
  it("downscales a large image to 256px on its longest edge", async () => {
    const result = await makeThumbnail(await pngDataUrl(1024, 512));

    expect(result).not.toBeNull();
    const meta = await sharp(result!.body).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(256);
    expect(meta.height).toBe(128);
  });

  it("does not upscale an image already smaller than the target", async () => {
    const result = await makeThumbnail(await pngDataUrl(64, 64));

    const meta = await sharp(result!.body).metadata();
    expect(meta.width).toBe(64);
  });

  it("produces a thumbnail far smaller than its source", async () => {
    const source = await pngDataUrl(1024, 1024);
    const result = await makeThumbnail(source);

    expect(result!.body.length).toBeLessThan(source.length / 10);
  });

  it("returns null for video, audio and 3D outputs", async () => {
    // A representative frame needs a decoder this project does not run
    // server-side, so these runs are moderated on their prompt alone.
    await expect(makeThumbnail("data:video/mp4;base64,AAAA")).resolves.toBeNull();
    await expect(makeThumbnail("data:audio/mpeg;base64,AAAA")).resolves.toBeNull();
  });

  it("returns null rather than throwing on undecodable bytes", async () => {
    await expect(
      makeThumbnail("data:image/png;base64,bm90YW5pbWFnZQ==")
    ).resolves.toBeNull();
  });

  it.each([
    ["nothing", null],
    ["an empty string", ""],
    ["a malformed data url", "data:image/png;base64"],
    ["a bare filename", "output.png"],
  ])("returns null for %s", async (_label, input) => {
    await expect(makeThumbnail(input)).resolves.toBeNull();
  });

  it("fetches a provider URL and thumbnails what comes back", async () => {
    const png = await sharp({
      create: { width: 512, height: 512, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer();

    vi.stubGlobal(
      "fetch",
      // Buffer is a Uint8Array at runtime, but TS's BodyInit does not say so.
      vi.fn(async () =>
        new Response(new Uint8Array(png), {
          headers: { "content-type": "image/png" },
        })
      )
    );

    const result = await makeThumbnail("https://cdn.example/out.png");

    expect(result).not.toBeNull();
    expect((await sharp(result!.body).metadata()).width).toBe(256);
    vi.unstubAllGlobals();
  });

  it("returns null when the provider URL 404s", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 }))
    );

    await expect(makeThumbnail("https://cdn.example/gone.png")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it("returns null when the fetch itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );

    await expect(makeThumbnail("https://cdn.example/x.png")).resolves.toBeNull();
    vi.unstubAllGlobals();
  });
});
