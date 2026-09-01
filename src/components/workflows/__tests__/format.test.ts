/**
 * One rule runs through all of these: an absent value renders as an em dash,
 * never as a zero. "0 credits" and "0s" are numbers a reader believes.
 */

import { describe, it, expect } from "vitest";
import {
  formatNumber,
  formatRunDuration,
  formatShortDate,
  shortModelName,
} from "../format";

describe("formatRunDuration", () => {
  it("uses seconds below a minute", () => {
    expect(formatRunDuration(9400)).toBe("9s");
    expect(formatRunDuration(59_000)).toBe("59s");
  });

  // The reason this exists rather than reusing the admin formatter, which
  // would render this as "78.0s".
  it("uses minutes and seconds for a typical run", () => {
    expect(formatRunDuration(78_000)).toBe("1m 18s");
    expect(formatRunDuration(122_000)).toBe("2m 2s");
  });

  it("drops a zero seconds component rather than printing '2m 0s'", () => {
    expect(formatRunDuration(120_000)).toBe("2m");
  });

  it("drops seconds past the hour, where they are noise", () => {
    expect(formatRunDuration(5_400_000)).toBe("1h 30m");
    expect(formatRunDuration(3_600_000)).toBe("1h");
  });

  it("renders an absent duration as a dash, never as zero", () => {
    expect(formatRunDuration(null)).toBe("—");
    expect(formatRunDuration(undefined)).toBe("—");
    expect(formatRunDuration(0)).toBe("—");
    expect(formatRunDuration(NaN)).toBe("—");
    expect(formatRunDuration(-5)).toBe("—");
  });
});

describe("formatNumber", () => {
  it("separates thousands", () => {
    expect(formatNumber(1284)).toContain("1,284");
  });

  it("renders a real zero, which is different from an absent one", () => {
    expect(formatNumber(0)).toBe("0");
    expect(formatNumber(null)).toBe("—");
    expect(formatNumber(undefined)).toBe("—");
  });
});

describe("shortModelName", () => {
  it("drops the provider prefix, which is identical on every chip", () => {
    expect(shortModelName("fal-ai/flux-pro")).toBe("flux-pro");
    expect(shortModelName("fal-ai/flux-pro/v1.1-ultra")).toBe("flux-pro/v1.1-ultra");
  });

  it("leaves a bare id alone", () => {
    expect(shortModelName("nano-banana-pro")).toBe("nano-banana-pro");
    expect(shortModelName("gpt-4.1-mini")).toBe("gpt-4.1-mini");
  });

  it("does not strip a trailing slash into an empty label", () => {
    expect(shortModelName("provider/")).toBe("provider/");
  });
});

describe("formatShortDate", () => {
  it("renders a dash for an absent or unparseable date", () => {
    expect(formatShortDate(null)).toBe("—");
    expect(formatShortDate("not a date")).toBe("—");
  });

  it("includes the year only when it is not the current one", () => {
    const thisYear = new Date();
    thisYear.setMonth(0, 15);
    expect(formatShortDate(thisYear.toISOString())).not.toMatch(/\d{4}/);
    expect(formatShortDate("2019-08-24T00:00:00Z")).toMatch(/2019/);
  });
});
