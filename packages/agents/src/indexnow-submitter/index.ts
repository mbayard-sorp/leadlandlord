import { randomBytes, createHash } from 'node:crypto';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, sites, agentApprovals } from '@leadlandlord/db';
import { createWriteClient, siteDocId } from '@leadlandlord/integrations/sanity';
import { submitUrls } from '@leadlandlord/integrations/indexnow';
import { IntegrationError } from '@leadlandlord/shared/errors';

/**
 * IndexNow Submitter — pings Bing + Brave (via the IndexNow protocol) when a
 * site goes live or its content changes, so freshly-published URLs enter the
 * indexes that Claude web search (Brave) and ChatGPT search (Bing) retrieve
 * from. This is what makes a new tenant site eligible to surface in LLM answers
 * without waiting on organic crawl discovery.
 *
 * Triggered by two event types, both dispatched with `payload.site_id`:
 *   - `site.activated`       — full submission; URL set is read from the live sitemap.
 *   - `site.content.updated` — delta submission; URL set is supplied in `payload.urls`.
 *
 * The per-site IndexNow key lives on the Sanity site doc (`indexnowKey`) so the
 * site-host renderer can serve it at `/{key}.txt` for ownership verification.
 * It's generated here on first run if absent. Per-site (never shared) keys keep
 * the tenant domains unlinkable in IndexNow's public submission log.
 *
 * No approval gate: the authorizing human decision is the operator clicking
 * "promote to live" (a gated checklist). The submission is recorded as an
 * auto-approved `agent_approvals` row for the audit trail, matching how GSC
 * sitemap submission is treated (a notification, not a content mutation).
 */

export const IndexNowSubmitterInput = z.object({
  site_id: z.string().uuid(),
  /** Delta URLs for `site.content.updated`. When absent, the live sitemap is used. */
  urls: z.array(z.string().url()).optional(),
});

export const IndexNowSubmitterOutput = z.object({
  siteId: z.string().uuid(),
  host: z.string().nullable(),
  submitted: z.number().int(),
  statusCode: z.number().int(),
  status: z.enum(['submitted', 'rejected', 'skipped_no_domain']),
});

const LOC_RE = /<loc>([^<]+)<\/loc>/g;

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

/** Fetch + parse the live sitemap into an absolute-URL list. Empty on any failure. */
async function fetchSitemapUrls(host: string): Promise<string[]> {
  try {
    const res = await fetch(`https://${host}/sitemap.xml`, {
      headers: { Accept: 'application/xml,text/xml' },
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return [...xml.matchAll(LOC_RE)].map((m) => m[1]!.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export class IndexNowSubmitter extends BaseAgent<
  typeof IndexNowSubmitterInput,
  typeof IndexNowSubmitterOutput
> {
  constructor() {
    super({
      name: 'indexnow-submitter',
      inputSchema: IndexNowSubmitterInput,
      outputSchema: IndexNowSubmitterOutput,
      defaultDailyCapUsd: 1,
      // Activation submits once per site (idempotent). Delta submissions key on
      // the URL set so distinct changes re-submit while duplicate re-emits of
      // the same change collapse via findExistingSuccess.
      dedupeKeyFn: (input) =>
        input.urls && input.urls.length > 0
          ? `indexnow:delta:${input.site_id}:${shortHash([...input.urls].sort().join('|'))}`
          : `indexnow:activated:${input.site_id}`,
    });
  }

  protected async execute(
    input: z.infer<typeof IndexNowSubmitterInput>,
    ctx: AgentContext,
  ): Promise<z.infer<typeof IndexNowSubmitterOutput>> {
    const db = getDb();
    const siteRow = (await db.select().from(sites).where(eq(sites.id, input.site_id)).limit(1))[0];
    if (!siteRow) {
      throw new IntegrationError('indexnow', `site not found: ${input.site_id}`);
    }

    // Read the Sanity site doc for the key + attached domains.
    const sanity = createWriteClient();
    const docId = siteDocId(input.site_id);
    const doc = await sanity.fetch<{
      indexnowKey?: string | null;
      domains?: Array<{ host?: string | null; isPrimary?: boolean | null }> | null;
    } | null>(`*[_id == $id][0]{ indexnowKey, "domains": domains[]{ host, isPrimary } }`, {
      id: docId,
    });

    // Resolve the host: Postgres domain wins, else the Sanity primary domain.
    const sanityDomains = doc?.domains ?? [];
    const primaryFromSanity =
      sanityDomains.find((d) => d.isPrimary)?.host ?? sanityDomains[0]?.host ?? null;
    const host = siteRow.domain ?? primaryFromSanity;
    if (!host) {
      ctx.log.warn({ siteId: input.site_id }, 'indexnow: no domain attached — skipping');
      return { siteId: input.site_id, host: null, submitted: 0, statusCode: 0, status: 'skipped_no_domain' };
    }

    // Ensure a per-site key exists, generating + persisting to Sanity on first run.
    let key = doc?.indexnowKey ?? null;
    if (!key) {
      key = randomBytes(16).toString('hex'); // 32 hex chars; matches the proxy /{key}.txt route
      await sanity.patch(docId).set({ indexnowKey: key }).commit();
      ctx.log.info({ siteId: input.site_id }, 'indexnow: generated + persisted new key');
    }

    // Determine the URL set: explicit delta, else the live sitemap, else the home page.
    let urls = input.urls ?? [];
    if (urls.length === 0) {
      urls = await fetchSitemapUrls(host);
      if (urls.length === 0) urls = [`https://${host}/`];
    }

    ctx.progress({ label: `submitting ${urls.length} URLs to IndexNow` });
    const result = await submitUrls({ host, key, urls });

    // Transient failure — throw so the queue reaper retries with backoff. No
    // audit row is written on retry so attempts don't accumulate duplicates.
    if (!result.ok && result.retryable) {
      throw new IntegrationError(
        'indexnow',
        `submit failed (retryable): ${result.statusCode} for ${host}`,
      );
    }

    const status = result.ok ? 'submitted' : 'rejected';

    // Audit trail: auto-approved record of the submission (see class doc).
    await db.insert(agentApprovals).values({
      agentRunId: ctx.runId,
      kind: 'indexnow_submit',
      payload: { site_id: input.site_id, host, urlCount: result.submitted, statusCode: result.statusCode, status },
      status: 'auto_approved',
      decidedBy: 'policy:indexnow_auto',
      decidedAt: new Date(),
    });

    ctx.log.info(
      { siteId: input.site_id, host, submitted: result.submitted, statusCode: result.statusCode, status },
      'indexnow submission complete',
    );

    return {
      siteId: input.site_id,
      host,
      submitted: result.submitted,
      statusCode: result.statusCode,
      status,
    };
  }
}
