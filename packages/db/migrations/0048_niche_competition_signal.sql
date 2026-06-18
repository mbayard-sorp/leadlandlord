-- Migration 0048: Niche Competition Signal (niche-engine fix Phase 0)
--
-- Adds competition / validation signal columns to niches and one operator-
-- tunable winnability floor override to system_state. All columns nullable
-- (NULL = use code defaults / pre-existing rows unaffected). Additive only.
--
-- Apply manually to prod: pnpm db:migrate

ALTER TABLE "niches" ADD COLUMN IF NOT EXISTS "validated_score" numeric(12, 2);
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN IF NOT EXISTS "scout_winnability" numeric(4, 3);
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN IF NOT EXISTS "scout_cluster_difficulty" numeric(5, 2);
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN IF NOT EXISTS "dfs_fallback" boolean;
--> statement-breakpoint
ALTER TABLE "system_state" ADD COLUMN IF NOT EXISTS "scout_min_winnability" numeric(4, 3);
