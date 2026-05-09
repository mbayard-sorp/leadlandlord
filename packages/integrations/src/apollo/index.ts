import { z } from 'zod';
import { IntegrationError } from '@leadlandlord/shared/errors';
import { log } from '@leadlandlord/shared/log';

const APOLLO_BASE = 'https://api.apollo.io/api/v1';

/**
 * Issue a request against Apollo's REST API. Apollo uses a custom
 * `X-Api-Key` header (not standard Bearer auth).
 *
 * Docs: https://docs.apollo.io/reference
 */
async function apolloFetch<T>(path: string, init: { method?: string; body?: unknown }): Promise<T> {
  const apiKey = process.env.APOLLO_API_KEY;
  if (!apiKey) {
    throw new IntegrationError('apollo', 'APOLLO_API_KEY is not set');
  }
  const res = await fetch(`${APOLLO_BASE}${path}`, {
    method: init.method ?? 'POST',
    headers: {
      'Cache-Control': 'no-cache',
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Api-Key': apiKey,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new IntegrationError('apollo', `${path} → ${res.status} ${text.slice(0, 500)}`, res.status, text);
  }
  return (await res.json()) as T;
}

const OrganizationSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  website_url: z.string().nullable().optional(),
  primary_domain: z.string().nullable().optional(),
  estimated_num_employees: z.number().nullable().optional(),
  industry: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
});
export type ApolloOrganization = z.infer<typeof OrganizationSchema>;

const EnrichOrganizationResponseSchema = z.object({
  organization: OrganizationSchema.nullable().optional(),
});

/**
 * Enrich an organization by domain. Returns Apollo's internal org ID + size +
 * industry. Used as the first step before fetching top people at the org.
 *
 * Apollo Restricted Key endpoint: api/v1/organizations/enrich
 *
 * Returns null when Apollo has no record for this domain (common for very
 * small local businesses). Caller should treat null as "no enrichment
 * available" and continue with the Google Places data alone.
 */
export async function enrichOrganization(domain: string): Promise<ApolloOrganization | null> {
  const cleaned = normalizeDomain(domain);
  if (!cleaned) return null;
  try {
    const json = await apolloFetch<unknown>(`/organizations/enrich?domain=${encodeURIComponent(cleaned)}`, {
      method: 'POST',
    });
    const parsed = EnrichOrganizationResponseSchema.parse(json);
    return parsed.organization ?? null;
  } catch (err) {
    if (err instanceof IntegrationError && err.status === 404) {
      return null;
    }
    throw err;
  }
}

const ApolloPersonSchema = z.object({
  id: z.string().optional(),
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  /** Apollo masks emails on lower-tier responses with values like 'email_not_unlocked@domain.com'. */
  email_status: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
  organization_id: z.string().nullable().optional(),
  seniority: z.string().nullable().optional(),
});
export type ApolloPerson = z.infer<typeof ApolloPersonSchema>;

const TopPeopleResponseSchema = z.object({
  people: z.array(ApolloPersonSchema).default([]),
});

/**
 * Fetch the top decision-makers at a given organization. Apollo returns up
 * to 10 people ordered by seniority — owners, founders, CEOs, GMs first.
 *
 * Apollo Restricted Key endpoint: api/v1/mixed_people/organization_top_people
 *
 * Note: email values may be masked as 'email_not_unlocked@<domain>' when
 * the caller's plan doesn't include email reveals. Filter on email_status
 * to detect verified vs masked.
 */
export async function getOrganizationTopPeople(orgId: string): Promise<ApolloPerson[]> {
  const json = await apolloFetch<unknown>(
    `/mixed_people/organization_top_people?organization_id=${encodeURIComponent(orgId)}`,
    { method: 'POST' },
  );
  const parsed = TopPeopleResponseSchema.parse(json);
  log.info({ orgId, count: parsed.people.length }, 'apollo top_people');
  return parsed.people;
}

/**
 * Convenience helper — chains organization enrichment + top-people lookup.
 * Returns the best owner-tier match Apollo can find for a domain, or null
 * when no enrichment is available.
 *
 * "Best match" preference order:
 *   1. Anyone with email_status === 'verified' AND a senior title
 *   2. Anyone with email_status === 'verified'
 *   3. The first person Apollo returns (ordered by seniority server-side)
 */
export async function findOwnerByDomain(domain: string): Promise<{
  org: ApolloOrganization;
  person: ApolloPerson;
} | null> {
  const org = await enrichOrganization(domain);
  if (!org?.id) return null;
  const people = await getOrganizationTopPeople(org.id);
  if (people.length === 0) return null;

  const verifiedSenior = people.find(
    (p) =>
      p.email_status === 'verified' && hasOwnerTitle(p.title) && hasUsableEmail(p.email),
  );
  if (verifiedSenior) return { org, person: verifiedSenior };

  const verified = people.find((p) => p.email_status === 'verified' && hasUsableEmail(p.email));
  if (verified) return { org, person: verified };

  // Fall back to the first person Apollo ranked. Email may be masked but
  // we still get name + title which is useful for the Outreach Agent.
  return { org, person: people[0]! };
}

const OWNER_TITLE_TOKENS = [
  'owner',
  'founder',
  'co-founder',
  'cofounder',
  'president',
  'ceo',
  'general manager',
  'managing partner',
  'principal',
  'proprietor',
];

function hasOwnerTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return OWNER_TITLE_TOKENS.some((t) => lower.includes(t));
}

const EDITOR_TITLE_TOKENS = [
  'editor',
  'editorial',
  'managing editor',
  'content',
  'contributor',
  'contributing',
  'writer',
  'staff writer',
  'columnist',
  'community manager',
  'blog',
  'features',
  'outreach',
];

function hasEditorTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const lower = title.toLowerCase();
  return EDITOR_TITLE_TOKENS.some((t) => lower.includes(t));
}

/**
 * Editor-tier variant of `findOwnerByDomain`. Used by Backlink Builder's
 * prospect mode to find an editor / content manager / contributor at a
 * media or blog domain to pitch a guest post to.
 *
 * Preference order:
 *   1. verified email + editor-style title
 *   2. verified email (any title)
 *   3. first person Apollo ranks (email may be masked)
 *
 * Returns null when Apollo has no record for the domain — caller should
 * skip this prospect rather than error.
 */
export async function findEditorByDomain(domain: string): Promise<{
  org: ApolloOrganization;
  person: ApolloPerson;
} | null> {
  const org = await enrichOrganization(domain);
  if (!org?.id) return null;
  const people = await getOrganizationTopPeople(org.id);
  if (people.length === 0) return null;

  const verifiedEditor = people.find(
    (p) =>
      p.email_status === 'verified' && hasEditorTitle(p.title) && hasUsableEmail(p.email),
  );
  if (verifiedEditor) return { org, person: verifiedEditor };

  const verified = people.find((p) => p.email_status === 'verified' && hasUsableEmail(p.email));
  if (verified) return { org, person: verified };

  return { org, person: people[0]! };
}

/** Apollo masks emails on cheaper plans — detect the placeholder. */
function hasUsableEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return !lower.includes('email_not_unlocked') && !lower.includes('domain.com');
}

/** Strip http(s)://, leading www., trailing path/query — Apollo wants bare host. */
function normalizeDomain(input: string): string | null {
  if (!input) return null;
  let s = input.trim();
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^www\./i, '');
  s = s.split('/')[0]?.split('?')[0]?.split('#')[0] ?? '';
  if (!s.includes('.')) return null;
  return s.toLowerCase();
}
