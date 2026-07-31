import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: [
      "127.0.0.1",
      '*.dev.coze.site'
  ],
    images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
