/**
 * Niche-knowledge reader for job-story authoring.
 *
 * Job-story posts must be factually accurate: the problem discovered and the
 * fix applied have to be genuine, common scenarios for the niche — not invented
 * technique. The content-engine niche overlays already encode that domain
 * knowledge (terminology, common customer pain points, regulations) and are the
 * single source of truth. This reader extracts the relevant sections so the
 * scout (ideation) and writer (drafting) can ground stories in real facts.
 *
 * We read the overlay `.md` files directly rather than importing
 * content-engine's loader, so `shared` stays a lightweight leaf module that any
 * agent can depend on without pulling in the content-engine graph.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Theme key → overlay filename in content-engine/niches/. Mirrors THEME_TO_OVERLAY. */
const THEME_TO_OVERLAY: Record<string, string> = {
  classic: 'trades',
  modern: 'modern',
  premium: 'premium',
  bright: 'bright',
  haul: 'haul',
  counsel: 'counsel',
};

/**
 * Section heading keywords (matched case-insensitively as substrings of `## `
 * headings) that carry the factual material a job story needs, in priority
 * order. Headings vary slightly across overlays (e.g. "Common Customer Pain
 * Points", "Regulations to Reference Generically"), so we match on stable
 * keywords. Output is ordered by this priority so that, if the block is capped,
 * the least critical section (regulations) is truncated first.
 */
const WANTED_SECTION_KEYWORDS = ['pain point', 'terminology', 'regulation'];

const knowledgeCache = new Map<string, string | null>();

/** Split overlay markdown into `## ` sections as [heading, body] pairs. */
function splitSections(md: string): Array<{ heading: string; body: string }> {
  const lines = md.split('\n');
  const sections: Array<{ heading: string; body: string }> = [];
  let current: { heading: string; body: string[] } | null = null;
  for (const line of lines) {
    const m = /^##\s+(.*)$/.exec(line);
    if (m) {
      if (current) sections.push({ heading: current.heading, body: current.body.join('\n').trim() });
      current = { heading: m[1]!.trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push({ heading: current.heading, body: current.body.join('\n').trim() });
  return sections;
}

/**
 * Return a compact factual knowledge block for the given theme — the
 * Terminology, Common Customer Pain Points, and Regulations sections of the
 * niche overlay. Returns null when the theme is unknown or the overlay is
 * missing (callers fall back to generic guidance).
 *
 * @param maxChars cap the block so it stays cheap to inject into prompts.
 */
export function loadNicheKnowledge(themeKey: string | undefined, maxChars = 5000): string | null {
  if (!themeKey) return null;
  const cacheKey = `${themeKey}:${maxChars}`;
  if (knowledgeCache.has(cacheKey)) return knowledgeCache.get(cacheKey) ?? null;

  const slug = THEME_TO_OVERLAY[themeKey];
  if (!slug) {
    knowledgeCache.set(cacheKey, null);
    return null;
  }

  let md: string;
  try {
    md = readFileSync(resolve(__dirname, '..', 'content-engine', 'niches', `${slug}.md`), 'utf-8');
  } catch {
    knowledgeCache.set(cacheKey, null);
    return null;
  }

  const priorityOf = (heading: string): number => {
    const h = heading.toLowerCase();
    const idx = WANTED_SECTION_KEYWORDS.findIndex((kw) => h.includes(kw));
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
  };
  const wanted = splitSections(md)
    .filter((s) => priorityOf(s.heading) !== Number.MAX_SAFE_INTEGER)
    .sort((a, b) => priorityOf(a.heading) - priorityOf(b.heading));
  if (!wanted.length) {
    knowledgeCache.set(cacheKey, null);
    return null;
  }

  let block = wanted.map((s) => `## ${s.heading}\n${s.body}`).join('\n\n').trim();
  if (block.length > maxChars) block = `${block.slice(0, maxChars - 1)}…`;

  knowledgeCache.set(cacheKey, block);
  return block;
}
