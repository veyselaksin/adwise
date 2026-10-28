import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Reads its font metrics from its own folder at runtime, so it can't be bundled.
  serverExternalPackages: ["pdfkit"],
  images: {
    // Sign-in page photos.
    remotePatterns: [new URL("https://images.unsplash.com/photo-*")],
    qualities: [75, 90],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
