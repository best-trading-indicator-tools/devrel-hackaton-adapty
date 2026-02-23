import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@lancedb/lancedb", "canvas"],
};

export default nextConfig;
