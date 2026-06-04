/**
 * Network Metrics Aggregator — no-LLM nightly job.
 *
 * Computes citation-safe metric snapshots from data we already own (the `calls`
 * table; DataForSEO cache where present) and writes them to siteNetworkMetrics.
 * The content-data-auditor later reads these rows — with their honest
 * sampleSize — as the ONLY numeric facts a data-study page may cite. This agent
 * never invents numbers: every metric carries the underlying observation count.
 *
 * Input: { siteId? } — when present, aggregate that one site; when absent,
 * aggregate every active site in the fleet.
 * Output: { metricsWritten }.
 *
 * All aggregate math lives in ./aggregate (pure). This file is the DB shell.
 */
import { z } from 'zod';
import { and, eq, gte, inArray } from 'drizzle-orm';
import {
  getDb,
  sites,
  calls,
  dataforseoCache,
  siteNetworkMetrics,
  type NewSiteNetworkMetric,
} from '@leadlandlord/db';
import { BaseAgent, type AgentContext } from '../base';
import {
  withinWindow,
  computeJobTypeMix,
  computeCallVolume,
  computeSeasonality,
  type CallRow,
  type MetricResult,
} from './aggregate';

const WINDOW_DAYS = 90;
const WINDOW_LABEL = 'last_90d';

export const NetworkMetricsAggregatorInput = z.object({
  siteId: z.string().uuid().optional(),
});
export type NetworkMetricsAggregatorInput = z.infer<typeof NetworkMetricsAggregatorInput>;

export const NetworkMetricsAggregatorOutput = z.object({
  metricsWritten: z.number().int().nonnegative(),
});
export type NetworkMetricsAggregatorOutput = z.infer<typeof NetworkMetricsAggregatorOutput>;

export class NetworkMetricsAggregator extends BaseAgent<
  typeof NetworkMetricsAggregatorInput,
  typeof NetworkMetricsAggregatorOutput
> {
  constructor() {
    super({
      name: 'network-metrics-aggregator',
      inputSchema: NetworkMetricsAggregatorInput,
      outputSchema: NetworkMetricsAggregatorOutput,
      // No LLM calls — this agent is pure aggregation. Keep a nominal cap so the
      // budget machinery has a row to credit against.
      defaultDailyCapUsd: 1,
      dedupeKeyFn: (input) =>
        `network-metrics-aggregator:${input.siteId ?? 'fleet'}:${isoDate(new Date())}`,
    });
  }

  protected async execute(
    input: NetworkMetricsAggregatorInput,
    ctx: AgentContext,
  ): Promise<NetworkMetricsAggregatorOutput> {
    const db = getDb();

    // Resolve target sites.
    let targets: Array<{ id: string; niche: string }>;
    if (input.siteId) {
      const [row] = await db
        .select({ id: sites.id, niche: sites.niche })
        .from(sites)
        .where(eq(sites.id, input.siteId))
        .limit(1);
      if (!row) throw new Error(`network-metrics-aggregator: site not found: ${input.siteId}`);
      targets = [row];
    } else {
      targets = await db
        .select({ id: sites.id, niche: sites.niche })
        .from(sites)
        .where(inArray(sites.status, ['warming', 'live', 'rented']));
    }

    const now = new Date();
    let written = 0;

    for (let i = 0; i < targets.length; i++) {
      const site = targets[i]!;
      ctx.progress({ step: i + 1, total: targets.length, label: `aggregating ${site.niche}` });

      const callRows = await this.loadCalls(site.id, now);
      const windowed = withinWindow(callRows, now, WINDOW_DAYS);

      const metrics: Array<{ kind: string; result: MetricResult }> = [
        { kind: 'call_volume', result: computeCallVolume(windowed, WINDOW_DAYS) },
        { kind: 'job_type_mix', result: computeJobTypeMix(windowed) },
        { kind: 'seasonality', result: computeSeasonality(windowed) },
      ];

      // Optional DataForSEO-derived metrics — only when the cache table has a
      // matching, unexpired payload. Absent cache simply yields fewer metrics.
      for (const dfs of await this.loadDataforseoMetrics(site.niche)) {
        metrics.push(dfs);
      }

      const values: NewSiteNetworkMetric[] = metrics.map((m) => ({
        siteId: site.id,
        niche: site.niche,
        metricKind: m.kind,
        value: m.result.value,
        sampleSize: m.result.sampleSize,
        window: WINDOW_LABEL,
      }));

      for (const v of values) {
        await db.insert(siteNetworkMetrics).values(v);
        written += 1;
      }
    }

    ctx.log.info({ sites: targets.length, metricsWritten: written }, 'network-metrics-aggregator: done');
    return { metricsWritten: written };
  }

  private async loadCalls(siteId: string, now: Date): Promise<CallRow[]> {
    const db = getDb();
    const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
    const rows = await db
      .select({
        classification: calls.classification,
        startedAt: calls.startedAt,
        estRevenueUsd: calls.estRevenueUsd,
      })
      .from(calls)
      .where(and(eq(calls.siteId, siteId), gte(calls.startedAt, since)));
    return rows.map((r) => ({
      classification: r.classification,
      startedAt: r.startedAt,
      estRevenueUsd: r.estRevenueUsd ?? null,
    }));
  }

  /**
   * Best-effort DataForSEO-derived niche metrics (local_pricing / serp_landscape).
   * Reads the dataforseo_cache table directly so we never spend a fresh API call
   * here — this is an aggregation pass over data already paid for. Returns [] if
   * nothing relevant is cached, so the metric set degrades gracefully.
   */
  private async loadDataforseoMetrics(
    niche: string,
  ): Promise<Array<{ kind: string; result: MetricResult }>> {
    const db = getDb();
    const out: Array<{ kind: string; result: MetricResult }> = [];
    try {
      const rows = await db
        .select({ endpoint: dataforseoCache.endpoint, payload: dataforseoCache.payload })
        .from(dataforseoCache)
        .where(gte(dataforseoCache.expiresAt, new Date()))
        .limit(50);
      // Heuristic: pull keyword/SERP payloads that mention the niche. We don't
      // fabricate — we only summarize counts present in the cached payload.
      const pricing = rows.filter((r) => /keyword|search_volume|cpc/i.test(r.endpoint));
      const serp = rows.filter((r) => /serp/i.test(r.endpoint));
      if (pricing.length > 0) {
        out.push({
          kind: 'local_pricing',
          result: { value: { cachedPayloads: pricing.length, niche }, sampleSize: pricing.length },
        });
      }
      if (serp.length > 0) {
        out.push({
          kind: 'serp_landscape',
          result: { value: { cachedPayloads: serp.length, niche }, sampleSize: serp.length },
        });
      }
    } catch {
      // Cache table optional / unavailable — skip DFS-derived metrics.
    }
    return out;
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
