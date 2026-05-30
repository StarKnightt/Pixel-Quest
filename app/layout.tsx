import type { Metadata, Viewport } from "next";
import { Press_Start_2P, Luckiest_Guy } from "next/font/google";
import "./globals.css";
import {
  SITE_URL,
  SITE_NAME,
  SITE_TAGLINE,
  SITE_DESCRIPTION,
  REPO_URL,
  AUTHOR,
} from "@/lib/site";

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

const TITLE = `${SITE_NAME} - ${SITE_TAGLINE}`;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "pixel quest",
    "platformer game",
    "retro game",
    "16-bit game",
    "SNES style game",
    "browser game",
    "html5 game",
    "free online game",
    "side-scroller",
    "pixel art game",
    "three.js game",
    "next.js game",
    "play in browser",
  ],
  authors: [{ name: AUTHOR, url: REPO_URL }],
  creator: AUTHOR,
  publisher: AUTHOR,
  category: "games",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#120c24",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "VideoGame",
  name: SITE_NAME,
  description: SITE_DESCRIPTION,
  url: SITE_URL,
  image: `${SITE_URL}/opengraph-image.png`,
  applicationCategory: "Game",
  genre: ["Platformer", "Retro", "Arcade"],
  gamePlatform: ["Web Browser", "PC", "Mobile"],
  operatingSystem: "Any (web browser)",
  author: { "@type": "Person", name: AUTHOR, url: REPO_URL },
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
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
      <body className="min-h-full">
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </body>
    </html>
  );
}
