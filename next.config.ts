import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  experimental: {
    // Folder/video uploads can be much larger than Next.js' default 10 MB
    // middleware request-body buffer. Keep this aligned with the 1 GB video limit.
    middlewareClientMaxBodySize: "1gb",
  },
};

export default nextConfig;
