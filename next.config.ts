import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  // linkedom has optional native deps (canvas) that bundlers choke on.
  serverExternalPackages: ["linkedom", "@mozilla/readability", "turndown"],
};

export default nextConfig;
