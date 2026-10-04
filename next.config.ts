import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so a lockfile in a parent folder isn't picked up.
  turbopack: {
    root: __dirname,
  },
  // The shop became the bar; keep old links and open tabs working. Not
  // permanent, so browsers don't cache it for other apps on this localhost port.
  async redirects() {
    return [{ source: "/shop", destination: "/bar", permanent: false }];
  },
};

export default nextConfig;
