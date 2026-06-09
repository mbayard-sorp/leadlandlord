/**
 * Citation Runner v1
 *
 * Manages local citation / directory listing seeds for a single live site.
 *
 * Phase 4 honest scope:
 *  1. Seed: for each directory in the checklist with no existing backlinks row for
 *     this site, insert a pending row (idempotent via dedupeKey partial unique index).
 *  2. Verify: for pending/submitted rows older than 1 day where the operator has
 *     pasted a profileUrl into metadata, fetch the page via Firecrawl and check
 *     whether the site's business name or phone appears; if so, flip to live.
 *     Capped at 10 verifications per run (Firecrawl cost ≈ $0.005/call).
 *
 * No LLM calls — cost = Firecrawl only (capped at $0.05/run by the 10-call limit).
 *
 * Directory list: DEFAULT_DIRECTORIES below. Move to Sanity niche doc when the
 * operator UI supports it (TODO: add `directories` array to niche/site doc in
 * packages/sanity-schema).
 */

import { z } from 'zod';
import { eq, and, or, lt, isNotNull, sql } from 'drizzle-orm';
import { getDb, sites, backlinks } from '@leadlandlord/db';
import { BaseAgent, type AgentContext } from '../base';

// ────────────────────────────────────────────────────────────
// Directory catalogue
// ────────────────────────────────────────────────────────────

export interface DirectoryEntry {
  name: string;
  domain: string;
  submitUrl: string;
  type: 'citation' | 'directory';
}

/**
 * National citation / directory baseline. The operator submits each listing
 * manually (or via a VA) and pastes the resulting profile URL into
 * metadata.profileUrl so the verification pass can confirm it.
 *
 * TODO: move this list to a Sanity niche-level or site-level doc field so it
 * can be overridden per vertical without a code deploy.
 */
export const DEFAULT_DIRECTORIES: DirectoryEntry[] = [
  { name: 'Yelp', domain: 'yelp.com', submitUrl: 'https://biz.yelp.com/signup', type: 'citation' },
  { name: 'BBB', domain: 'bbb.org', submitUrl: 'https://www.bbb.org/get-accredited', type: 'citation' },
  { name: 'Angi', domain: 'angi.com', submitUrl: 'https://www.angi.com/pro-signup/', type: 'directory' },
  { name: 'Thumbtack', domain: 'thumbtack.com', submitUrl: 'https://www.thumbtack.com/pro/', type: 'directory' },
  { name: 'HomeAdvisor', domain: 'homeadvisor.com', submitUrl: 'https://pro.homeadvisor.com/', type: 'directory' },
  { name: 'Houzz', domain: 'houzz.com', submitUrl: 'https://www.houzz.com/pro/signup', type: 'directory' },
  { name: 'Yellow Pages', domain: 'yellowpages.com', submitUrl: 'https://www.yellowpages.com/advertise', type: 'citation' },
  { name: 'Foursquare', domain: 'foursquare.com', submitUrl: 'https://business.foursquare.com/', type: 'citation' },
  { name: 'Manta', domain: 'manta.com', submitUrl: 'https://www.manta.com/claim', type: 'citation' },
  { name: 'Hotfrog', domain: 'hotfrog.com', submitUrl: 'https://www.hotfrog.com/AddBusiness.aspx', type: 'citation' },
  { name: 'Chamber of Commerce', domain: 'chamberofcommerce.com', submitUrl: 'https://www.chamberofcommerce.com/add-listing', type: 'citation' },
  { name: 'Nextdoor', domain: 'nextdoor.com', submitUrl: 'https://business.nextdoor.com/', type: 'citation' },
  { name: 'Alignable', domain: 'alignable.com', submitUrl: 'https://www.alignable.com/signup', type: 'citation' },
  { name: 'Porch', domain: 'porch.com', submitUrl: 'https://pro.porch.com/pro-signup', type: 'directory' },
  { name: 'Bing Places', domain: 'bingplaces.com', submitUrl: 'https://www.bingplaces.com/', type: 'citation' },
  { name: 'Apple Maps', domain: 'mapsconnect.apple.com', submitUrl: 'https://mapsconnect.apple.com/', type: 'citation' },
];

/** Build the dedupeKey for a citation row. */
export function citationDedupeKey(siteId: string, directoryDomain: string): string {
  return `citation:${siteId}:${directoryDomain}`;
}

// ────────────────────────────────────────────────────────────
// Schema
// ────────────────────────────────────────────────────────────

export const CitationRunnerInput = z.object({
  siteId: z.string().uuid(),
});
export type CitationRunnerInput = z.infer<typeof CitationRunnerInput>;

export const CitationRunnerOutput = z.object({
  siteId: z.string().uuid(),
  /** Site was not live — run was a graceful no-op. */
  skipped: z.boolean(),
  /** Number of new citation rows inserted (pending). */
  seeded: z.number().int().nonnegative(),
  /** Number of rows that were already seeded (idempotent check). */
  alreadySeeded: z.number().int().nonnegative(),
  /** Number of rows verified live this run. */
  verified: z.number().int().nonnegative(),
  /** Number of rows checked but not yet confirmed live. */
  verificationsPending: z.number().int().nonnegative(),
});
export type CitationRunnerOutput = z.infer<typeof CitationRunnerOutput>;

// ────────────────────────────────────────────────────────────
// NAP verification (inline — avoids touching firecrawl/index.ts)
// ────────────────────────────────────────────────────────────

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v1';

interface NapCheckResult {
  found: boolean;
  /** True if the scrape request succeeded (regardless of NAP match). */
  scraped: boolean;
}

/**
 * Fetch the given profileUrl via Firecrawl and check whether the site's
 * business name or phone number appears in the scraped markdown.
 *
 * Returns { found: false, scraped: false } on any network/API failure so
 * callers never throw. The 5 000-char cap keeps Firecrawl cost minimal.
 */
export async function checkNapPresence(
  profileUrl: string,
  businessName: string,
  phone: string,
): Promise<NapCheckResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    // No key — skip silently (AGENT_REQUIRED_ENV lists it as optional for now).
    return { found: false, scraped: false };
  }
  try {
    const res = await fetch(`${FIRECRAWL_BASE}/scrape`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: profileUrl,
        formats: ['markdown'],
        onlyMainContent: true,
        timeout: 15000,
      }),
    });
    if (!res.ok) return { found: false, scraped: false };
    const json = (await res.json()) as { success?: boolean; data?: { markdown?: string } };
    if (!json.success || !json.data?.markdown) return { found: false, scraped: false };

    const text = json.data.markdown.slice(0, 5000).toLowerCase();
    const nameNeedle = businessName.toLowerCase().trim();
    const phoneDigits = phone.replace(/\D/g, '');

    const found =
      (nameNeedle.length > 2 && text.includes(nameNeedle)) ||
      (phoneDigits.length >= 7 && text.includes(phoneDigits));

    return { found, scraped: true };
  } catch {
    return { found: false, scraped: false };
  }
}

// ────────────────────────────────────────────────────────────
// Agent
// ────────────────────────────────────────────────────────────

export class CitationRunner extends BaseAgent<
  typeof CitationRunnerInput,
  typeof CitationRunnerOutput
> {
  constructor() {
    super({
      name: 'citation-runner',
      inputSchema: CitationRunnerInput,
      outputSchema: CitationRunnerOutput,
      defaultDailyCapUsd: 1,
      dedupeKeyFn: (input) => {
        // Week-scoped so re-triggering within the same ISO week is a no-op.
        const now = new Date();
        const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
        const dayOfYear = Math.floor((now.getTime() - startOfYear.getTime()) / 86_400_000);
        const week = String(Math.ceil((dayOfYear + 1) / 7)).padStart(2, '0');
        const yearWeek = `${now.getUTCFullYear()}-W${week}`;
        return `citation-runner:${input.siteId}:${yearWeek}`;
      },
    });
  }

  protected async execute(
    input: CitationRunnerInput,
    ctx: AgentContext,
  ): Promise<CitationRunnerOutput> {
    const db = getDb();

    // ── Guard: site must be live ──
    const [site] = await db.select().from(sites).where(eq(sites.id, input.siteId)).limit(1);
    if (!site) {
      ctx.log.warn({ siteId: input.siteId }, 'citation-runner: site not found — skipping');
      return {
        siteId: input.siteId,
        skipped: true,
        seeded: 0,
        alreadySeeded: 0,
        verified: 0,
        verificationsPending: 0,
      };
    }
    if (site.status !== 'live') {
      ctx.log.info(
        { siteId: input.siteId, status: site.status },
        'citation-runner: site not live — skipping',
      );
      return {
        siteId: input.siteId,
        skipped: true,
        seeded: 0,
        alreadySeeded: 0,
        verified: 0,
        verificationsPending: 0,
      };
    }

    // ── Phase 1: Seed ──
    // Fetch existing citation/directory rows for this site so we can diff
    // against DEFAULT_DIRECTORIES without relying on partial unique index
    // alone (onConflictDoNothing needs the index but we also want counts).
    const existingRows = await db
      .select({ dedupeKey: backlinks.dedupeKey })
      .from(backlinks)
      .where(
        and(
          eq(backlinks.siteId, input.siteId),
          or(eq(backlinks.type, 'citation'), eq(backlinks.type, 'directory')),
        ),
      );

    const existingKeys = new Set(existingRows.map((r) => r.dedupeKey).filter(Boolean) as string[]);

    let seeded = 0;
    let alreadySeeded = 0;

    for (const dir of DEFAULT_DIRECTORIES) {
      const key = citationDedupeKey(input.siteId, dir.domain);
      if (existingKeys.has(key)) {
        alreadySeeded++;
        continue;
      }
      // Insert via onConflictDoNothing as a belt-and-suspenders idempotency
      // guard against the partial unique index on dedupeKey.
      await db
        .insert(backlinks)
        .values({
          siteId: input.siteId,
          sourceDomain: dir.domain,
          type: dir.type,
          status: 'pending',
          dedupeKey: key,
          metadata: { submitUrl: dir.submitUrl, directoryName: dir.name },
        })
        .onConflictDoNothing();
      seeded++;
      ctx.log.info({ siteId: input.siteId, directory: dir.name }, 'citation-runner: seeded');
    }

    ctx.progress({ label: `seeded ${seeded} citation(s), checking verifications` });

    // ── Phase 2: Verification pass ──
    // Only verify rows where metadata.profileUrl is set (operator pasted it
    // after manually submitting the listing). Cap at 10 per run.
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const pendingRows = await db
      .select({
        id: backlinks.id,
        sourceDomain: backlinks.sourceDomain,
        status: backlinks.status,
        metadata: backlinks.metadata,
        createdAt: backlinks.createdAt,
      })
      .from(backlinks)
      .where(
        and(
          eq(backlinks.siteId, input.siteId),
          or(eq(backlinks.status, 'pending'), eq(backlinks.status, 'submitted')),
          or(eq(backlinks.type, 'citation'), eq(backlinks.type, 'directory')),
          lt(backlinks.createdAt, oneDayAgo),
          isNotNull(backlinks.metadata),
        ),
      )
      .limit(10);

    // Filter to rows where metadata.profileUrl is a non-empty string.
    const verifiable = pendingRows.filter((r) => {
      const meta = r.metadata as Record<string, unknown> | null;
      return typeof meta?.profileUrl === 'string' && meta.profileUrl.length > 0;
    });

    const businessName = [site.niche, site.city].filter(Boolean).join(' ');
    const phone = site.trackingNumber ?? '';

    let verified = 0;
    let verificationsPending = 0;

    for (const row of verifiable) {
      const meta = row.metadata as Record<string, unknown>;
      const profileUrl = meta.profileUrl as string;

      ctx.log.info(
        { siteId: input.siteId, domain: row.sourceDomain, profileUrl },
        'citation-runner: checking NAP presence',
      );

      const result = await checkNapPresence(profileUrl, businessName, phone);

      if (result.found) {
        await db
          .update(backlinks)
          .set({
            status: 'live',
            acquiredAt: new Date(),
            metadata: sql`${backlinks.metadata} || '{"napVerified": true}'::jsonb`,
          })
          .where(eq(backlinks.id, row.id));
        verified++;
        ctx.log.info(
          { siteId: input.siteId, domain: row.sourceDomain },
          'citation-runner: NAP confirmed live',
        );
      } else if (result.scraped) {
        // Scraped successfully but NAP not found yet — still pending.
        verificationsPending++;
        ctx.log.info(
          { siteId: input.siteId, domain: row.sourceDomain },
          'citation-runner: scraped but NAP not found yet',
        );
      }
      // If !scraped, Firecrawl failed — treat as pending, retry next week.
    }

    return {
      siteId: input.siteId,
      skipped: false,
      seeded,
      alreadySeeded,
      verified,
      verificationsPending,
    };
  }
}
