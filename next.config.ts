import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  experimental: {
    // Allow uploads up to the application video ceiling.
    // Next.js 16 uses proxyClientMaxBodySize; the old middlewareClientMaxBodySize
    // option is deprecated and must not be used for the upload proxy.
    proxyClientMaxBodySize: "800mb",
  },
};

export default nextConfig;
