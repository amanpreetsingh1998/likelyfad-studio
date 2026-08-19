import type { Metadata } from "next";
import "./globals.css";
import { Toast } from "@/components/Toast";
import { AuthProvider } from "@/components/auth/AuthProvider";

export const metadata: Metadata = {
  title: "Likelyfad Studio - AI Image Workflow",
  description: "Node-based image annotation and generation workflow using Nano Banana Pro",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {/* Wraps every route, not just the studio: /signin needs the same
            session to know when to send the visitor back. */}
        <AuthProvider>{children}</AuthProvider>
        <Toast />
      </body>
    </html>
  );
}
