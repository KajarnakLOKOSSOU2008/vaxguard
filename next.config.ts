import type { NextConfig } from "next";

const isStatic = process.env.NEXT_PUBLIC_STATIC_DEMO === "true";

const nextConfig: NextConfig = {
  // Default: standalone (for full-stack runtime with FastAPI AI service)
  // When NEXT_PUBLIC_STATIC_DEMO=true: export (for GitHub Pages demo)
  output: isStatic ? "export" : "standalone",
  // basePath is set by the GitHub Action at build time via env override
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  images: { unoptimized: true },
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
