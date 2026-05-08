import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { BaseAgent, type AgentContext } from '../base';
import { getDb, sites, domainCandidates } from '@leadlandlord/db';
import { cloudflare } from '@leadlandlord/integrations';
import { IntegrationError } from '@leadlandlord/shared/errors';

/**
 * Domain Procurer (Phase A2).
 *
 * Two modes routed by `action`:
 *  - 'search'   → call Cloudflare availability for ~10 generated candidates,
 *                 persist top-N into `domain_candidates` as 'pending_approval'
 *                 (operator must explicitly approve a row before we register —
 *                 registration spends real money).
 *  - 'register' → require an 'approved' candidate row, register via the
 *                 Cloudflare Registrar API, add the zone, and create apex +
 *                 wildcard CNAMEs to `cname.vercel-dns.com`. Updates
 *                 `sites.domain` and the candidate row to `registered`.
 *
 * Payload shape uses snake_case to match the events emitted by
 * `apps/operator/app/operator/sites/[id]/domain-actions.ts` (the dispatcher
 * forwards `ev.payload` to `agent.run` verbatim).
 */
export const DomainProcurerInput = z
  .object({
    site_id: z.string().uuid(),
    action: z.enum(['search', 'register']),
    candidate_id: z.string().uuid().optional(),
    top_n: z.number().int().positive().default(5),
  })
  .passthrough(); // operator emits a few extra fields (niche/city/state/registrar/human_approved) we don't need.

export const DomainProcurerOutput = z.object({
  action: z.enum(['search', 'register']),
  site_id: z.string().uuid(),
  candidates_written: z.number().int().nonnegative().optional(),
  registered_domain: z.string().optional(),
  zone_id: z.string().optional(),
});

type Input = z.infer<typeof DomainProcurerInput>;
type Output = z.infer<typeof DomainProcurerOutput>;

export class DomainProcurer extends BaseAgent<typeof DomainProcurerInput, typeof DomainProcurerOutput> {
  constructor() {
    super({
      name: 'domain-procurer',
      inputSchema: DomainProcurerInput,
      outputSchema: DomainProcurerOutput,
      // Dedupe semantics:
      //  - search: one search per site per UTC day. Re-clicks during the day
      //    return the cached result (no point re-paying availability checks
      //    for ten domains every time). Tomorrow's run is a fresh key.
      //  - register: one registration per candidate, ever. Cloudflare would
      //    reject a duplicate anyway, but this caches the success so a duped
      //    event doesn't re-run the API path.
      // Per base.ts incident note (5/7): we MUST NOT let the dispatcher's
      // eventId override these — and it can't, because dedupeKeyFn always
      // wins over opts.eventId in BaseAgent.run.
      dedupeKeyFn: (input) => {
        if (input.action === 'search') {
          const day = new Date().toISOString().slice(0, 10);
          return `search:${input.site_id}:${day}`;
        }
        if (input.action === 'register') {
          if (!input.candidate_id) return undefined;
          return `register:${input.candidate_id}`;
        }
        return undefined;
      },
      // Domain registration is up to ~$15 each. Cap prevents runaway loops
      // from emptying the registrar wallet. Search is essentially free
      // (availability lookups are not billed) so the cap is mostly a
      // register-mode guard.
      defaultDailyCapUsd: 100,
    });
  }

  protected async execute(input: Input, ctx: AgentContext): Promise<Output> {
    if (input.action === 'search') return this.runSearch(input, ctx);
    return this.runRegister(input, ctx);
  }

  // ─────────────────────────────────────────────────────────────────────
  // search mode
  // ─────────────────────────────────────────────────────────────────────
  private async runSearch(input: Input, ctx: AgentContext): Promise<Output> {
    const db = getDb();
    const site = (await db.select().from(sites).where(eq(sites.id, input.site_id)).limit(1))[0];
    if (!site) {
      throw new IntegrationError('domain-procurer', `site not found: ${input.site_id}`);
    }

    ctx.progress({ label: `searching domains for ${site.niche} / ${site.city}` });

    const found = await cloudflare.searchDomains({
      niche: site.niche,
      city: site.city,
      state: site.state,
      topN: input.top_n,
    });

    if (found.length === 0) {
      ctx.log.warn({ site_id: input.site_id }, 'no available candidates returned');
      ctx.progress({ label: 'no available candidates' });
      return { action: 'search', site_id: input.site_id, candidates_written: 0 };
    }

    // Bulk insert with ON CONFLICT (site_id, domain) DO NOTHING so re-runs are
    // idempotent without clobbering rows that have already been approved or
    // registered (status transitions only happen via the operator approval
    // path / register mode — we never want a re-search to flip a row backwards).
    const rows = found.map((c) => ({
      siteId: input.site_id,
      domain: c.domain,
      registrar: 'cloudflare',
      priceUsd: c.priceUsd != null ? c.priceUsd.toFixed(2) : null,
      tld: extractTld(c.domain),
      matchType: c.matchType,
      rank: c.rank,
      status: 'pending_approval' as const,
    }));

    const inserted = await db
      .insert(domainCandidates)
      .values(rows)
      .onConflictDoNothing({ target: [domainCandidates.siteId, domainCandidates.domain] })
      .returning({ id: domainCandidates.id });

    const written = inserted.length;
    ctx.progress({ label: `found ${found.length} candidates (${written} new)` });
    ctx.log.info(
      { site_id: input.site_id, found: found.length, inserted: written },
      'domain candidates written',
    );

    return { action: 'search', site_id: input.site_id, candidates_written: written };
  }

  // ─────────────────────────────────────────────────────────────────────
  // register mode
  // ─────────────────────────────────────────────────────────────────────
  private async runRegister(input: Input, ctx: AgentContext): Promise<Output> {
    if (!input.candidate_id) {
      throw new IntegrationError(
        'domain-procurer',
        'candidate_id required for action=register',
      );
    }

    const db = getDb();
    const candidate = (
      await db
        .select()
        .from(domainCandidates)
        .where(
          and(
            eq(domainCandidates.id, input.candidate_id),
            eq(domainCandidates.siteId, input.site_id),
          ),
        )
        .limit(1)
    )[0];
    if (!candidate) {
      throw new IntegrationError(
        'domain-procurer',
        `candidate not found: ${input.candidate_id}`,
      );
    }
    if (candidate.status !== 'approved') {
      throw new IntegrationError(
        'domain-procurer',
        `candidate not approved by operator (status=${candidate.status})`,
      );
    }

    const domain = candidate.domain;
    ctx.progress({ label: `registering ${domain}` });

    // Register the domain. Cloudflare integration pulls registrant contact
    // from CLOUDFLARE_REGISTRANT_* env by default. Wrap in try/catch so we
    // surface the underlying API error (status, body) on the run row rather
    // than letting a raw fetch error bubble up.
    let registered: cloudflare.RegisterDomainResult;
    try {
      registered = await cloudflare.registerDomain({ domain });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new IntegrationError(
        'domain-procurer',
        `registerDomain failed for ${domain}: ${msg}`,
        err instanceof IntegrationError ? err.status : undefined,
        err instanceof IntegrationError ? err.body : undefined,
      );
    }

    ctx.progress({ label: `domain registered, configuring DNS` });

    // registerDomain already calls addZone internally and returns zoneId, but
    // in dev/mock the zoneId may be `mock-zone-...` — call addZone explicitly
    // here so prod behaviour matches what the brief specifies (defensive: if
    // the integration ever splits these, this path still works).
    let zoneId = registered.zoneId;
    if (!zoneId) {
      const zone = await cloudflare.addZone(domain);
      zoneId = zone.zoneId;
    }

    await cloudflare.createApexAndWildcardRecords({ zoneId });

    // Persist on the site row + flip candidate status.
    const now = new Date();
    await db
      .update(sites)
      .set({ domain, updatedAt: now })
      .where(eq(sites.id, input.site_id));

    await db
      .update(domainCandidates)
      .set({ status: 'registered', registeredAt: registered.registeredAt ?? now })
      .where(eq(domainCandidates.id, input.candidate_id));

    // TODO(phase-A): site-builder currently does not handle `domain.registered`
    // — it should pick this up to (a) update the Sanity site doc's domain field
    // and (b) attach the domain to the Vercel project's domain list. For now we
    // emit the event so the wiring is in place; site-builder will gain a
    // handler in a follow-up commit.
    await ctx.emitNextStepEvent({
      type: 'domain.registered',
      targetAgent: 'site-builder',
      payload: {
        site_id: input.site_id,
        domain,
        zone_id: zoneId,
      },
    });

    ctx.progress({ label: `registered ${domain}` });
    ctx.log.info(
      { site_id: input.site_id, domain, zone_id: zoneId },
      'domain registered + DNS configured',
    );

    return {
      action: 'register',
      site_id: input.site_id,
      registered_domain: domain,
      zone_id: zoneId,
    };
  }
}

function extractTld(domain: string): string | null {
  const i = domain.lastIndexOf('.');
  return i === -1 ? null : domain.slice(i);
}
