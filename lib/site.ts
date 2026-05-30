// Canonical site URL used for metadata, Open Graph, robots and sitemap.
// Prefers an explicit override, then Vercel's stable production domain at build
// time, falling back to localhost for local dev.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const SITE_NAME = "Pixel Quest";
export const SITE_TAGLINE = "Retro 16-bit 3D Platformer";
export const SITE_DESCRIPTION =
  "Play Pixel Quest, a free retro 16-bit SNES-style side-scrolling platformer rendered in real 3D. Run, jump, stomp snails, grab coins and gems, dodge pits and reach the flag before time runs out. Built with Next.js, React and Three.js.";
export const REPO_URL = "https://github.com/StarKnightt/Pixel-Quest";
export const AUTHOR = "StarKnightt";
