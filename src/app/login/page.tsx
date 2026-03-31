"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        router.push("/");
        router.refresh();
      } else {
        const data = await res.json();
        setError(data.error || "Wrong password");
      }
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0a0a",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          width: "100%",
          maxWidth: "360px",
          padding: "40px 32px",
          background: "#171717",
          borderRadius: "12px",
          border: "1px solid #262626",
        }}
      >
        <h1
          style={{
            margin: "0 0 8px 0",
            fontSize: "20px",
            fontWeight: 600,
            color: "#fafafa",
            textAlign: "center",
          }}
        >
          Node Banana
        </h1>
        <p
          style={{
            margin: "0 0 28px 0",
            fontSize: "14px",
            color: "#737373",
            textAlign: "center",
          }}
        >
          Enter the password to continue
        </p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          required
          style={{
            width: "100%",
            padding: "10px 14px",
            fontSize: "14px",
            background: "#0a0a0a",
            border: "1px solid #404040",
            borderRadius: "8px",
            color: "#fafafa",
            outline: "none",
            boxSizing: "border-box",
          }}
        />

        {error && (
          <p
            style={{
              margin: "12px 0 0 0",
              fontSize: "13px",
              color: "#ef4444",
              textAlign: "center",
            }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%",
            marginTop: "16px",
            padding: "10px",
            fontSize: "14px",
            fontWeight: 500,
            background: loading ? "#404040" : "#fafafa",
            color: "#0a0a0a",
            border: "none",
            borderRadius: "8px",
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          {loading ? "Checking..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
