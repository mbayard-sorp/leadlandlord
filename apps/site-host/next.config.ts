import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Walk up looking for .env.local. Works inside git worktrees where the
// worktree root has no .env.local but the LeadLandlord parent checkout does.
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
const repoRoot = resolve(__dirname, '../..');
const envLocal = findEnvFile(__dirname, '.env.local');
if (envLocal) loadEnv({ path: envLocal, override: true });

const config: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    // Sprint 1: R&R service URLs moved from /services/<slug> to /<slug>
    // (flat). 301 = permanent; old URLs remain crawlable during transition.
    //
    // Config redirects run BEFORE proxy.ts, so without a guard they also fire
    // on Custom Sites hosts whose public URL vocabulary legitimately uses
    // /services (alignedadvisors.com — lib/customsites-registry.ts). The
    // `missing` conditions are ANDed: the redirect applies only when the
    // request is NOT identifiable as that custom site by host (prod), sticky
    // cookie, or ?cs= query (dev preview).
    const notAlignedAdvisors = [
      { type: 'host' as const, value: '(www\\.)?alignedadvisors\\.com' },
      { type: 'cookie' as const, key: 'll_cs', value: 'alignedadvisors' },
      { type: 'query' as const, key: 'cs', value: 'alignedadvisors' },
    ];
    return [
      {
        source: '/services/:slug',
        destination: '/:slug',
        permanent: true,
        missing: notAlignedAdvisors,
      },
      {
        source: '/services',
        destination: '/',
        permanent: true,
        missing: notAlignedAdvisors,
      },
    ];
  },
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
  // Hero images come from controlled sources (Vercel Blob, Sanity CDN, Imagen).
  // Allow them through next/image so we get auto width/srcset/lazy loading.
  // URLs are operator-supplied via Sanity, never end-user input.
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      { protocol: 'https', hostname: '**.public.blob.vercel-storage.com' },
      { protocol: 'https', hostname: 'cdn.sanity.io' },
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
    ],
  },
  // Cache Components stays OFF for site-host: every page is per-host and
  // depends on `headers()` at the top of the layout, which Cache Components
  // requires to be inside <Suspense>. The architecture pivot for Cache
  // Components belongs in Track C (Phase 7 hardening), not Phase B scaffold.
  // Until then we use unstable_cacheTag/unstable_cacheLife in lib/sanity.ts +
  // lib/tracking.ts which work without the `cacheComponents` flag.
};

export default config;
