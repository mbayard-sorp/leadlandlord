-- ADR 0009 Phase 1 / A1: Cluster volume column.
-- Stores the sum of search_volume across commercial/transactional-intent phrases
-- returned by getKeywordCandidates (DataForSEO Labs, 90-day cache, city-independent).
-- Null until validateNiche runs for the row.
--> statement-breakpoint
ALTER TABLE "niches" ADD COLUMN "dfs_cluster_volume" integer;
