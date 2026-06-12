import { z } from 'zod';
import { BaseAgent, type AgentContext } from '../base';
import { getKeywordCandidates } from '@leadlandlord/integrations/dataforseo';
import { SERVICE_TAXONOMY, CATEGORY_VALUES, type ServiceCategory } from './service-taxonomy';
import { isDenylisted } from './denylist';

/**
 * Niche Keyword Refresher — quarterly cluster-cache warm.
 *
 * Loops every taxonomy seed through getKeywordCandidates (90-day cache) so
 * scouts stay near-zero cost. Fully stale cost <= ~$12.52 (447 x $0.028);
 * ~$0 when the cache is warm. Idempotent on retry (hits skip the API).
 *
 * The scout also warms misses when warm_missing_clusters=true, so the system
 * self-heals without this agent — the refresher just keeps scouts cheap and
 * predictable.
 */

const CategoryEnum = z.enum(CATEGORY_VALUES);

export const KeywordRefreshInput = z.object({
  category_filter: CategoryEnum.optional(),
  concurrency: z.number().int().min(1).max(8).default(4),
});
export type KeywordRefreshInput = z.infer<typeof KeywordRefreshInput>;

export const KeywordRefreshOutput = z.object({
  seeds: z.number(),
  cache_hits: z.number(),
  fetched: z.number(),
  failed: z.number(),
  cost_usd: z.number(),
});
export type KeywordRefreshOutput = z.infer<typeof KeywordRefreshOutput>;

export function quarterKey(d: Date = new Date()): string {
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${d.getUTCFullYear()}-Q${q}`;
}

export class NicheKeywordRefresher extends BaseAgent<typeof KeywordRefreshInput, typeof KeywordRefreshOutput> {
  constructor() {
    super({
      name: 'niche-keyword-refresher',
      inputSchema: KeywordRefreshInput,
      outputSchema: KeywordRefreshOutput,
      defaultDailyCapUsd: 15,
      dedupeKeyFn: () => `niche-keyword-refresher:${quarterKey()}`,
    });
  }

  protected async execute(input: KeywordRefreshInput, ctx: AgentContext): Promise<KeywordRefreshOutput> {
    const categories: ServiceCategory[] = input.category_filter
      ? [input.category_filter]
      : [...CATEGORY_VALUES];
    const seeds = categories
      .flatMap((c) => SERVICE_TAXONOMY[c])
      .filter((t) => !isDenylisted(t));

    let cacheHits = 0;
    let fetched = 0;
    let failed = 0;
    let costUsd = 0;
    let done = 0;

    const queue = [...seeds];
    const worker = async () => {
      for (;;) {
        const seed = queue.shift();
        if (seed === undefined) return;
        try {
          let seedCost = 0;
          await getKeywordCandidates({
            seed,
            onCost: (usd) => {
              seedCost = usd;
              if (usd > 0) {
                costUsd += usd;
                ctx.recordUsage({ model: 'dataforseo', input_tokens: 0, output_tokens: 0, cost_usd: usd });
              }
            },
          });
          if (seedCost > 0) fetched++;
          else cacheHits++;
        } catch (err) {
          failed++;
          ctx.log.warn(
            { seed, err: err instanceof Error ? err.message : err },
            'niche-keyword-refresher: seed fetch failed, continuing',
          );
        }
        done++;
        if (done % 25 === 0 || done === seeds.length) {
          ctx.progress({ step: done, total: seeds.length, label: `refreshed ${done}/${seeds.length} seeds` });
        }
      }
    };
    // Concurrency 4 default => ~2.5 rps, comfortably under DataForSEO's
    // 10 rps ceiling, finishing 447 seeds in 2-4 minutes (inside the 900s
    // event lease).
    await Promise.all(Array.from({ length: input.concurrency }, worker));

    ctx.log.info({ seeds: seeds.length, cacheHits, fetched, failed, costUsd }, 'keyword refresh complete');
    return {
      seeds: seeds.length,
      cache_hits: cacheHits,
      fetched,
      failed,
      cost_usd: Number(costUsd.toFixed(4)),
    };
  }
}
