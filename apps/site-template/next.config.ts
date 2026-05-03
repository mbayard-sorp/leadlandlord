import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Static export so each tenant site can be uploaded as a flat HTML bundle.
  // Switch to 'standalone' if a tenant site needs server-side features.
  output: 'export',
  images: {
    unoptimized: true,
  },
  trailingSlash: true,
};

export default config;
