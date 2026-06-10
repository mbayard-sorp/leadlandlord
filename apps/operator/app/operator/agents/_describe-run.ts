/**
 * Builds a human-readable "Task" label for an agent run from its recorded
 * input payload, the joined site row, and the dedupe key. Inputs are
 * Zod-parsed agent inputs stored verbatim, so field names vary per agent
 * (snake_case for most, camelCase for a few) — this reads both.
 */

export interface RunSiteInfo {
  niche: string | null;
  city: string | null;
  state: string | null;
  domain: string | null;
}

type Json = Record<string, unknown>;

function str(input: Json, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = input[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return undefined;
}

/** True for UUIDs — useful in input payloads, noise in a label. */
function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export function describeRun(
  agent: string,
  input: unknown,
  dedupeKey: string | null,
  site: RunSiteInfo | null,
): string {
  const i: Json = input && typeof input === 'object' ? (input as Json) : {};
  const parts: string[] = [];

  // Where: prefer the joined site row; fall back to niche/city in the input
  // (site-builder runs before the site row exists).
  if (site?.niche) {
    parts.push(site.domain ?? `${site.niche} · ${site.city}, ${site.state}`);
  } else {
    const niche = str(i, 'niche');
    const city = str(i, 'city');
    if (niche && city) {
      const state = str(i, 'state');
      parts.push(`${niche} · ${city}${state ? `, ${state}` : ''}`);
    } else if (niche) {
      parts.push(niche);
    }
  }

  // What: discriminators and human-meaningful scalars common across agents.
  const what = [
    str(i, 'mode', 'action', 'step', 'scope'),
    str(i, 'url'),
    str(i, 'strategy'),
    str(i, 'date'),
    str(i, 'name'), // wave-launcher start
  ].filter((v): v is string => Boolean(v) && !isUuid(v!));
  parts.push(...what);

  // niche-hunter input is all hunt parameters — summarize the hunt instead.
  if (agent === 'niche-hunter' && parts.length === 0) {
    const geo = i.geo_filter as Json | undefined;
    const states = Array.isArray(geo?.states) ? (geo.states as string[]).join('/') : null;
    const count = str(i, 'target_count');
    if (count || states) {
      return ['hunt', count ? `${count} niches` : null, states].filter(Boolean).join(' · ');
    }
  }

  if (parts.length > 0) return parts.join(' · ');

  // No readable fields (ID-only or empty inputs): the dedupe key is usually
  // a human-oriented composite like "roofing:denver:CO" — use it after
  // dropping UUIDs, the agent's own name, and the bare "event:<id>" fallback
  // BaseAgent writes when an agent has no dedupeKeyFn.
  if (dedupeKey) {
    const readable = dedupeKey
      .split(':')
      .filter((seg) => seg.length > 0 && !isUuid(seg) && seg !== agent && seg !== 'event');
    if (readable.length > 0) return readable.join(' · ');
  }

  return '—';
}
