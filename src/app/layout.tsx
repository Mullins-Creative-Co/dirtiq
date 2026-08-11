import type { Metadata, Viewport } from "next";
import { Archivo, Inter } from "next/font/google";
import "./globals.css";

const archivo = Archivo({
  subsets: ["latin"],
  weight: ["600", "700", "800", "900"],
  variable: "--font-archivo",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "dirtIQ | Dirt Late Model Sportsbook",
  description: "Live model-priced dirt late model markets. Build your slip, track your wallet, and beat the board.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#06080b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`h-full bg-background ${archivo.variable} ${inter.variable}`}>
      <body className="min-h-full bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
