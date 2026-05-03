import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const PageSchema = z.object({
  kind: z.string(),
  slug: z.string(),
  title: z.string(),
  meta_description: z.string(),
  mdx: z.string(),
  schema_org_jsonld: z.unknown().optional(),
});

const BundleSchema = z.object({
  niche: z.string(),
  city: z.string(),
  state: z.string(),
  business_name: z.string(),
  home: PageSchema,
  services: z.array(PageSchema),
  service_areas: z.array(PageSchema),
  about: PageSchema,
  contact: PageSchema,
  blog_posts: z.array(PageSchema),
  generated_at: z.string(),
});

export type Bundle = z.infer<typeof BundleSchema>;

let cached: Bundle | null = null;

export function loadBundle(): Bundle {
  if (cached) return cached;
  const path = resolve(process.cwd(), 'content.json');
  if (!existsSync(path)) {
    // Render a placeholder when running the template in isolation.
    cached = placeholder();
    return cached;
  }
  const raw = readFileSync(path, 'utf-8');
  cached = BundleSchema.parse(JSON.parse(raw));
  return cached;
}

function placeholder(): Bundle {
  return {
    niche: process.env.NEXT_PUBLIC_NICHE ?? 'home services',
    city: process.env.NEXT_PUBLIC_CITY ?? 'Anywhere',
    state: process.env.NEXT_PUBLIC_STATE ?? 'XX',
    business_name: process.env.NEXT_PUBLIC_SITE_NAME ?? 'LeadLandlord Demo',
    home: stub('home', '/', 'Welcome'),
    services: [],
    service_areas: [],
    about: stub('about', '/about', 'About'),
    contact: stub('contact', '/contact', 'Contact'),
    blog_posts: [],
    generated_at: new Date().toISOString(),
  };
}

function stub(kind: string, slug: string, title: string) {
  return {
    kind,
    slug,
    title,
    meta_description: `${title} — placeholder while no content.json is present.`,
    mdx: `# ${title}\n\nThis tenant site has no generated content yet. Run the dry-run.\n`,
  };
}

export function trackingNumber(): string {
  return process.env.NEXT_PUBLIC_TRACKING_NUMBER ?? '+1-555-0100';
}
