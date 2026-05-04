import { cp, mkdir, writeFile } from 'node:fs/promises';
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
 */
export async function materializeSite(args: MaterializeArgs): Promise<void> {
  const templateDir = findSiteTemplate();

  await mkdir(args.buildDir, { recursive: true });

  // Copy template, excluding node_modules, .next, .turbo.
  await cp(templateDir, args.buildDir, {
    recursive: true,
    filter: (src) => {
      return !src.includes('/node_modules') && !src.includes('/.next') && !src.includes('/.turbo');
    },
  });

  // Write content.json — the template reads this at build time to render pages.
  const contentJsonPath = resolve(args.buildDir, 'content.json');
  await writeFile(contentJsonPath, JSON.stringify(args.bundle, null, 2));

  // Write each page as MDX so Next.js can statically import + render.
  const contentDir = resolve(args.buildDir, 'content');
  await mkdir(contentDir, { recursive: true });
  await Promise.all([
    writePage(contentDir, args.bundle.home, 'home'),
    writePage(contentDir, args.bundle.about, 'about'),
    writePage(contentDir, args.bundle.contact, 'contact'),
    ...args.bundle.services.map((p, i) => writePage(contentDir, p, `service-${i}`)),
    ...args.bundle.service_areas.map((p, i) => writePage(contentDir, p, `service-area-${i}`)),
    ...args.bundle.blog_posts.map((p, i) => writePage(contentDir, p, `blog-${i}`)),
    ...args.bundle.info_pages.map((p, i) => writePage(contentDir, p, `info-page-${i}`)),
  ]);

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
