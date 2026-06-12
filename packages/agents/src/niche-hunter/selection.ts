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
