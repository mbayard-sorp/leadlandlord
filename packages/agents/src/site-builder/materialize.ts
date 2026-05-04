import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ContentBundle, Page } from '@leadlandlord/shared/types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * The site-template lives at `apps/site-template`. From this file
 * (`packages/agents/src/site-builder/materialize.ts`), it's `../../../../apps/site-template`.
 */
function findSiteTemplate(): string {
  // Walk up looking for a directory containing `apps/site-template`.
  let cur = __dirname;
  for (let i = 0; i < 8; i++) {
    const candidate = resolve(cur, 'apps/site-template');
    if (existsSync(candidate)) return candidate;
    const parent = resolve(cur, '..');
    if (parent === cur) break;
    cur = parent;
  }
  throw new Error('Could not locate apps/site-template/ relative to materialize.ts');
}

export interface MaterializeArgs {
  buildDir: string;
  bundle: ContentBundle;
  trackingNumber: string;
  vercelProjectName: string;
}

/**
 * Copy the site-template into `buildDir` and inject the generated content +
 * tracking number + project metadata. Returns nothing — caller deploys from buildDir.
 *
 * Always cleans `buildDir` first so re-runs don't pick up stale files from a
 * previous materialization (e.g. routes that have since been deleted from the
 * template).
 */
export async function materializeSite(args: MaterializeArgs): Promise<void> {
  const templateDir = findSiteTemplate();

  // Clean — Node fs.rm with force ignores ENOENT.
  await rm(args.buildDir, { recursive: true, force: true });
  await mkdir(args.buildDir, { recursive: true });

  // Copy template, excluding node_modules, .next, .turbo, out.
  await cp(templateDir, args.buildDir, {
    recursive: true,
    filter: (src) => {
      return (
        !src.includes('/node_modules') &&
        !src.includes('/.next') &&
        !src.includes('/.turbo') &&
        !src.includes('/out')
      );
    },
  });

  await writeContentBundle(args.buildDir, args.bundle);

  // Write env file the build will pick up.
  const envContent = [
    `NEXT_PUBLIC_SITE_NAME="${escapeEnv(args.bundle.business_name)}"`,
    `NEXT_PUBLIC_NICHE="${escapeEnv(args.bundle.niche)}"`,
    `NEXT_PUBLIC_CITY="${escapeEnv(args.bundle.city)}"`,
    `NEXT_PUBLIC_STATE="${args.bundle.state}"`,
    `NEXT_PUBLIC_TRACKING_NUMBER="${escapeEnv(args.trackingNumber)}"`,
    `VERCEL_PROJECT_NAME="${args.vercelProjectName}"`,
    '',
  ].join('\n');
  await writeFile(resolve(args.buildDir, '.env.production'), envContent);
  await writeFile(resolve(args.buildDir, '.env.local'), envContent);
}

/**
 * Re-write only the content bundle (content.json + per-page MDX) into an
 * already-materialized buildDir. Used after async steps (hero image gen) that
 * mutate the bundle — avoids re-copying the whole template (and would
 * otherwise wipe the freshly-generated public/hero.jpg).
 */
export async function writeContentBundle(buildDir: string, bundle: ContentBundle): Promise<void> {
  // Write content.json — the template reads this at build time to render pages.
  const contentJsonPath = resolve(buildDir, 'content.json');
  await writeFile(contentJsonPath, JSON.stringify(bundle, null, 2));

  // Write each page as MDX so Next.js can statically import + render.
  const contentDir = resolve(buildDir, 'content');
  await mkdir(contentDir, { recursive: true });
  await Promise.all([
    writePage(contentDir, bundle.home, 'home'),
    writePage(contentDir, bundle.about, 'about'),
    writePage(contentDir, bundle.contact, 'contact'),
    ...bundle.services.map((p, i) => writePage(contentDir, p, `service-${i}`)),
    ...bundle.service_areas.map((p, i) => writePage(contentDir, p, `service-area-${i}`)),
    ...bundle.blog_posts.map((p, i) => writePage(contentDir, p, `blog-${i}`)),
    ...bundle.info_pages.map((p, i) => writePage(contentDir, p, `info-page-${i}`)),
  ]);
}

async function writePage(dir: string, page: Page, fallback: string) {
  const filename = `${page.slug.replace(/^\//, '').replace(/\//g, '_') || fallback}.mdx`;
  const frontmatter = [
    '---',
    `kind: ${page.kind}`,
    `slug: ${JSON.stringify(page.slug)}`,
    `title: ${JSON.stringify(page.title)}`,
    `meta_description: ${JSON.stringify(page.meta_description)}`,
    page.schema_org_jsonld
      ? `schema_org_jsonld: ${JSON.stringify(page.schema_org_jsonld)}`
      : '',
    '---',
    '',
  ]
    .filter(Boolean)
    .join('\n');
  await writeFile(resolve(dir, filename), frontmatter + page.mdx);
}

function escapeEnv(v: string): string {
  return v.replace(/"/g, '\\"').replace(/\n/g, ' ');
}
