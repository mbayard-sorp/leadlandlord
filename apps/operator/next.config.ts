import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages are imported as source — Next.js needs to know to transpile them.
  transpilePackages: [
    '@leadlandlord/agents',
    '@leadlandlord/db',
    '@leadlandlord/integrations',
    '@leadlandlord/shared',
  ],
  serverExternalPackages: ['pino', '@neondatabase/serverless'],
};

export default config;
