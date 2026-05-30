import type { MetadataRoute } from "next";
import { SITE_NAME, SITE_TAGLINE, SITE_DESCRIPTION } from "@/lib/site";

// Web App Manifest. With this (plus the service worker) browsers offer to
// "install" Pixel Quest as an app - it launches fullscreen/standalone but is
// still the live web build, no download required.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} - ${SITE_TAGLINE}`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "landscape",
    background_color: "#0b0820",
    theme_color: "#120c24",
    categories: ["games", "entertainment"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
