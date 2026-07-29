import type { NextConfig } from "next";

const BACKEND = process.env.BACKEND_URL || "http://backend:8000";

const nextConfig: NextConfig = {
  // Next's dev server blocks cross-origin requests by default. We reach it
  // by LAN IP, so those origins must be allowed or client JS never loads.
  allowedDevOrigins: ["192.168.253.10", "localhost", "127.0.0.1"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND}/api/:path*` }];
  },
};

export default nextConfig;
