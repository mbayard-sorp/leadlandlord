# ADR 0001: Content Pipeline Hardening

## Context
A production niche.approved cascade for "roof replacement / Owensboro KY" failed on first attempt ($0.58 burned) and succeeded on retry only by gaming the cluster-coverage gate — semantic drift went undetected, info_pages was empty, and total cost doubled to $1.10. Root cause: keyword-planner emitted 4 structurally redundant cost clusters; content-engine's coverage check was shape-only; the retry mechanism had no feedback loop.

## Decision
1. Keyword-planner deduplication via topic-fingerprint match before persisting clusters.
2. Kind-bucket enforcement in content-engine — coverage check now asserts cluster_key matches its expected page_kind array.
3. Kind-gated salvage: missing service/service_area/home = hard fail; missing info/blog under 20% = salvage with `site.build.degraded` event.
4. Failure artifact capture: log full rejectedBundle on all hard-fail paths.
5. Retry-with-feedback deferred to R4.

## Alternatives considered
- Raise miss-rate threshold to 35%: rejected — treats symptom, not cause.
- Shard content-engine into one LLM call per page kind: rejected — 4x cost, out of R3 scope.
- Fuzzy-match cluster_key normalization post-output: rejected — superseded by decorateSchemaWithClusterEnum.

## Consequences
- First-attempt success expected >90% for niches with up to 25 clusters.
- Sites with minor info-page gaps deploy rather than dead-letter.
- Per-site cost converges toward $0.50-0.55 baseline.
- New failure mode: dedup fingerprint too aggressive could drop valid clusters. Must be tuned with 3+ real-niche test runs before fleet deploy.
