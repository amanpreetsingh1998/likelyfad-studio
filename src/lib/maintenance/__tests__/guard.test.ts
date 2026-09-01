/**
 * The maintenance gate.
 *
 * This endpoint settles money and deletes the moderation record with no user
 * behind it, so the cases that matter are the refusals — and specifically the
 * ones that would fail *open* if the code were written slightly wrong.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import { hasCronSecret, requireCron } from "../guard";

function request(authorization?: string): NextRequest {
  return {
    headers: new Headers(authorization ? { authorization } : {}),
  } as unknown as NextRequest;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("hasCronSecret", () => {
  it("accepts the configured secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(hasCronSecret(request("Bearer s3cret"))).toBe(true);
  });

  it("rejects a wrong secret", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(hasCronSecret(request("Bearer nope"))).toBe(false);
  });

  /**
   * A wrong secret of a different length must be a plain refusal. Comparing
   * raw buffers with timingSafeEqual throws on a length mismatch, which would
   * turn the guard into a 500 — and a crash is not the same as a closed door.
   */
  it("rejects a wrong secret of a different length without throwing", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(() => hasCronSecret(request("Bearer x"))).not.toThrow();
    expect(hasCronSecret(request("Bearer x"))).toBe(false);
    expect(hasCronSecret(request("Bearer " + "x".repeat(500)))).toBe(false);
  });

  /**
   * Fail closed. An unconfigured secret means nobody can run maintenance, not
   * that anybody can — including a caller who sends no header at all, or an
   * empty one that might look like a match for an empty variable.
   */
  it("refuses everything when CRON_SECRET is unset", () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(hasCronSecret(request("Bearer anything"))).toBe(false);
    expect(hasCronSecret(request("Bearer "))).toBe(false);
    expect(hasCronSecret(request())).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(hasCronSecret(request())).toBe(false);
    expect(hasCronSecret(request("s3cret"))).toBe(false);
    expect(hasCronSecret(request("Basic s3cret"))).toBe(false);
    expect(hasCronSecret(request("Bearer"))).toBe(false);
  });

  it("does not accept the empty string as a token", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(hasCronSecret(request("Bearer    "))).toBe(false);
  });
});

describe("requireCron", () => {
  it("passes an authorised caller through", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect(requireCron(request("Bearer s3cret"))).toEqual({ ok: true });
  });

  /**
   * 404 rather than 401: there is no benefit in confirming this surface exists
   * to whoever just probed for it. Same reasoning as requireAdmin().
   */
  it("answers 404, not 401, for an unauthorised caller", () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const gate = requireCron(request("Bearer wrong"));

    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(404);
  });
});
