import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Load secrets from the workspace-root .env.local. Walk up looking for it so
// this works inside git worktrees too (where the worktree root has no
// .env.local but the main checkout does).
function findEnvFile(start: string, name: string): string | undefined {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(dir, name);
    if (existsSync(candidate)) return candidate;
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

const envLocal = findEnvFile(__dirname, '.env.local');
if (envLocal) loadEnv({ path: envLocal, override: true });

const repoRoot = resolve(__dirname, '../..');

// Preview iframe rewrites. The portal proxies /preview/* and /api/draft-mode/*
// to site-host so the iframe is same-origin and draft-mode cookies work without
// CORS. SITE_HOST_ORIGIN defaults to local site-host dev server.
const siteHostOrigin = process.env.SITE_HOST_ORIGIN ?? 'http://localhost:3001';

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: repoRoot,
  },
  // Workspace packages are imported as source — Next.js needs to know to transpile them.
  transpilePackages: [
    '@leadlandlord/db',
    '@leadlandlord/integrations',
    '@leadlandlord/sanity-schema',
    '@leadlandlord/shared',
  ],
  serverExternalPackages: ['pino', '@neondatabase/serverless', '@sanity/client'],
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/preview/:path*',
          destination: `${siteHostOrigin}/preview/:path*`,
        },
        {
          source: '/api/draft-mode/:path*',
          destination: `${siteHostOrigin}/api/draft-mode/:path*`,
        },
      ],
    };
  },
};

export default config;
