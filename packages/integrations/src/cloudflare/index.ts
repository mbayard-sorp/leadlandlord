import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';

/**
 * Cloudflare Registrar + DNS integration.
 *
 * Used by the Domain Procurer agent to:
 *   1. Search candidate domains for a (niche, city, state) and rank them.
 *   2. Register the chosen domain via the Cloudflare Registrar API.
 *   3. Add a CF-managed zone for the domain and create the apex/wildcard
 *      CNAMEs that point at Vercel (`cname.vercel-dns.com`).
 *
 * MOCK MODE: when CLOUDFLARE_DRY_RUN === 'true' OR MOCK_TELEPHONY === 'true'
 * (the latter being the global "no spend" switch used by scripts/dry-run.ts),
 * all functions return synthetic results without calling the API.
 *
 * Docs:
 *   - Registrar:  https://developers.cloudflare.com/api/operations/registrar-domains-list-domains
 *   - Zones:      https://developers.cloudflare.com/api/operations/zones-post
 *   - DNS records https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-create-dns-record
 */

const CF_BASE = 'https://api.cloudflare.com/client/v4';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

export interface DomainCandidate {
  domain: string;
  available: boolean;
  priceUsd: number | null;
  matchType: 'exact' | 'partial' | 'keyword';
  rank: number;
}

export interface RegisterDomainResult {
  domain: string;
  zoneId: string;
  registeredAt: Date;
  expiresAt: Date;
  priceUsd: number;
}

export interface RegistrantContact {
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  email: string;
  organization?: string;
}

// Cloudflare's standard response envelope.
const CFEnvelope = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })).optional(),
  messages: z.array(z.unknown()).optional(),
  result: z.unknown().optional(),
});

// Subset of fields we read from the availability endpoint.
const AvailabilityResult = z.object({
  available: z.boolean().optional(),
  premium: z.boolean().optional(),
  // Pricing is sometimes returned at top level; sometimes only via the
  // "registrar/domains" catalog. Coerce to number when present.
  current_price: z.coerce.number().optional(),
  transfer_in_price: z.coerce.number().optional(),
  registration_price: z.coerce.number().optional(),
});

const ZoneResult = z.object({
  id: z.string(),
  name: z.string(),
  name_servers: z.array(z.string()).optional(),
});

const DnsRecordResult = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
});

const RegistrarDomainResult = z.object({
  name: z.string(),
  registry_statuses: z.string().optional(),
  available: z.boolean().optional(),
  current_period_expires_at: z.string().optional(),
  registered_at: z.string().optional(),
  expires_at: z.string().optional(),
  cor_response_url: z.string().optional(),
  current_price: z.coerce.number().optional(),
});

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

function isMock(): boolean {
  // MOCK_TELEPHONY is a Twilio-only flag and must NOT gate Cloudflare —
  // historically it triggered mock here too, which made the agent silently
  // return synthetic candidates even when the operator wanted real data.
  return process.env.CLOUDFLARE_DRY_RUN === 'true';
}

/**
 * RDAP-based domain availability check. Cloudflare's `/registrar/domains/{name}/availability`
 * endpoint is not in the public API surface (returns 404), so we use the
 * registry-of-record's RDAP service via the rdap.org bootstrap.
 *
 * Returns `{ available: true }` when no registration record exists (HTTP 404),
 * `{ available: false }` when one exists (HTTP 200), and `null` on error so
 * the caller can decide to skip vs treat as unavailable.
 */
async function rdapCheckAvailability(domain: string): Promise<boolean | null> {
  try {
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`, {
      method: 'GET',
      // rdap.org redirects to the authoritative registry; follow them.
      redirect: 'follow',
    });
    if (r.status === 404) return true;  // No registration record → available
    if (r.status === 200) return false; // Registration exists → taken
    // 429 / 5xx / other — treat as unknown
    return null;
  } catch {
    return null;
  }
}

/**
 * Cloudflare publishes at-cost domain pricing on their pricing page; the public
 * API doesn't expose them for unowned domains. Hardcode the common TLDs with
 * their current at-cost annual price (USD). Source: cloudflare.com/products/registrar/
 * — verify periodically. Unknown TLDs return null and the candidate is shown
 * with "—" price; the actual charge is computed at registration time.
 */
const CF_AT_COST_PRICES: Record<string, number> = {
  com: 10.44,
  net: 12.18,
  org: 10.11,
  io: 41.4,
  co: 25.31,
  app: 14.0,
  dev: 12.0,
  ai: 75.0,
  xyz: 9.95,
  info: 14.99,
  biz: 16.61,
  us: 8.61,
};

function priceForTld(domain: string): number | null {
  const tld = domain.split('.').pop()?.toLowerCase();
  return tld ? CF_AT_COST_PRICES[tld] ?? null : null;
}

function getCreds(): { token: string; accountId: string } {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!token || !accountId) {
    throw new IntegrationError(
      'cloudflare',
      'CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are required',
    );
  }
  return { token, accountId };
}

function defaultContact(): RegistrantContact {
  return {
    firstName: process.env.CLOUDFLARE_REGISTRANT_FIRST_NAME ?? '',
    lastName: process.env.CLOUDFLARE_REGISTRANT_LAST_NAME ?? '',
    address: process.env.CLOUDFLARE_REGISTRANT_ADDRESS ?? '',
    city: process.env.CLOUDFLARE_REGISTRANT_CITY ?? '',
    state: process.env.CLOUDFLARE_REGISTRANT_STATE ?? '',
    zip: process.env.CLOUDFLARE_REGISTRANT_ZIP ?? '',
    country: process.env.CLOUDFLARE_REGISTRANT_COUNTRY ?? 'US',
    phone: process.env.CLOUDFLARE_REGISTRANT_PHONE ?? '',
    email: process.env.CLOUDFLARE_REGISTRANT_EMAIL ?? '',
    organization: process.env.CLOUDFLARE_REGISTRANT_ORG || undefined,
  };
}

async function cfFetch(
  path: string,
  init: RequestInit & { token: string },
): Promise<unknown> {
  const { token, ...rest } = init;
  const res = await fetch(`${CF_BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(rest.headers ?? {}),
    },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    /* fall through */
  }
  if (!res.ok) {
    throw new IntegrationError(
      'cloudflare',
      `${init.method ?? 'GET'} ${path} failed: ${res.status}`,
      res.status,
      json ?? text,
    );
  }
  const env = CFEnvelope.parse(json);
  if (!env.success) {
    throw new IntegrationError(
      'cloudflare',
      `API returned success=false: ${(env.errors ?? []).map((e) => e.message).join('; ') || 'unknown'}`,
      res.status,
      env,
    );
  }
  return env.result;
}

// ─────────────────────────────────────────────────────────────────────────
// Candidate generation
// ─────────────────────────────────────────────────────────────────────────

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^-+|-+$/g, '');
}

function slugWithHyphens(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface RawCandidate {
  domain: string;
  matchType: 'exact' | 'partial' | 'keyword';
}

/**
 * Allowed TLDs are read from `CLOUDFLARE_ALLOWED_TLDS` (CSV) and default to
 * the SEO-trustworthy set: `.com` is universally trusted, `.net` is the
 * accepted fallback. Avoid `.io`, `.co`, `.app` etc. for local-services
 * sites — clients type `.com` instinctively, alt-TLDs hurt trust + CTR.
 *
 * To enable an alt TLD per build, set the env var, e.g.:
 *   CLOUDFLARE_ALLOWED_TLDS=com,net,co
 */
function getAllowedTlds(): Set<string> {
  const raw = process.env.CLOUDFLARE_ALLOWED_TLDS ?? 'com,net';
  return new Set(
    raw
      .split(',')
      .map((t) => t.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean),
  );
}

/**
 * Common metro nicknames for better candidate generation. When a city has a
 * widely-used short form, also generate `{niche}{nickname}.com` style domains.
 * Keep this list focused on US metros with high SEO competition where the
 * canonical name is often already taken.
 */
const CITY_NICKNAMES: Record<string, string[]> = {
  'las vegas': ['vegas', 'lv'],
  'los angeles': ['la', 'losangeles'],
  'new york': ['nyc', 'newyork', 'ny'],
  'san francisco': ['sf', 'sfbay'],
  'philadelphia': ['philly'],
  'phoenix': ['phx'],
  'chicago': ['chitown', 'chi'],
  'washington': ['dc'],
  'minneapolis': ['mpls', 'twincities'],
  'st. louis': ['stl'],
  'st louis': ['stl'],
};

function generateCandidates(args: { niche: string; city: string; state: string }): RawCandidate[] {
  const niche = slug(args.niche);
  const city = slug(args.city);
  const state = slug(args.state);
  const nicheH = slugWithHyphens(args.niche);
  const cityH = slugWithHyphens(args.city);
  const cityKey = args.city.toLowerCase().trim();
  const nicknames = CITY_NICKNAMES[cityKey] ?? [];

  const allowed = getAllowedTlds();
  const out: RawCandidate[] = [];
  const push = (domain: string, matchType: 'exact' | 'partial' | 'keyword') => {
    const tld = domain.split('.').pop()?.toLowerCase();
    if (tld && !allowed.has(tld)) return;
    if (!out.find((c) => c.domain === domain)) out.push({ domain, matchType });
  };

  // Exact-match: niche + city
  push(`${niche}${city}.com`, 'exact');
  push(`${nicheH}-${cityH}.com`, 'exact');
  push(`${niche}${city}.net`, 'exact');
  push(`${niche}${city}.io`, 'exact');
  push(`${niche}${city}.co`, 'exact');

  // Exact-match against city nicknames (often the only available option for
  // competitive metros where the full city name is taken).
  for (const nick of nicknames) {
    push(`${niche}${nick}.com`, 'exact');
    push(`${nicheH}-${nick}.com`, 'exact');
    push(`${niche}${nick}.net`, 'exact');
  }

  // Partial: niche+state, city+niche
  push(`${niche}${state}.com`, 'partial');
  push(`${niche}${state}.net`, 'partial');
  push(`${city}${niche}.com`, 'partial');
  push(`${city}${niche}.net`, 'partial');
  push(`${nicheH}-${cityH}.io`, 'partial');

  // Keyword variants — descriptors that signal local services without being
  // brand-y. Heavy on .com because that's where SEO trust lives.
  push(`${niche}.io`, 'keyword');
  push(`get${niche}${city}.com`, 'keyword');
  push(`${niche}${city}pros.com`, 'keyword');
  push(`${niche}${city}llc.com`, 'keyword');
  push(`${niche}${city}co.com`, 'keyword');
  push(`local${niche}${city}.com`, 'keyword');
  push(`${niche}of${city}.com`, 'keyword');
  push(`${niche}services${city}.com`, 'keyword');
  push(`${city}${niche}company.com`, 'keyword');
  push(`top${niche}${city}.com`, 'keyword');
  push(`best${niche}${city}.com`, 'keyword');
  for (const nick of nicknames) {
    push(`${niche}${nick}pros.com`, 'keyword');
    push(`get${niche}${nick}.com`, 'keyword');
    push(`top${niche}${nick}.com`, 'keyword');
  }

  return out;
}

const MATCH_RANK: Record<RawCandidate['matchType'], number> = {
  exact: 0,
  partial: 1,
  keyword: 2,
};

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate ~10 candidate domains, check availability + price for each, and
 * return the top N (default 5) sorted by matchType priority then price.
 */
export async function searchDomains(args: {
  niche: string;
  city: string;
  state: string;
  topN?: number;
}): Promise<DomainCandidate[]> {
  const topN = args.topN ?? 5;
  const candidates = generateCandidates(args);

  if (isMock()) {
    log.info({ niche: args.niche, city: args.city, mock: true }, 'cloudflare.searchDomains mock');
    return candidates.slice(0, topN).map((c, i) => ({
      domain: c.domain,
      available: true,
      priceUsd: 11.18,
      matchType: c.matchType,
      rank: i + 1,
    }));
  }

  // Validate creds early so we fail loudly rather than silently producing
  // an empty list (which historically looked identical to "all taken").
  getCreds();
  const checked = await Promise.all(
    candidates.map(async (c) => {
      const available = await rdapCheckAvailability(c.domain);
      if (available === null) {
        log.warn({ domain: c.domain }, 'rdap availability check inconclusive — skipping candidate');
      }
      return {
        domain: c.domain,
        available: available === true,
        priceUsd: priceForTld(c.domain),
        matchType: c.matchType,
      };
    }),
  );

  const sorted = checked
    .filter((c) => c.available)
    .sort((a, b) => {
      const m = MATCH_RANK[a.matchType] - MATCH_RANK[b.matchType];
      if (m !== 0) return m;
      return (a.priceUsd ?? Infinity) - (b.priceUsd ?? Infinity);
    })
    .slice(0, topN)
    .map((c, i) => ({ ...c, rank: i + 1 }));

  return sorted;
}

/**
 * Register a domain via the Cloudflare Registrar API. SPENDS REAL MONEY —
 * callers must hard-gate behind explicit user approval.
 */
export async function registerDomain(args: {
  domain: string;
  contact?: RegistrantContact;
  autoRenew?: boolean;
}): Promise<RegisterDomainResult> {
  const autoRenew = args.autoRenew ?? true;

  if (isMock()) {
    log.info({ domain: args.domain, mock: true }, 'cloudflare.registerDomain mock');
    const now = new Date();
    return {
      domain: args.domain,
      zoneId: `mock-zone-${slug(args.domain)}`,
      registeredAt: now,
      expiresAt: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
      priceUsd: 11.18,
    };
  }

  const { token, accountId } = getCreds();
  const contact = args.contact ?? defaultContact();

  // Cloudflare Registrar registration body. The exact registrant_contact
  // shape is what their public docs show — first_name, last_name, address,
  // city, state, zip, country, phone, email, organization.
  const body = {
    enabled: true,
    locked: true,
    privacy: true,
    auto_renew: autoRenew,
    name_servers: [] as string[],
    registrant_contact: {
      first_name: contact.firstName,
      last_name: contact.lastName,
      address: contact.address,
      city: contact.city,
      state: contact.state,
      zip: contact.zip,
      country: contact.country,
      phone: contact.phone,
      email: contact.email,
      ...(contact.organization ? { organization: contact.organization } : {}),
    },
  };

  const result = (await cfFetch(
    `/accounts/${encodeURIComponent(accountId)}/registrar/domains/${encodeURIComponent(args.domain)}`,
    { method: 'POST', token, body: JSON.stringify(body) },
  )) as unknown;
  const parsed = RegistrarDomainResult.parse(result ?? {});

  // After registration, add the zone so we can manage DNS.
  const zone = await addZone(args.domain);

  const registeredAt = parsed.registered_at ? new Date(parsed.registered_at) : new Date();
  const expiresAt = parsed.expires_at
    ? new Date(parsed.expires_at)
    : parsed.current_period_expires_at
      ? new Date(parsed.current_period_expires_at)
      : new Date(registeredAt.getTime() + 365 * 24 * 60 * 60 * 1000);

  return {
    domain: args.domain,
    zoneId: zone.zoneId,
    registeredAt,
    expiresAt,
    priceUsd: parsed.current_price ?? 0,
  };
}

/** Add a Cloudflare zone for `domain`. Returns the zoneId + assigned NS records. */
export async function addZone(domain: string): Promise<{ zoneId: string; nameservers: string[] }> {
  if (isMock()) {
    return {
      zoneId: `mock-zone-${slug(domain)}`,
      nameservers: ['ns1.mock.cloudflare.com', 'ns2.mock.cloudflare.com'],
    };
  }
  const { token, accountId } = getCreds();
  const body = {
    name: domain,
    account: { id: accountId },
    type: 'full',
    jump_start: false,
  };
  const result = (await cfFetch(`/zones`, {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  })) as unknown;
  const parsed = ZoneResult.parse(result ?? {});
  return { zoneId: parsed.id, nameservers: parsed.name_servers ?? [] };
}

/**
 * Create the two DNS records that point a freshly-registered domain at
 * Vercel:
 *   - apex (`@`)   CNAME → cname.vercel-dns.com  (CF flattens at apex)
 *   - wildcard (`*`) CNAME → cname.vercel-dns.com
 *
 * Both records are unproxied — Vercel terminates TLS itself, and CF proxy
 * mode would create a redirect loop.
 */
export async function createApexAndWildcardRecords(args: {
  zoneId: string;
}): Promise<{ recordIds: string[] }> {
  const target = 'cname.vercel-dns.com';
  if (isMock()) {
    return { recordIds: [`mock-rec-apex-${args.zoneId}`, `mock-rec-wildcard-${args.zoneId}`] };
  }
  const { token } = getCreds();
  const make = async (name: string) => {
    const result = (await cfFetch(`/zones/${encodeURIComponent(args.zoneId)}/dns_records`, {
      method: 'POST',
      token,
      body: JSON.stringify({ type: 'CNAME', name, content: target, proxied: false, ttl: 1 }),
    })) as unknown;
    return DnsRecordResult.parse(result ?? {}).id;
  };
  const apex = await make('@');
  const wildcard = await make('*');
  return { recordIds: [apex, wildcard] };
}

/** Delete a Cloudflare zone — used for rollback during failed provisioning + dev cleanup. */
export async function deleteZone(zoneId: string): Promise<void> {
  if (isMock()) {
    log.info({ zoneId, mock: true }, 'cloudflare.deleteZone mock');
    return;
  }
  const { token } = getCreds();
  await cfFetch(`/zones/${encodeURIComponent(zoneId)}`, { method: 'DELETE', token });
}
