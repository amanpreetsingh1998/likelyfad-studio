/**
 * The full output is the evidence a suspension actually rests on, so the
 * failures that matter are the ones where it quietly is not kept — and the
 * ones where keeping it costs more than it should.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extensionFor, fetchMedia, MAX_MEDIA_BYTES } from "../media";

function dataUrl(type: string, bytes: number): string {
  return `data:${type};base64,${Buffer.alloc(bytes, 1).toString("base64")}`;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extensionFor", () => {
  it.each([
    ["image/png", "png"],
    ["image/jpeg", "jpg"],
    ["image/webp", "webp"],
    ["image/gif", "gif"],
    ["video/mp4", "mp4"],
    ["video/webm", "webm"],
    ["audio/mpeg", "mp3"],
    ["audio/wav", "wav"],
    ["model/gltf-binary", "glb"],
  ])("maps %s to .%s", (type, ext) => {
    expect(extensionFor(type)).toBe(ext);
  });

  it("ignores parameters on the type", () => {
    expect(extensionFor("image/png; charset=binary")).toBe("png");
    expect(extensionFor("IMAGE/PNG")).toBe("png");
  });

  // Kept rather than refused — an unknown type is still evidence, and
  // media_type tells the viewer what it really is.
  it("falls back to .bin rather than dropping the object", () => {
    expect(extensionFor("application/x-something")).toBe("bin");
  });
});

describe("fetchMedia — inline data URLs", () => {
  it("keeps an image", async () => {
    const media = await fetchMedia(dataUrl("image/png", 64));
    expect(media?.contentType).toBe("image/png");
    expect(media?.extension).toBe("png");
    expect(media?.body.length).toBe(64);
  });

  // The whole point of this feature: video and audio had no visual record.
  it.each(["video/mp4", "audio/mpeg", "model/gltf-binary"])(
    "keeps %s, which the thumbnailer refuses",
    async (type) => {
      const media = await fetchMedia(dataUrl(type, 32));
      expect(media?.contentType).toBe(type);
    }
  );

  it("refuses an object over the ceiling", async () => {
    const media = await fetchMedia(dataUrl("image/png", MAX_MEDIA_BYTES + 1));
    expect(media).toBeNull();
  });

  it("refuses an empty body rather than storing a zero-byte object", async () => {
    expect(await fetchMedia("data:image/png;base64,")).toBeNull();
  });

  it("refuses a malformed data URL", async () => {
    expect(await fetchMedia("data:image/png,notbase64")).toBeNull();
  });
});

describe("fetchMedia — provider URLs", () => {
  function stubFetch(response: Partial<Response> & { headers?: Headers }) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      arrayBuffer: async () => new ArrayBuffer(128),
      ...response,
    } as Response));
  }

  it("downloads and types a remote output", async () => {
    stubFetch({ headers: new Headers({ "content-type": "video/mp4" }) });
    const media = await fetchMedia("https://cdn.test/clip.bin");
    expect(media?.contentType).toBe("video/mp4");
    expect(media?.extension).toBe("mp4");
  });

  // A CDN link often carries no extension, or the wrong one. The stored type
  // is what the viewer uses, so it must come from the response.
  it("types from the response, not the URL", async () => {
    stubFetch({ headers: new Headers({ "content-type": "image/webp" }) });
    const media = await fetchMedia("https://cdn.test/thing.mp4");
    expect(media?.extension).toBe("webp");
  });

  it("refuses before downloading when the provider declares it is too large", async () => {
    const arrayBuffer = vi.fn();
    stubFetch({
      headers: new Headers({ "content-length": String(MAX_MEDIA_BYTES + 1) }),
      arrayBuffer,
    });
    expect(await fetchMedia("https://cdn.test/huge.mp4")).toBeNull();
    // The point of checking the header: the bytes are never pulled.
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("refuses when the body turns out larger than declared", async () => {
    stubFetch({
      headers: new Headers({ "content-type": "video/mp4" }),
      arrayBuffer: async () => new ArrayBuffer(MAX_MEDIA_BYTES + 1),
    });
    expect(await fetchMedia("https://cdn.test/lying.mp4")).toBeNull();
  });

  it("returns null on a link that has already expired", async () => {
    stubFetch({ ok: false, status: 403 });
    expect(await fetchMedia("https://cdn.test/gone.png")).toBeNull();
  });

  // Never throws: the user's generation has already succeeded and their
  // credits are committed by the time this runs.
  it("swallows a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    await expect(fetchMedia("https://cdn.test/x.png")).resolves.toBeNull();
  });

  it("falls back to a declared type when the response gives none", async () => {
    stubFetch({ headers: new Headers() });
    const media = await fetchMedia("https://cdn.test/x", "image/png");
    expect(media?.contentType).toBe("image/png");
  });
});

describe("fetchMedia — nothing to keep", () => {
  it.each([null, undefined, "", "not-a-url", "ftp://host/f.png"])(
    "returns null for %s",
    async (output) => {
      expect(await fetchMedia(output as string | null)).toBeNull();
    }
  );
});
