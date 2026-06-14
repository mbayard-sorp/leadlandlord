-- Migration 0046: Niche-Scout Diversity Caps (ADR 0023)
--
-- Adds two operator-tunable diversity caps to system_state. They bound how much
-- of a scout run any single trade / category may occupy, so a high-ticket
-- category (e.g. legal) can no longer sweep the entire persisted candidate set.
--
-- Apply manually to prod: pnpm db:migrate
--
-- system_state: operator-tunable diversity caps (NULL = use code defaults)
--   scout_max_per_trade        default 8    (SCOUT_MAX_PER_TRADE)
--   scout_max_category_share   default 0.30 (SCOUT_MAX_CATEGORY_SHARE)
ALTER TABLE "system_state"
  ADD COLUMN IF NOT EXISTS "scout_max_per_trade" integer,
  ADD COLUMN IF NOT EXISTS "scout_max_category_share" numeric(4, 3);
