-- Link building pipeline surface (ADR-0020).
-- 1) Contact fields on backlink_prospects: pre-filled by MollyScorer
--    (Firecrawl/Apollo) or entered by the operator in the review session.
--    contact_state drives the found/guessed/missing badge and the
--    approve guard (approve blocked while contact_email is null).
--    Plain text + CHECK (not a pg enum) to keep future value additions cheap.
-- 2) backlink_niche_tastes: one row per operator prospect rejection.
--    Per-niche taste profile read by MollyScorer (20 most recent per niche)
--    so scouting learns from rejection reasons. Keyed on the lowercased
--    niche string so the profile survives niche-row revisions.
--
-- Hand-written + idempotent (IF NOT EXISTS), mirroring 0035-0040.

ALTER TABLE "backlink_prospects"
  ADD COLUMN IF NOT EXISTS "contact_email" text,
  ADD COLUMN IF NOT EXISTS "contact_name"  text,
  ADD COLUMN IF NOT EXISTS "contact_state" text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'backlink_prospects_contact_state_check'
  ) THEN
    ALTER TABLE "backlink_prospects"
      ADD CONSTRAINT "backlink_prospects_contact_state_check"
      CHECK ("contact_state" IS NULL OR "contact_state" IN ('found', 'guessed', 'missing'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "backlink_niche_tastes" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "niche"        text NOT NULL,
  "domain"       text NOT NULL,
  "reason"       text NOT NULL,
  "recorded_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "prospect_id"  uuid REFERENCES "backlink_prospects"("id") ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS "backlink_niche_tastes_niche_recorded_idx"
  ON "backlink_niche_tastes" ("niche", "recorded_at");
