-- Niche-hunter category persistence: the brainstorm step already produces a
-- CategoryEnum per candidate but it was dropped before insert. Persist it so
-- the operator niches page can show category in front of each niche. Nullable
-- because legacy rows predate this column; they stay null until re-run.
-- Hand-written + idempotent (IF NOT EXISTS) so it is safe to apply against the
-- existing prod DB. Mirrors the 0030_content_ideas style; drizzle-kit generate
-- is NOT used here (its journal/snapshot history is out of sync with the
-- hand-written migrations).
ALTER TABLE "niches" ADD COLUMN IF NOT EXISTS "category" text;
