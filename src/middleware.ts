import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const AUTH_COOKIE = "auth-token";
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function getSecret(): string {
  return process.env.APP_PASSWORD || "";
}

/**
 * Verify the auth token cookie.
 * Token format: `timestamp.signature` where signature = HMAC(password, timestamp).
 */
function isValidToken(token: string): boolean {
  const secret = getSecret();
  if (!secret) return true; // No password set — allow all traffic

  const [timestamp, signature] = token.split(".");
  if (!timestamp || !signature) return false;

  // Check expiry
  const issued = parseInt(timestamp, 10);
  if (isNaN(issued)) return false;
  if (Date.now() - issued > TOKEN_MAX_AGE * 1000) return false;

  // Verify signature
  const expected = createHmac("sha256", secret).update(timestamp).digest("hex");
  return signature === expected;
}

export function middleware(request: NextRequest) {
  const password = getSecret();

  // If no APP_PASSWORD is set, skip protection entirely (local dev convenience)
  if (!password) {
    return NextResponse.next();
  }

  const token = request.cookies.get(AUTH_COOKIE)?.value;

  if (token && isValidToken(token)) {
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
