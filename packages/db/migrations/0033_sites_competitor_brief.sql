-- Competitor Analyzer brief persisted at build time. Null until the first
-- successful run. Stored as jsonb so the db package stays dep-free from agents.
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "competitor_brief" jsonb;
