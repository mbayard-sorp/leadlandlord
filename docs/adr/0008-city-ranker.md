# ADR 0008 — City Ranker: Scoring Algorithm for Rank-and-Rent Market Selection

**Date:** 2026-05-18  
**Status:** Accepted  
**Author:** Architect

---

## Context

Niche Hunter currently samples 150 cities at random from a population-filtered list before handing them to Claude. Random sampling wastes DataForSEO budget on cities that are poor rank-and-rent targets (too large, too poor, suburban SERP bleed). We need a deterministic, niche-agnostic city score so that the 150-city pool — and downstream the 3–5 final picks — skews toward markets where (a) local SEO wins quickly and (b) homeowners have budget to buy services.

No new external data sources. All signals derive from data already in repo: SimpleMaps `uscities.csv` (population, lat, lng, county) and Census ACS enrichment (medianIncome, medianHomeValue, ownerOccupiedPct, totalHousingUnits, medianAge).

---

## Signals and Rationale

### S1 — Owner-Occupancy Rate (weight 0.25)

`ownerOccupiedPct` (0–1). Homeowners buy home services; renters don't. This is the strongest single predictor of serviceable demand. Cities with <0.55 OO rate are filtered out entirely (see Hard Filters below).

Sub-score: `ownerOccupiedPct` normalized to [0, 1] by clamp to [0.55, 0.85] range, then linear rescale.

### S2 — Market Wealth (weight 0.20)

Weighted average of two Census proxies:

```
wealthSub = 0.6 * norm(medianIncome, 45000, 100000)
           + 0.4 * norm(medianHomeValue, 150000, 500000)
```

`norm(x, lo, hi) = clamp((x - lo) / (hi - lo), 0, 1)`

Rationale: income predicts ability to pay per-job; home value predicts willingness to invest in the property. Neither alone is sufficient — high-income renters (college towns) score badly on S1 anyway.

### S3 — Housing Unit Count (weight 0.20)

`totalHousingUnits` is a better proxy for serviceable demand than raw population. A suburb with 18,000 housing units but 45,000 people has dense housing stock (apartments) — lower OO rate will suppress S1. A rural town with 12,000 housing units but only 28,000 people signals detached single-family homes.

Sub-score log-scaled to avoid mega-cities dominating:

```
housingUnitSub = min(1, log10(max(1, totalHousingUnits)) / log10(35000))
```

### S4 — Population Band Fit (weight 0.15)

Hard filter handles extremes (see below). Within the surviving band, reward cities in the 25,000–80,000 range where local SEO beats national directories:

```
popSub = norm(populationCensus, 20000, 80000) if pop <= 80000
       = norm(110000 - populationCensus, 0, 30000) if 80000 < pop <= 110000
       = 0 if pop > 110000
```

This creates a tent function peaking around 50,000–70,000.

### S5 — Median Age (weight 0.10)

Home-services spending peaks for ages 38–58 (established homeowners, pre-downsizing). College towns (medianAge < 28) and retirement communities (medianAge > 55) are weaker markets.

```
ageSub = 1 - abs(medianAge - 46) / 18   clipped to [0, 1]
```

Peaks at age 46; scores ~0.5 at ages 28 and 64; clips at 0 outside [28, 64].

### S6 — Metro Density Penalty (weight 0.10)

V1 used distance to the nearest city with population > 300,000. The first real-data run revealed that approach fails for sprawling metros where no single city breaches 300k: Wellington FL (near West Palm Beach, 117k), Algonquin IL, Huntley IL, and six other NW Chicago exurbs all ranked in the top 20 with v1 multipliers of 1.0.

The fix: replace the single-anchor distance check with a **cumulative nearby population** metric. A candidate in a metro cluster accumulates high nearbyPop even if no individual city is large.

```
nearbyPop = sum of population of all cities within 50 km Haversine of the candidate,
            excluding the candidate itself

metroDensityMultiplier =
  1.0   if nearbyPop < 250,000
  0.7   if 250,000 <= nearbyPop < 500,000
  0.4   if 500,000 <= nearbyPop < 1,000,000
  0.15  if nearbyPop >= 1,000,000
```

Applied as a multiplier on the final weighted sum, not a sub-score.

The 0.15 floor (not 0.0) is intentional: cities in a mega-metro that survive hard filters still carry scoring signal from S1–S5, and a floor above zero preserves rank order among penalized cities. Total suppression is handled by the hard filters.

---

## Hard Filters (applied before scoring)

| Filter | Threshold | Rationale |
|---|---|---|
| Population min | 15,000 | Below this, search volume for any niche collapses |
| Population max | 110,000 | Above this, national directories dominate SERPs |
| ownerOccupiedPct min | 0.55 | Renter-majority cities don't buy home services |
| medianIncome min | 35,000 | Below this, per-job revenue too low to support tenant pricing |
| medianHomeValue min | 100,000 | Distressed markets signal structural economic decline |

Cities missing Census data pass through with neutral sub-scores (0.5) on affected signals and a 10% final score haircut to reflect the uncertainty.

---

## Algorithm (Pseudocode)

```
function rankCities(cities: UsCityEnriched[]): RankedCity[] {
  const gridBuckets = buildGridBuckets(cities)  // 1-degree lat/lng cells

  const candidates = cities.filter(c => passesHardFilters(c))

  return candidates
    .map(c => {
      const s1 = normClamp(c.ownerOccupiedPct, 0.55, 0.85)
      const s2 = 0.6 * normClamp(c.medianIncome, 45000, 100000)
               + 0.4 * normClamp(c.medianHomeValue, 150000, 500000)
      const s3 = Math.min(1, Math.log10(Math.max(1, c.totalHousingUnits)) / Math.log10(35000))
      const s4 = popTentScore(c.populationCensus ?? c.population)
      const s5 = Math.max(0, 1 - Math.abs((c.medianAge ?? 42) - 46) / 18)
      const missingDataHaircut = hasMissingCensus(c) ? 0.90 : 1.0

      const rawScore =
        0.25 * s1 +
        0.20 * s2 +
        0.20 * s3 +
        0.15 * s4 +
        0.10 * s5

      const proximityMult = getMetroDensityMultiplier(c, gridBuckets)
      const score = rawScore * proximityMult * missingDataHaircut

      return { ...c, score, proximityMult }
    })
    .sort((a, b) => b.score - a.score)
}
```

Weights sum to 0.90 before the S6 multiplier; the remaining 0.10 is carried by the proximity multiplier (1.0 = no penalty). Final scores are 0–1 (multiply by 100 for display).

---

## Calibration Table

Expected scoring uses the formula above at representative Census values. Scores are approximate.

| City | Pop | OO% | MedInc | NearbyPop (50km) | S6 mult | Expected Score | Verdict |
|---|---|---|---|---|---|---|---|
| Owensboro KY | 60k | 0.68 | 52k | ~120k (Evansville IN + Henderson KY) | 1.0 | 0.68 | PASS — strong OO, isolated |
| Wellington FL | 61k | 0.76 | 106k | >1.5M (WPB + Fort Laud metro) | 0.15 | ~0.11 | PENALIZED — was rank #1 in v1 |
| Algonquin IL | 30k | 0.86 | 130k | >5M (Chicago metro) | 0.15 | ~0.11 | PENALIZED — was rank #2 in v1 |
| Bettendorf IA | 39k | 0.76 | 101k | ~280k (Quad Cities cluster) | 0.7 | ~0.49 | MILD PENALTY — real metro, not suburb |
| Clarksville TN | 160k | 0.62 | 54k | n/a | n/a | FILTERED | FAIL — pop > 110k |
| Meridian ID | 130k | 0.72 | 78k | n/a | n/a | FILTERED | FAIL — pop > 110k |
| Nampa ID | 100k | 0.69 | 59k | ~550k (Boise + Meridian + Caldwell) | 0.4 | ~0.21 | PENALIZED — Treasure Valley metro |
| Bowling Green KY | 74k | 0.55 | 43k | ~80k | 1.0 | 0.52 | PASS but weak OO + young |
| Lawton OK | 90k | 0.58 | 43k | ~60k | 1.0 | 0.42 | MARGINAL — low income + homevalue |
| Warner Robins GA | 80k | 0.63 | 55k | ~90k | 1.0 | 0.60 | PASS — good fundamentals, isolated |
| Greenville NC | 95k | 0.47 | 41k | n/a | n/a | FILTERED | FAIL — OO% < 0.55 |
| Pine Bluff AR | 40k | 0.60 | 30k | n/a | n/a | FILTERED | FAIL — income + homevalue below floor |
| Tyler TX | 105k | 0.62 | 54k | ~120k | 1.0 | 0.61 | PASS — near pop ceiling but clean |
| Joplin MO | 51k | 0.63 | 44k | ~60k | 1.0 | 0.54 | PASS — all signals adequate |
| Florence SC | 38k | 0.58 | 43k | ~50k | 1.0 | 0.56 | PASS — compact, clean market |

Intuition check: Owensboro KY, Warner Robins GA, Tyler TX, Joplin MO, Florence SC all score above 0.52 with no S6 penalty. Wellington FL and Algonquin IL drop to ~0.11. NYC and Plano filter out. The two v1 failures now land where expected.

---

## Integration Point

**Recommendation: Option (b) — replace `sampleN: 150` in niche-hunter with `rankCities() -> top 150`.**

Replacing the random sample with a scored top-150 requires touching exactly one call site in `packages/agents/src/niche-hunter/index.ts` and adding a new file `packages/us-cities/src/city-ranker.ts`. No new agent, no new cron route, no new `agent_events` rows.

The output of `rankCities()` can also be surfaced as a read-only endpoint (`/api/cities/ranked`) for operator visibility without any new agent overhead.

---

## Winners Per Run and Diversity Constraint

**Default: top 5 niche x city pairs persisted as `niches` rows per niche-hunter run.**

The city ranker's job is to produce the 150-city pool, not the final 5. The niche-hunter scoring step (DataForSEO KD + volume) selects the final 5 from that pool. No change to `target_count`.

**Diversity constraint:** cap the 150-city pool at 12 cities per state. If a state dominates the ranked list (common in TX, FL, OH), take the top 12 by score and include remaining slots from the next states.

Implementation: after sort, apply a greedy per-state cap of 12 before slicing to 150.

---

## Implementation Notes — Spatial Index for S6

Naive pairwise Haversine for 31k cities = ~960M operations per run (~48 seconds at 50ns/op). The fix: a 1-degree lat/lng grid bucket.

Pre-computation (O(n)): assign every city to its `(floor(lat), floor(lng))` cell. One degree of latitude is ~111 km; one degree of longitude is 70–111 km depending on latitude. To cover a 50 km radius, enumerate the 9 cells centered on the candidate cell (a 3x3 neighborhood covers roughly 210–330 km in each direction at US latitudes — safely larger than 50 km). Sum populations of all cities in those 9 cells within actual Haversine 50 km.

Per-candidate lookup: O(k) where k is cities in 9 cells, typically < 500. Total: O(n * k) ~ 15M operations, well under 1 second. No external library required — a plain `Map<string, UsCityRow[]>` keyed by `"${latCell},${lngCell}"` is sufficient.

Log `nearbyPop` for every candidate alongside the final score to enable calibration review.

---

## Guardrails for the Three Main Failure Modes

**Failure 1 — Missing Census data biases toward unknown markets.** ~15% of cities lack Census enrichment. Without a penalty, these cities score 0.5 on all missing signals and rise to the top of a sparse state. Guardrail: 10% score haircut for any city with `>= 2 missing Census fields`. Log the haircut count per run.

**Failure 2 — Suburb detection misses exurbs.** V1 used distance to the nearest city with population > 300,000. The first real-data run (2026-05-18) showed this failed completely: metros like West Palm Beach metro and the NW Chicago cluster have no single city over 300k, so v1 assigned a 1.0 multiplier to their exurbs, producing a top-20 dominated by suburban markets. V2 (this ADR revision) replaces the single-anchor model with cumulative nearby population — see S6 above. If a subsequent run still shows suburb clustering, the first diagnostic is to check whether `nearbyPop` is being logged and whether the 50 km radius needs tightening.

**Failure 3 — Wealth signals are backward-looking.** Census ACS data is 5-year estimates, potentially 2–4 years stale. Guardrail: add a `lastEnrichedAt` timestamp to the census-enrichment.json structure; warn in operator UI if enrichment is older than 18 months. Operator can manually flag cities as excluded via the existing denylist pattern.

---

## Deferred to v2

- Per-niche age skew (HVAC peaks at 45–65 median age; landscaping peaks lower)
- Seasonality weighting by climate zone
- Competitor site count as a SERP entry barrier signal (requires DataForSEO spend)
- Automated re-enrichment trigger when ACS data ages past 18 months
