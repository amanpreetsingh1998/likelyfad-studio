import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const AUTH_COOKIE = "auth-token";
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

function createToken(password: string): string {
  const timestamp = Date.now().toString();
  const signature = createHmac("sha256", password)
    .update(timestamp)
    .digest("hex");
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

  const token = createToken(password);
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
