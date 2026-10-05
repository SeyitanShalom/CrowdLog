import path from "node:path";
import type { NextConfig } from "next";

const apiProxyUrl = process.env.API_PROXY_URL?.replace(/\/$/, "");

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@crowdlog/shared"],
  turbopack: {
    root: path.join(process.cwd(), "../.."),
  },
  async rewrites() {
    if (!apiProxyUrl) {
      return [];
    }

    return [
      {
        source: "/auth/:path*",
        destination: `${apiProxyUrl}/auth/:path*`,
      },
      {
        source: "/events/:path*",
        destination: `${apiProxyUrl}/events/:path*`,
      },
      {
        source: "/documents/:path*",
        destination: `${apiProxyUrl}/documents/:path*`,
      },
      {
        source: "/records/:path*",
        destination: `${apiProxyUrl}/records/:path*`,
      },
      {
        source: "/templates/:path*",
        destination: `${apiProxyUrl}/templates/:path*`,
      },
      {
        source: "/uploads/:path*",
        destination: `${apiProxyUrl}/uploads/:path*`,
      },
      {
        source: "/health/:path*",
        destination: `${apiProxyUrl}/health/:path*`,
      },
    ];
  },
};

export default nextConfig;
