import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';

/**
 * Namecheap Registrar + DNS integration.
 *
 * Used by the Domain Procurer agent to:
 *   1. Search candidate domains for a (niche, city, state) and rank them
 *      using `namecheap.domains.check` (batched availability).
 *   2. Register the chosen domain via `namecheap.domains.create`.
 *   3. Set DNS records pointing the new domain at Vercel
 *      (apex A → 76.76.21.21, www CNAME → cname.vercel-dns.com)
 *      via `namecheap.domains.dns.setHosts`.
 *
 * MOCK MODE: NAMECHEAP_DRY_RUN === 'true' returns synthetic data without
 *   calling the API. (Decoupled from MOCK_TELEPHONY by design — the old
 *   Cloudflare integration silently honoured MOCK_TELEPHONY which made
 *   real-vs-mock impossible to reason about.)
 *
 * SANDBOX: NAMECHEAP_USE_SANDBOX === 'true' switches the base URL to
 *   api.sandbox.namecheap.com. Sandbox uses a *separate* account
 *   (sign up at namecheap.com/sandbox) but the same query-param auth shape.
 *
 * Docs (must be opened in a browser — Namecheap's docs subdomain is
 * Cloudflare-protected and rejects automated fetches):
 *   - Intro / auth:          https://www.namecheap.com/support/api/intro/
 *   - domains.check:         https://www.namecheap.com/support/api/methods/domains/check/
 *   - users.getPricing:      https://www.namecheap.com/support/api/methods/users/get-pricing/
 *   - domains.create:        https://www.namecheap.com/support/api/methods/domains/create/
 *   - domains.dns.setHosts:  https://www.namecheap.com/support/api/methods/domains/dns/set-hosts/
 *   - domains.dns.setDefault https://www.namecheap.com/support/api/methods/domains/dns/set-default/
 *
 * AUTH NOTES (Namecheap-specific gotchas):
 *   - API user, API key, UserName, and ClientIp are all REQUIRED query
 *     params on every request. UserName usually equals ApiUser.
 *   - ClientIp must match an IP on the user's whitelist set at
 *     ap.www.namecheap.com → Profile → Tools → API Access. Mismatch =
 *     "API Key is invalid or API access has not been enabled".
 *   - Production base: https://api.namecheap.com/xml.response
 *   - Sandbox base:    https://api.sandbox.namecheap.com/xml.response
 *   - Response is always XML wrapped in `<ApiResponse Status="OK|ERROR">`.
 *     Errors come as `<Errors><Error Number="...">message</Error></Errors>`.
 */

const PROD_BASE = 'https://api.namecheap.com/xml.response';
const SANDBOX_BASE = 'https://api.sandbox.namecheap.com/xml.response';

// Vercel's documented apex/www targets for Namecheap-hosted DNS.
// https://vercel.com/guides/how-to-add-vercel-environment-variables-to-your-namecheap-domain
const VERCEL_APEX_A = '76.76.21.21';
const VERCEL_WWW_CNAME = 'cname.vercel-dns.com';

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

export interface RegisterDomainResult {
  domain: string;
  registeredAt: Date;
  expiresAt: Date;
  priceUsd: number;
  orderId: string;
  transactionId: string;
}

// ─────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────

function isMock(): boolean {
  return process.env.NAMECHEAP_DRY_RUN === 'true';
}

function isSandbox(): boolean {
  return process.env.NAMECHEAP_USE_SANDBOX === 'true';
}

function getBaseUrl(): string {
  return isSandbox() ? SANDBOX_BASE : PROD_BASE;
}

interface NamecheapCreds {
  apiUser: string;
  apiKey: string;
  username: string;
  clientIp: string;
}

function getCreds(): NamecheapCreds {
  const apiUser = process.env.NAMECHEAP_API_USER;
  const apiKey = process.env.NAMECHEAP_API_KEY;
  const username = process.env.NAMECHEAP_USERNAME ?? apiUser;
  const clientIp = process.env.NAMECHEAP_CLIENT_IP;
  if (!apiUser || !apiKey || !username || !clientIp) {
    throw new IntegrationError(
      'namecheap',
      'NAMECHEAP_API_USER, NAMECHEAP_API_KEY, NAMECHEAP_USERNAME (or default to API_USER), and NAMECHEAP_CLIENT_IP are required',
    );
  }
  return { apiUser, apiKey, username, clientIp };
}

function defaultContact(): RegistrantContact {
  return {
    firstName: process.env.NAMECHEAP_REGISTRANT_FIRST_NAME ?? '',
    lastName: process.env.NAMECHEAP_REGISTRANT_LAST_NAME ?? '',
    address: process.env.NAMECHEAP_REGISTRANT_ADDRESS ?? '',
    city: process.env.NAMECHEAP_REGISTRANT_CITY ?? '',
    state: process.env.NAMECHEAP_REGISTRANT_STATE ?? '',
    zip: process.env.NAMECHEAP_REGISTRANT_ZIP ?? '',
    country: process.env.NAMECHEAP_REGISTRANT_COUNTRY ?? 'US',
    phone: process.env.NAMECHEAP_REGISTRANT_PHONE ?? '',
    email: process.env.NAMECHEAP_REGISTRANT_EMAIL ?? '',
    organization: process.env.NAMECHEAP_REGISTRANT_ORG || undefined,
  };
}

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

// ─────────────────────────────────────────────────────────────────────────
// Tiny XML helpers (kept inline to avoid a dep on fast-xml-parser; the
// Namecheap XML shape is regular and small enough that two regex helpers
// cover everything we need).
// ─────────────────────────────────────────────────────────────────────────

/** Read the value of an attribute from an XML element string. */
function attr(xml: string, tag: string, attribute: string): string | null {
  // Match <Tag ... Attr="value" ...> tolerating any attribute order.
  const tagPattern = new RegExp(
    `<${tag}\\b([^>]*)>`,
    'i',
  );
  const tagMatch = tagPattern.exec(xml);
  if (!tagMatch) return null;
  const attrPattern = new RegExp(`\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i');
  const a = attrPattern.exec(tagMatch[1]!);
  return a ? a[1]! : null;
}

/** Read inner text of the first matching tag. */
function tagText(xml: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = re.exec(xml);
  return m ? m[1]!.trim() : null;
}

/** Iterate over every occurrence of `<Tag ...>...</Tag>` (or self-closing). */
function findAll(xml: string, tag: string): string[] {
  const re = new RegExp(
    `<${tag}\\b[^>]*(?:/>|>[\\s\\S]*?</${tag}>)`,
    'gi',
  );
  return xml.match(re) ?? [];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// ─────────────────────────────────────────────────────────────────────────
// Network
// ─────────────────────────────────────────────────────────────────────────

/**
 * Issue a Namecheap API call (GET; body optional). Builds the standard
 * common-param query string, parses the XML envelope, and throws
 * IntegrationError on `<ApiResponse Status="ERROR">`.
 *
 * Pass extra params via `params`. For commands with many numbered fields
 * (setHosts: HostName1, RecordType1, …) the caller flattens them into one
 * Record<string, string>.
 */
async function ncRequest(
  command: string,
  params: Record<string, string>,
): Promise<string> {
  const { apiUser, apiKey, username, clientIp } = getCreds();
  const qs = new URLSearchParams({
    ApiUser: apiUser,
    ApiKey: apiKey,
    UserName: username,
    ClientIp: clientIp,
    Command: command,
    ...params,
  });
  const url = `${getBaseUrl()}?${qs.toString()}`;
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  if (!res.ok) {
    throw new IntegrationError(
      'namecheap',
      `${command} HTTP ${res.status}`,
      res.status,
      text.slice(0, 500),
    );
  }
  const status = attr(text, 'ApiResponse', 'Status');
  if (status && status.toUpperCase() === 'ERROR') {
    const errors = findAll(text, 'Error')
      .map((e) => decodeEntities(tagText(e, 'Error') ?? '').trim())
      .filter(Boolean);
    throw new IntegrationError(
      'namecheap',
      `${command} returned Status=ERROR: ${errors.join('; ') || 'unknown'}`,
      res.status,
      text.slice(0, 1000),
    );
  }
  return text;
}

// ─────────────────────────────────────────────────────────────────────────
// Pricing (cached per-process)
// ─────────────────────────────────────────────────────────────────────────

let pricingCache: Map<string, number> | null = null;

/**
 * Hardcoded fallback retail prices in USD (Namecheap, 1-year reg, current
 * as of 2026). Used in mock mode and as a fallback if `users.getPricing`
 * doesn't return a row for a TLD. Verify periodically.
 */
const NC_FALLBACK_PRICES: Record<string, number> = {
  com: 9.58,
  net: 12.98,
  org: 9.18,
  io: 39.98,
  co: 24.98,
  app: 16.98,
  dev: 14.98,
  ai: 75.98,
  xyz: 1.98,
  info: 4.98,
  biz: 5.98,
  us: 8.98,
};

function priceForTldFallback(domain: string): number | null {
  const tld = domain.split('.').pop()?.toLowerCase();
  return tld ? NC_FALLBACK_PRICES[tld] ?? null : null;
}

/**
 * Fetch and cache TLD register pricing for a 1-year registration.
 * Filters to ProductType=DOMAINS, ActionName=REGISTER, Duration=1.
 */
async function fetchPricingMap(): Promise<Map<string, number>> {
  if (pricingCache) return pricingCache;
  if (isMock()) {
    pricingCache = new Map(Object.entries(NC_FALLBACK_PRICES));
    return pricingCache;
  }
  const xml = await ncRequest('namecheap.users.getPricing', {
    ProductType: 'DOMAIN',
    ActionName: 'REGISTER',
  });
  const map = new Map<string, number>();
  // ProductCategory blocks contain Product blocks with Price rows.
  // Match <Product Name="com">…<Price Duration="1" … RegularPrice="9.58" YourPrice="9.58" .../></Product>
  const productBlocks = findAll(xml, 'Product');
  for (const block of productBlocks) {
    const name = attr(block, 'Product', 'Name');
    if (!name) continue;
    // Pick the Duration="1" Price row (annual reg).
    const priceRows = findAll(block, 'Price');
    for (const row of priceRows) {
      const dur = attr(row, 'Price', 'Duration');
      if (dur !== '1') continue;
      const yours = attr(row, 'Price', 'YourPrice') ?? attr(row, 'Price', 'RegularPrice');
      if (!yours) continue;
      const n = Number(yours);
      if (Number.isFinite(n)) map.set(name.toLowerCase(), n);
      break;
    }
  }
  // Backfill any missing TLDs from the hardcoded table so callers always
  // get a number for the common set.
  for (const [tld, price] of Object.entries(NC_FALLBACK_PRICES)) {
    if (!map.has(tld)) map.set(tld, price);
  }
  pricingCache = map;
  return map;
}

async function priceForTld(domain: string): Promise<number | null> {
  const tld = domain.split('.').pop()?.toLowerCase();
  if (!tld) return null;
  try {
    const map = await fetchPricingMap();
    return map.get(tld) ?? priceForTldFallback(domain);
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : err },
      'namecheap.users.getPricing failed — using fallback table',
    );
    return priceForTldFallback(domain);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Candidate generation (mirrors cloudflare integration)
// ─────────────────────────────────────────────────────────────────────────

interface RawCandidate {
  domain: string;
  matchType: 'exact' | 'partial' | 'keyword';
}

function getAllowedTlds(): Set<string> {
  const raw = process.env.NAMECHEAP_ALLOWED_TLDS ?? 'com,net';
  return new Set(
    raw
      .split(',')
      .map((t) => t.trim().toLowerCase().replace(/^\./, ''))
      .filter(Boolean),
  );
}

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

  // Keyword variants
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
// domains.check — batched availability
// ─────────────────────────────────────────────────────────────────────────

/**
 * Batched availability check using `namecheap.domains.check`. Per the
 * Namecheap docs, DomainList accepts a comma-separated list (max 50
 * domains per call). Returns a map of domain → available.
 *
 * Response shape (excerpt):
 *   <CommandResponse>
 *     <DomainCheckResult Domain="x.com" Available="true"
 *       IsPremiumName="false"
 *       PremiumRegistrationPrice="0.0" ... />
 *     ...
 *   </CommandResponse>
 *
 * Premium domains are flagged available=true but cost wildly more — we
 * exclude them from candidates to avoid surprise charges.
 */
export async function checkAvailability(domains: string[]): Promise<Map<string, { available: boolean; isPremium: boolean }>> {
  const result = new Map<string, { available: boolean; isPremium: boolean }>();
  if (domains.length === 0) return result;
  if (isMock()) {
    for (const d of domains) result.set(d, { available: true, isPremium: false });
    return result;
  }
  // Chunk to 50 just in case the caller passed more.
  for (let i = 0; i < domains.length; i += 50) {
    const chunk = domains.slice(i, i + 50);
    const xml = await ncRequest('namecheap.domains.check', {
      DomainList: chunk.join(','),
    });
    for (const block of findAll(xml, 'DomainCheckResult')) {
      const name = attr(block, 'DomainCheckResult', 'Domain');
      const avail = attr(block, 'DomainCheckResult', 'Available');
      const premium = attr(block, 'DomainCheckResult', 'IsPremiumName');
      if (!name) continue;
      result.set(name, {
        available: avail?.toLowerCase() === 'true',
        isPremium: premium?.toLowerCase() === 'true',
      });
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate candidate domains, check availability + retail price for each,
 * and return the top N (default 5) sorted by matchType priority then price.
 * Premium-priced names are excluded.
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
    log.info({ niche: args.niche, city: args.city, mock: true }, 'namecheap.searchDomains mock');
    return candidates.slice(0, topN).map((c, i) => ({
      domain: c.domain,
      available: true,
      priceUsd: priceForTldFallback(c.domain) ?? 9.58,
      matchType: c.matchType,
      rank: i + 1,
    }));
  }

  // Validate creds early.
  getCreds();
  const availMap = await checkAvailability(candidates.map((c) => c.domain));

  const checked = await Promise.all(
    candidates.map(async (c) => {
      const a = availMap.get(c.domain);
      const available = a?.available === true && a.isPremium === false;
      return {
        domain: c.domain,
        available,
        priceUsd: available ? await priceForTld(c.domain) : null,
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
 * Convert E.164 (`+18187267258`) to Namecheap's required `+CC.Number` format
 * (`+1.8187267258`). Namecheap's RegistrantPhone validator rejects the bare
 * E.164 string with error 2011182 ("Parameter RegistrantPhone is Invalid")
 * and demands the period-separated country-code form.
 *
 * Accepts: `+1...`, `+1.812...`, `1812...`, `(818) 726-7258`, etc.
 * Returns the canonical `+CC.Number` form. Country code defaulted to US (1)
 * when not detectable.
 */
function normalizePhoneForNamecheap(input: string): string {
  // Strip everything except digits and a leading + so the parse is stable.
  const cleaned = input.trim().replace(/[^\d+]/g, '');
  // Already in CC.Number form? Pass through.
  const dotForm = input.match(/^\+(\d{1,3})\.(\d{6,})$/);
  if (dotForm) return `+${dotForm[1]}.${dotForm[2]}`;

  let cc = '';
  let rest = '';
  if (cleaned.startsWith('+')) {
    // +1XXXXXXXXXX → cc=1, rest=XXXXXXXXXX (US/Canada). For other countries
    // (2-digit and 3-digit codes) use a small heuristic: the cc portion is
    // 1 digit if starts with 1 or 7, 2 digits for most others, 3 for African.
    // For now we only ship to US-based fleets, so default to +1.
    const digits = cleaned.slice(1);
    if (digits.startsWith('1') && digits.length === 11) {
      cc = '1';
      rest = digits.slice(1);
    } else if (digits.length >= 8 && digits.length <= 11) {
      // Assume the first 1-3 chars are CC; for safety default to length-10 → cc=1
      if (digits.length === 10) {
        cc = '1';
        rest = digits;
      } else {
        cc = digits.slice(0, digits.length - 10);
        rest = digits.slice(-10);
      }
    } else {
      cc = '1';
      rest = digits;
    }
  } else {
    // No leading + — assume US, strip a leading 1 if present.
    if (cleaned.length === 11 && cleaned.startsWith('1')) {
      cc = '1';
      rest = cleaned.slice(1);
    } else {
      cc = '1';
      rest = cleaned;
    }
  }
  return `+${cc}.${rest}`;
}

/**
 * Build the contact-block params for `domains.create`. Namecheap requires
 * all FOUR contact blocks (Registrant/Tech/Admin/AuxBilling); we set all
 * of them to identical values.
 */
function buildContactParams(c: RegistrantContact): Record<string, string> {
  const blocks = ['Registrant', 'Tech', 'Admin', 'AuxBilling'] as const;
  const phone = normalizePhoneForNamecheap(c.phone);
  const params: Record<string, string> = {};
  for (const b of blocks) {
    params[`${b}FirstName`] = c.firstName;
    params[`${b}LastName`] = c.lastName;
    params[`${b}Address1`] = c.address;
    params[`${b}City`] = c.city;
    params[`${b}StateProvince`] = c.state;
    params[`${b}PostalCode`] = c.zip;
    params[`${b}Country`] = c.country;
    params[`${b}Phone`] = phone;
    params[`${b}EmailAddress`] = c.email;
    if (c.organization) params[`${b}OrganizationName`] = c.organization;
  }
  return params;
}

/**
 * Register a domain via `namecheap.domains.create`. SPENDS REAL MONEY —
 * callers must hard-gate behind explicit user approval.
 *
 * Newly registered domains use Namecheap BasicDNS by default, which is
 * what we want — `setVercelDns` will then add the records.
 *
 * Response shape (excerpt):
 *   <DomainCreateResult Domain="x.com" Registered="true" ChargedAmount="9.58"
 *     DomainID="..." OrderID="..." TransactionID="..." />
 */
export async function registerDomain(args: {
  domain: string;
  contact?: RegistrantContact;
  autoRenew?: boolean;
  yearsOfRegistration?: number;
}): Promise<RegisterDomainResult> {
  const years = args.yearsOfRegistration ?? 1;
  const autoRenew = args.autoRenew ?? true;

  if (isMock()) {
    log.info({ domain: args.domain, mock: true }, 'namecheap.registerDomain mock');
    const now = new Date();
    return {
      domain: args.domain,
      registeredAt: now,
      expiresAt: new Date(now.getTime() + years * 365 * 24 * 60 * 60 * 1000),
      priceUsd: priceForTldFallback(args.domain) ?? 9.58,
      orderId: `mock-order-${slug(args.domain)}`,
      transactionId: `mock-tx-${slug(args.domain)}`,
    };
  }

  const contact = args.contact ?? defaultContact();
  // Sanity-check the contact: empty fields will return a generic error
  // from Namecheap that's hard to debug.
  for (const [k, v] of Object.entries(contact)) {
    if (k === 'organization') continue;
    if (!v) {
      throw new IntegrationError(
        'namecheap',
        `registrant contact is missing field "${k}" — set NAMECHEAP_REGISTRANT_* env vars`,
      );
    }
  }

  const params: Record<string, string> = {
    DomainName: args.domain,
    Years: String(years),
    // WhoisGuard (privacy proxy) — included free for one year on .com/.net/etc.
    AddFreeWhoisguard: 'yes',
    WGEnabled: 'yes',
    ...buildContactParams(contact),
  };

  const xml = await ncRequest('namecheap.domains.create', params);
  const block = findAll(xml, 'DomainCreateResult')[0];
  if (!block) {
    throw new IntegrationError(
      'namecheap',
      'domains.create returned no DomainCreateResult element',
      undefined,
      xml.slice(0, 500),
    );
  }
  const registered = attr(block, 'DomainCreateResult', 'Registered');
  if (registered?.toLowerCase() !== 'true') {
    throw new IntegrationError(
      'namecheap',
      `domains.create returned Registered=${registered}`,
      undefined,
      block,
    );
  }
  const charged = Number(attr(block, 'DomainCreateResult', 'ChargedAmount') ?? '0');
  const orderId = attr(block, 'DomainCreateResult', 'OrderID') ?? '';
  const transactionId = attr(block, 'DomainCreateResult', 'TransactionID') ?? '';

  // Set auto-renew via a follow-up call. This is a separate command —
  // domains.setRegistrarLock / domains.setAutoRenew. Failure here is
  // non-fatal (registration already happened).
  if (autoRenew) {
    try {
      const [sld, ...tldParts] = args.domain.split('.');
      const tld = tldParts.join('.');
      await ncRequest('namecheap.domains.setAutoRenew', {
        DomainName: args.domain,
        // setAutoRenew uses DomainName param directly; SLD/TLD only needed
        // for some DNS commands. Pass both in case docs change.
        SLD: sld ?? args.domain,
        TLD: tld,
      });
    } catch (err) {
      log.warn(
        { domain: args.domain, err: err instanceof Error ? err.message : err },
        'namecheap.setAutoRenew failed — registration succeeded, auto-renew not toggled',
      );
    }
  }

  const now = new Date();
  return {
    domain: args.domain,
    registeredAt: now,
    expiresAt: new Date(now.getTime() + years * 365 * 24 * 60 * 60 * 1000),
    priceUsd: charged,
    orderId,
    transactionId,
  };
}

/**
 * Configure DNS to point a Namecheap-hosted domain at Vercel. Sets:
 *   - `@`   A     → 76.76.21.21          (apex; Vercel's anycast IP)
 *   - `www` CNAME → cname.vercel-dns.com (subdomain alias)
 *
 * `domains.dns.setHosts` REPLACES all existing DNS records for the
 * domain, so call this before/instead of any other DNS edits — never
 * additively.
 */
export async function setVercelDns(domain: string): Promise<{ recordCount: number }> {
  if (isMock()) {
    log.info({ domain, mock: true }, 'namecheap.setVercelDns mock');
    return { recordCount: 2 };
  }
  const [sld, ...tldParts] = domain.split('.');
  const tld = tldParts.join('.');
  if (!sld || !tld) {
    throw new IntegrationError('namecheap', `setVercelDns: invalid domain "${domain}"`);
  }
  const params: Record<string, string> = {
    SLD: sld,
    TLD: tld,
    HostName1: '@',
    RecordType1: 'A',
    Address1: VERCEL_APEX_A,
    TTL1: '1800',
    HostName2: 'www',
    RecordType2: 'CNAME',
    Address2: VERCEL_WWW_CNAME,
    TTL2: '1800',
  };
  await ncRequest('namecheap.domains.dns.setHosts', params);
  return { recordCount: 2 };
}

// ─────────────────────────────────────────────────────────────────────────
// getHosts / addTxtRecord — additive DNS edits
// ─────────────────────────────────────────────────────────────────────────

export interface NamecheapHostRecord {
  name: string;
  type: string;
  address: string;
  ttl: string;
  mxPref?: string;
}

/**
 * Read all current host records on a Namecheap-managed domain via
 * `namecheap.domains.dns.getHosts`. Used as the read half of the
 * read-merge-write cycle required for additive edits, since `setHosts`
 * is destructive (replaces the entire host list).
 */
export async function getHosts(domain: string): Promise<NamecheapHostRecord[]> {
  if (isMock()) {
    log.info({ domain, mock: true }, 'namecheap.getHosts mock');
    return [];
  }
  const [sld, ...tldParts] = domain.split('.');
  const tld = tldParts.join('.');
  if (!sld || !tld) {
    throw new IntegrationError('namecheap', `getHosts: invalid domain "${domain}"`);
  }
  const xml = await ncRequest('namecheap.domains.dns.getHosts', { SLD: sld, TLD: tld });
  return findAll(xml, 'host').map((node) => ({
    name: attr(node, 'host', 'Name') ?? '',
    type: attr(node, 'host', 'Type') ?? '',
    address: decodeEntities(attr(node, 'host', 'Address') ?? ''),
    ttl: attr(node, 'host', 'TTL') ?? '1800',
    mxPref: attr(node, 'host', 'MXPref') ?? undefined,
  }));
}

/**
 * Additively add (or replace by name+type) a TXT record on a
 * Namecheap-hosted domain. Performs the read-merge-write cycle so
 * existing A/CNAME/MX/etc. records are preserved.
 *
 * If a TXT record with the same hostName already exists, its value is
 * replaced. Otherwise the record is appended.
 *
 * Returns the full record list after the write so callers can log /
 * verify what's now on the domain.
 */
export async function addTxtRecord(args: {
  domain: string;
  hostName: string;
  value: string;
  ttl?: string;
}): Promise<{ replaced: boolean; records: NamecheapHostRecord[] }> {
  const ttl = args.ttl ?? '1800';
  if (isMock()) {
    log.info(
      { domain: args.domain, hostName: args.hostName, mock: true },
      'namecheap.addTxtRecord mock',
    );
    return {
      replaced: false,
      records: [{ name: args.hostName, type: 'TXT', address: args.value, ttl }],
    };
  }
  const [sld, ...tldParts] = args.domain.split('.');
  const tld = tldParts.join('.');
  if (!sld || !tld) {
    throw new IntegrationError('namecheap', `addTxtRecord: invalid domain "${args.domain}"`);
  }

  const existing = await getHosts(args.domain);
  const replaced = existing.some((h) => h.name === args.hostName && h.type === 'TXT');
  const next: NamecheapHostRecord[] = replaced
    ? existing.map((h) =>
        h.name === args.hostName && h.type === 'TXT'
          ? { ...h, address: args.value, ttl }
          : h,
      )
    : [...existing, { name: args.hostName, type: 'TXT', address: args.value, ttl }];

  const params: Record<string, string> = { SLD: sld, TLD: tld };
  next.forEach((h, i) => {
    const idx = i + 1;
    params[`HostName${idx}`] = h.name;
    params[`RecordType${idx}`] = h.type;
    params[`Address${idx}`] = h.address;
    params[`TTL${idx}`] = h.ttl;
    if (h.mxPref && h.type === 'MX') params[`MXPref${idx}`] = h.mxPref;
  });
  await ncRequest('namecheap.domains.dns.setHosts', params);
  return { replaced, records: next };
}

/**
 * Switch the domain back to Namecheap BasicDNS (default for new domains).
 * Useful only if a previous step accidentally set custom nameservers.
 */
export async function useDefaultDns(domain: string): Promise<void> {
  if (isMock()) {
    log.info({ domain, mock: true }, 'namecheap.useDefaultDns mock');
    return;
  }
  const [sld, ...tldParts] = domain.split('.');
  const tld = tldParts.join('.');
  if (!sld || !tld) {
    throw new IntegrationError('namecheap', `useDefaultDns: invalid domain "${domain}"`);
  }
  await ncRequest('namecheap.domains.dns.setDefault', { SLD: sld, TLD: tld });
}

// Schemas exported for callers who want runtime validation.
export const DomainCandidateSchema = z.object({
  domain: z.string(),
  available: z.boolean(),
  priceUsd: z.number().nullable(),
  matchType: z.enum(['exact', 'partial', 'keyword']),
  rank: z.number().int().nonnegative(),
});

// Legacy stub — keep so older imports don't break. Backed by checkAvailability.
export async function checkSingleAvailability(
  domain: string,
): Promise<{ available: boolean; price_usd?: number }> {
  const map = await checkAvailability([domain]);
  const a = map.get(domain);
  const price = await priceForTld(domain);
  return {
    available: a?.available === true && a.isPremium === false,
    ...(price != null ? { price_usd: price } : {}),
  };
}
