import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@crowdlog/shared"],
  turbopack: {
    root: path.join(process.cwd(), "../.."),
  },
};

export default nextConfig;
