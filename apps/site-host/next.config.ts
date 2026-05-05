import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Load secrets from the workspace-root .env.local — Next.js only auto-loads
// from the app dir, but in this monorepo secrets live at the repo root.
const repoRoot = resolve(__dirname, '../..');
loadEnv({ path: resolve(repoRoot, '.env.local'), override: true });
loadEnv({ path: resolve(repoRoot, '.env'), override: true });

const config: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: repoRoot,
  },
  // Workspace packages are imported as source — Next.js needs to know to transpile them.
  transpilePackages: [
    '@leadlandlord/db',
    '@leadlandlord/sanity-schema',
    '@leadlandlord/shared',
  ],
  serverExternalPackages: ['pino', '@neondatabase/serverless', '@sanity/client'],
  // Cache Components stays OFF for site-host: every page is per-host and
  // depends on `headers()` at the top of the layout, which Cache Components
  // requires to be inside <Suspense>. The architecture pivot for Cache
  // Components belongs in Track C (Phase 7 hardening), not Phase B scaffold.
  // Until then we use unstable_cacheTag/unstable_cacheLife in lib/sanity.ts +
  // lib/tracking.ts which work without the `cacheComponents` flag.
};

export default config;
