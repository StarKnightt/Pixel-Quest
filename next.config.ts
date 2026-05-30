import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Turbopack's persistent dev cache is enabled by default in Next 16.1+.
    // A cache write interrupted by a hard crash can leave it in a broken state
    // that makes `next dev` loop on "Compiling…" and leak memory until the
    // machine locks up. Disable it so every dev start is clean and bounded.
    turbopackFileSystemCacheForDev: false,
  },
};

export default nextConfig;
