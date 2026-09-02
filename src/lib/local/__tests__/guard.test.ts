/**
 * The gate on the local-filesystem routes.
 *
 * Worth its own suite because the routes' own tests opt in (src/test/setup.ts
 * sets the flag), so nothing else here exercises the refusal path — which is
 * the half that matters.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { NextRequest } from "next/server";
import { requireLocal } from "../guard";

function request(headers: Record<string, string> = {}): NextRequest {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { headers: { get: (k: string) => map.get(k.toLowerCase()) ?? null } } as NextRequest;
}

const ORIGINAL = process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES;

beforeEach(() => {
  delete process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES;
  else process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES = ORIGINAL;
});

/**
 * The flag is the whole boundary — arbitrary path access is the feature these
 * routes exist for — so the case that matters is somebody copying a working
 * .env onto a deployment. Production refuses regardless of the flag.
 */
describe("requireLocal — production", () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (ORIGINAL_ENV === undefined) delete process.env.NODE_ENV;
    else vi.stubEnv("NODE_ENV", ORIGINAL_ENV);
  });

  it("ignores the flag entirely in a production build", () => {
    process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES = "1";
    vi.stubEnv("NODE_ENV", "production");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const gate = requireLocal(request({ host: "localhost:3000" }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(404);

    error.mockRestore();
  });

  it("still honours the flag outside production, or the desktop case breaks", () => {
    process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES = "1";
    vi.stubEnv("NODE_ENV", "development");
    expect(requireLocal(request({ host: "localhost:3000" })).ok).toBe(true);
  });
});

describe("requireLocal", () => {
  it("refuses when the flag is unset — deploying without setting anything is safe", async () => {
    const gate = requireLocal(request({ host: "localhost:3000" }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(404);
  });

  it("refuses any value other than 1, so a stray 'false' or '0' cannot enable it", () => {
    for (const value of ["0", "false", "true", "yes", ""]) {
      process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES = value;
      expect(requireLocal(request({ host: "localhost" })).ok).toBe(false);
    }
  });

  it("admits a loopback caller once opted in", () => {
    process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES = "1";
    expect(requireLocal(request({ host: "localhost:3000" })).ok).toBe(true);
    expect(requireLocal(request({ host: "127.0.0.1:3000" })).ok).toBe(true);
  });

  it("refuses a remote host header even when opted in", () => {
    process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES = "1";
    const gate = requireLocal(request({ host: "studio.example.com" }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.response.status).toBe(404);
  });

  it("refuses a forwarded remote address even when the host header says localhost", () => {
    process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES = "1";
    const gate = requireLocal(
      request({ host: "localhost:3000", "x-forwarded-for": "203.0.113.7, 127.0.0.1" })
    );
    expect(gate.ok).toBe(false);
  });

  it("answers 404, never 403 — a refusal should not confirm the surface exists", async () => {
    const gate = requireLocal(request({ host: "studio.example.com" }));
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.response.status).toBe(404);
      await expect(gate.response.json()).resolves.toEqual({ error: "Not found" });
    }
  });

  it("does not throw on a request without headers", () => {
    process.env.ENABLE_LOCAL_FILESYSTEM_ROUTES = "1";
    expect(() => requireLocal({} as NextRequest)).not.toThrow();
  });
});
