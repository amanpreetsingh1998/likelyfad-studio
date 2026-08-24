/**
 * Colour has to follow the entity, not its position on screen.
 *
 * This is the check that would have caught the bug these functions exist to
 * fix: series colours were taken from an index into whatever kinds happened to
 * be present, so a window with no video runs shifted every later kind down a
 * slot and repainted them. A reader who learned "audio is aqua" watched it
 * turn orange for changing the date range.
 */

import { describe, it, expect } from "vitest";
import { KIND_ORDER, SERIES, SERIES_VAR, kindColor, kindLabel, sortKinds } from "../theme";

describe("kindColor", () => {
  it("gives each kind a fixed slot regardless of what else is on screen", () => {
    const everything = KIND_ORDER.map(kindColor);
    const someMissing = ["audio", "llm"].map(kindColor);

    expect(someMissing[0]).toBe(everything[KIND_ORDER.indexOf("audio")]);
    expect(someMissing[1]).toBe(everything[KIND_ORDER.indexOf("llm")]);
  });

  it("gives every kind a distinct slot", () => {
    const colors = KIND_ORDER.map(kindColor);
    expect(new Set(colors).size).toBe(KIND_ORDER.length);
  });

  it("never lets an unknown kind impersonate the first slot", () => {
    // A new RunKind added without updating KIND_ORDER lands last, not on
    // image's blue.
    expect(kindColor("hologram")).not.toBe(SERIES_VAR[0]);
    expect(kindColor("hologram")).toBe(SERIES_VAR[SERIES_VAR.length - 1]);
  });
});

describe("sortKinds", () => {
  it("puts kinds in canonical order, not the order they arrived", () => {
    expect(sortKinds(["llm", "image", "video"])).toEqual([
      "image",
      "video",
      "llm",
    ]);
  });

  it("keeps the surviving order stable when a kind drops out", () => {
    const full = sortKinds([...KIND_ORDER]);
    const partial = sortKinds(["image", "audio", "llm"]);

    // Relative order preserved — the legend does not reshuffle between windows.
    expect(partial).toEqual(full.filter((k) => partial.includes(k)));
  });

  it("sorts unknown kinds last, deterministically", () => {
    expect(sortKinds(["zeta", "image", "alpha"])).toEqual([
      "image",
      "alpha",
      "zeta",
    ]);
  });

  it("does not mutate its input", () => {
    const input = ["llm", "image"];
    sortKinds(input);
    expect(input).toEqual(["llm", "image"]);
  });
});

describe("palette", () => {
  it("exposes exactly as many custom-property refs as hexes", () => {
    expect(SERIES_VAR).toHaveLength(SERIES.length);
  });

  it("covers every kind without cycling a hue", () => {
    // A 7th kind would reuse a slot, which is indistinguishable under CVD.
    // If KIND_ORDER grows past the palette, fold the tail into "Other".
    expect(KIND_ORDER.length).toBeLessThanOrEqual(SERIES.length);
  });
});

describe("kindLabel", () => {
  it("never shows a raw enum", () => {
    expect(kindLabel("3d")).toBe("3D");
    expect(kindLabel("llm")).toBe("LLM");
  });

  it("falls back to the key for an unmapped kind", () => {
    expect(kindLabel("hologram")).toBe("hologram");
  });
});
