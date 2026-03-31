import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "auth-token";
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function getSecret(): string {
  return process.env.APP_PASSWORD || "";
}

/** Convert a hex string to a Uint8Array. */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/** HMAC-SHA256 using Web Crypto API (Edge Runtime compatible). */
async function hmacSign(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = hexToBytes(a);
  const bBuf = hexToBytes(b);
  let result = 0;
  for (let i = 0; i < aBuf.length; i++) {
    result |= aBuf[i] ^ bBuf[i];
  }
  return result === 0;
}

/**
 * Verify the auth token cookie.
 * Token format: `timestamp.signature` where signature = HMAC(password, timestamp).
 */
async function isValidToken(token: string): Promise<boolean> {
  const secret = getSecret();
  if (!secret) return true; // No password set — allow all traffic

  const [timestamp, signature] = token.split(".");
  if (!timestamp || !signature) return false;

  // Check expiry
  const issued = parseInt(timestamp, 10);
  if (isNaN(issued)) return false;
  if (Date.now() - issued > TOKEN_MAX_AGE * 1000) return false;

  // Verify signature
  const expected = await hmacSign(secret, timestamp);
  return timingSafeEqual(signature, expected);
}

export async function middleware(request: NextRequest) {
  const password = getSecret();

  // If no APP_PASSWORD is set, skip protection entirely (local dev convenience)
  if (!password) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;

  if (token && (await isValidToken(token))) {
    return NextResponse.next();
  }

  // Not authenticated — redirect to login
  const loginUrl = new URL("/login", request.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    /*
     * Protect all routes EXCEPT:
     * - /login (the login page itself)
     * - /api/auth/login (the login API endpoint)
     * - /_next (Next.js internals — static assets, HMR, etc.)
     * - /favicon.ico, /banana_icon.png, /node-banana.png (static files)
     */
    "/((?!login|api/auth/login|_next|favicon\\.ico|banana_icon\\.png|node-banana\\.png).*)",
  ],
};
