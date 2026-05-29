import type { Metadata } from "next";
import { Press_Start_2P, Luckiest_Guy } from "next/font/google";
import "./globals.css";

// HUD / small UI - classic 8-bit arcade font.
const pressStart = Press_Start_2P({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-press",
  display: "swap",
});

// Big titles / overlays - bold, punchy "game logo" display font.
const luckiestGuy = Luckiest_Guy({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Pixel Quest - 16-bit Platformer",
  description:
    "A retro SNES-era side-scrolling platformer built with Next.js, React, TypeScript and HTML5 Canvas.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${pressStart.variable} ${luckiestGuy.variable} h-full`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
