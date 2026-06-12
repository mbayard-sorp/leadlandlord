/**
 * Resolve a site's theme key (classic | modern | premium | bright | haul |
 * counsel) from its Sanity site doc. The theme lives in Sanity (a reference to
 * a `theme` doc whose `name` is the key), not in the Postgres `sites` row.
 *
 * Used by the local-content pipeline to pick the right niche-knowledge overlay
 * for factual grounding of job-story posts. Returns null on any miss so callers
 * fall back to generic guidance.
 */
import { createReadClient, siteDocId } from '@leadlandlord/integrations/sanity';

export type ThemeKey = 'classic' | 'modern' | 'premium' | 'bright' | 'haul' | 'counsel';

const VALID: ReadonlySet<string> = new Set([
  'classic',
  'modern',
  'premium',
  'bright',
  'haul',
  'counsel',
]);

export async function resolveSiteThemeKey(siteId: string): Promise<ThemeKey | undefined> {
  try {
    const sanity = createReadClient();
    const name = await sanity.fetch<string | null>(
      `*[_id == $siteDoc][0].theme->name`,
      { siteDoc: siteDocId(siteId) },
    );
    return name && VALID.has(name) ? (name as ThemeKey) : undefined;
  } catch {
    return undefined;
  }
}
