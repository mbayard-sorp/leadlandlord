-- ADR 0009 Phase 2 / B1 + C1: contractor count and rentability score columns.
--
-- contractor_count: number of contractors returned by a Google Places Text Search
--   (first page, pageSize=20, excludeClosed=true). Null until validateNiche runs.
--   Cached 30 days in dataforseoCache ('places-contractor-count' endpoint namespace).
--   Operator-gated: only called inside validateNiche, never at brainstorm time.
--
-- rentability_score: 0-100 composite of contractor supply shape (tent curve),
--   avg_cpc willingness-to-pay signal, and static lead-price benchmark. Stored
--   separately from `score` (SEO winnability) per ADR decision to keep both
--   dimensions independently visible in the operator UI.
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "contractor_count" integer;
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "rentability_score" numeric(6, 2);
