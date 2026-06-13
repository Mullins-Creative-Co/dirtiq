import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "dirtIQ — Dirt Track Underwriting",
  description: "Predict winners, set odds, and manage your dirt track racing book.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
