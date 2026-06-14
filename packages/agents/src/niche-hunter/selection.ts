/**
 * Validation-set selection with an exploration quota.
 *
 * A trade is "novel" when it has never appeared in `niches` (exact
 * lowercased string match against the surfaced set). ceil(n * quota) slots
 * go to the highest-ranked candidates of novel trades — at most one
 * candidate per novel trade, so the quota explores breadth rather than
 * stacking cities of one unproven trade. Remaining slots fill by EV rank;
 * a novel shortfall falls back to EV rank automatically.
 */
export function selectValidationSet<T extends { trade: string }>(
  ranked: T[],
  n: number,
  surfacedTrades: Set<string>,
  quota = 0.25,
): T[] {
  const target = Math.min(Math.max(0, n), ranked.length);
  if (target === 0) return [];

  const novelSlots = Math.ceil(target * Math.max(0, Math.min(1, quota)));
  const chosen = new Set<T>();

  const seenNovelTrades = new Set<string>();
  for (const c of ranked) {
    if (chosen.size >= novelSlots) break;
    const trade = c.trade.toLowerCase();
    if (surfacedTrades.has(trade) || seenNovelTrades.has(trade)) continue;
    seenNovelTrades.add(trade);
    chosen.add(c);
  }

  for (const c of ranked) {
    if (chosen.size >= target) break;
    chosen.add(c);
  }

  // Preserve EV-rank order in the returned set.
  return ranked.filter((c) => chosen.has(c));
}

export interface DiversityCaps {
  /** Max candidates persisted per trade. */
  maxPerTrade: number;
  /** Max candidates persisted per category. */
  maxPerCategory: number;
}

export interface DiversitySelection<T> {
  /** Chosen candidates, in the input's (score-desc) order. */
  selected: T[];
  /** Candidates dropped purely because a trade/category cap was already full. */
  excludedByCap: number;
}

/**
 * Diversity-capped top-N selection for the scout (ADR 0023).
 *
 * Walks the score-desc ranked grid greedily, admitting a cell only while its
 * trade and category are both below their caps. This preserves the value
 * ranking (higher-score cells are always considered first) while preventing a
 * single high-ticket trade or category from monopolizing the persisted set.
 *
 * Pass `maxPerCategory >= target` to disable the category cap (e.g. when the
 * run is already scoped to one category via category_filter — capping it there
 * would just starve an intentionally single-category run).
 *
 * Backfill guard: if the caps leave the set short of `target` (too few distinct
 * trades/categories clear the floor to fill it), capped-out cells are admitted
 * in score-desc order until `target` is reached. A tight cap thus never
 * persists fewer candidates than an uncapped run would — it only reorders which
 * cells fall inside the cut. `excludedByCap` counts cells the caps held back
 * that did NOT get backfilled (the true diversity effect).
 */
export function selectDiversified<T extends { trade: string; category: string }>(
  ranked: T[],
  target: number,
  caps: DiversityCaps,
): DiversitySelection<T> {
  const limit = Math.min(Math.max(0, target), ranked.length);
  if (limit === 0) return { selected: [], excludedByCap: 0 };

  const maxPerTrade = Math.max(1, caps.maxPerTrade);
  const maxPerCategory = Math.max(1, caps.maxPerCategory);

  const chosen = new Set<T>();
  const perTrade = new Map<string, number>();
  const perCategory = new Map<string, number>();
  const cappedOut: T[] = [];

  for (const c of ranked) {
    if (chosen.size >= limit) break;
    const tradeKey = c.trade.toLowerCase();
    const tradeCount = perTrade.get(tradeKey) ?? 0;
    const catCount = perCategory.get(c.category) ?? 0;
    if (tradeCount >= maxPerTrade || catCount >= maxPerCategory) {
      cappedOut.push(c);
      continue;
    }
    chosen.add(c);
    perTrade.set(tradeKey, tradeCount + 1);
    perCategory.set(c.category, catCount + 1);
  }

  // Backfill from capped-out cells (still score-desc) so a tight cap never
  // starves the candidate pool below what an uncapped run would persist.
  let backfilled = 0;
  if (chosen.size < limit) {
    for (const c of cappedOut) {
      if (chosen.size >= limit) break;
      chosen.add(c);
      backfilled++;
    }
  }

  return {
    // Preserve global score-desc order in the returned set.
    selected: ranked.filter((c) => chosen.has(c)),
    excludedByCap: cappedOut.length - backfilled,
  };
}
