-- Sprint 3: indexes + columns needed by network-linker (hygiene + drain cron).
--> statement-breakpoint
ALTER TABLE "link_requests" ADD COLUMN "scheduled_for" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE INDEX "link_requests_status_scheduled_idx" ON "link_requests" ("status", "scheduled_for");
--> statement-breakpoint
-- Hygiene: dedup lookup on (source_page, target_url, anchor_text)
CREATE INDEX "cross_site_links_page_target_anchor_idx" ON "cross_site_links" ("source_page_id", "target_url", "anchor_text");
--> statement-breakpoint
-- Reciprocal-window lookup: (source_site, target_site, placed_at)
CREATE INDEX "cross_site_links_source_target_placed_idx" ON "cross_site_links" ("source_site_id", "target_site_id", "placed_at");
--> statement-breakpoint
-- Transactional dedup: prevent twin pending approvals for the same placement.
-- Network-linker hygiene checks payload before insert; this enforces it at the DB level.
CREATE UNIQUE INDEX "agent_approvals_cross_link_pending_uniq"
  ON "agent_approvals" ((payload->>'sourcePageId'), (payload->>'targetUrl'), (payload->>'anchorText'))
  WHERE "kind" = 'cross_link_placement' AND "status" = 'pending';
