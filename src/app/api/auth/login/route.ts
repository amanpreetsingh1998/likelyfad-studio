import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE = "auth-token";
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

/** HMAC-SHA256 using Web Crypto API. */
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

async function createToken(password: string): Promise<string> {
  const timestamp = Date.now().toString();
  const signature = await hmacSign(password, timestamp);
  return `${timestamp}.${signature}`;
}

export async function POST(request: NextRequest) {
  const password = process.env.APP_PASSWORD;

  if (!password) {
    return NextResponse.json(
      { error: "APP_PASSWORD not configured on server" },
      { status: 500 }
    );
  }

  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }

  if (body.password !== password) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const token = await createToken(password);
  const response = NextResponse.json({ success: true });

  response.cookies.set(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: TOKEN_MAX_AGE,
    path: "/",
  });

  return response;
}
