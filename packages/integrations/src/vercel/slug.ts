import { z } from 'zod';
import { vercelFetch } from './client';

const ProjectSearchResponseSchema = z.object({
  projects: z.array(z.object({ id: z.string(), name: z.string() })),
});

/**
 * Convert a `niche` + `city` into a kebab-case Vercel project name (≤100 chars,
 * lowercase letters/digits/hyphens only, no leading/trailing hyphen).
 *
 * Strategy: slugify(niche)-slugify(city)-state, then dedupe against existing
 * projects via /v9/projects?search=.
 */
export async function projectNameFor({
  niche,
  city,
  state,
}: {
  niche: string;
  city: string;
  state: string;
}): Promise<string> {
  const base = [slugify(niche), slugify(city), state.toLowerCase()].filter(Boolean).join('-').slice(0, 90);
  return uniquify(base);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function uniquify(base: string): Promise<string> {
  // Search for any existing project that starts with `base`.
  let res: unknown;
  try {
    res = await vercelFetch(`/v9/projects?search=${encodeURIComponent(base)}&limit=20`);
  } catch {
    return base;
  }
  const parsed = ProjectSearchResponseSchema.safeParse(res);
  if (!parsed.success) return base;
  const taken = new Set(parsed.data.projects.map((p) => p.name));
  if (!taken.has(base)) return base;
  // Append a 4-char random suffix until we find an open name.
  for (let i = 0; i < 5; i++) {
    const candidate = `${base}-${randSuffix()}`;
    if (!taken.has(candidate)) return candidate.slice(0, 100);
  }
  // Last resort: timestamp.
  return `${base}-${Date.now().toString(36)}`.slice(0, 100);
}

function randSuffix() {
  return Math.random().toString(36).slice(2, 6);
}
