-- Job-story (use-case) narrative support for the local-content pipeline.
-- Carries the factual problem -> discovery -> resolution skeleton from the
-- local-content-scout to the local-content-writer. Nullable: the five
-- non-narrative archetypes leave it null, and existing rows are unaffected.
ALTER TABLE "content_ideas" ADD COLUMN "story_scaffold" jsonb;
