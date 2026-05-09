-- Phase: backlink prospecting — competitor domain seeds per site.
-- Populated by Niche Hunter (top organic competitors from SERP analysis) or
-- operator. Read by Backlink Builder's prospect mode as inputs to
-- DataForSEO's domain_intersection endpoint.
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "competitor_seeds" jsonb;
