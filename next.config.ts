import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Pin the workspace root: a stray package-lock.json in the user's home directory would
  // otherwise make Turbopack guess the root there.
  turbopack: {
    root: fileURLToPath(new URL(".", import.meta.url)),
  },
  // Routes read data/ at runtime, so the build's file tracing would list data/lessons/ (the
  // imported lessons: ~400 MB of pictures) and data/robertie/ (the book's scans), both
  // git-ignored. They are served from disk, never bundled.
  outputFileTracingExcludes: {
    "/*": ["data/lessons/**/*", "data/robertie/**/*"],
  },
};

export default nextConfig;
