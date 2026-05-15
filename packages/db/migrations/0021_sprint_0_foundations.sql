-- Sprint 0 foundations: site_mode enum, approval gates, networks, cross-site linking
--> statement-breakpoint
CREATE TYPE "public"."site_mode" AS ENUM ('thin', 'content_rich');
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "site_mode" "site_mode" DEFAULT 'thin' NOT NULL;
--> statement-breakpoint
CREATE TABLE "agent_approvals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "agent_run_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "rule_matched" text,
  "rejection_reason" text,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "agent_approvals_agent_run_id_fkey" FOREIGN KEY ("agent_run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "agent_approvals_status_kind_created_idx" ON "agent_approvals" ("status", "kind", "created_at");
--> statement-breakpoint
CREATE INDEX "agent_approvals_agent_run_idx" ON "agent_approvals" ("agent_run_id");
--> statement-breakpoint
CREATE TABLE "auto_approve_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "kind" text NOT NULL,
  "matcher" jsonb NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "approved_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "networks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "networks_slug_unique" UNIQUE ("slug")
);
--> statement-breakpoint
CREATE TABLE "site_network_memberships" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "site_id" uuid NOT NULL,
  "network_id" uuid NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL,
  "link_budget_outbound" integer DEFAULT 4 NOT NULL,
  "link_budget_inbound" integer DEFAULT 8 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  CONSTRAINT "site_network_memberships_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE,
  CONSTRAINT "site_network_memberships_network_id_fkey" FOREIGN KEY ("network_id") REFERENCES "networks"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX "site_network_memberships_site_uniq" ON "site_network_memberships" ("site_id");
--> statement-breakpoint
CREATE INDEX "site_network_memberships_network_idx" ON "site_network_memberships" ("network_id");
--> statement-breakpoint
CREATE TABLE "cross_site_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_site_id" uuid NOT NULL,
  "source_page_id" text NOT NULL,
  "target_site_id" uuid NOT NULL,
  "target_url" text NOT NULL,
  "anchor_text" text NOT NULL,
  "surrounding_context_hash" text,
  "placed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  CONSTRAINT "cross_site_links_source_site_id_fkey" FOREIGN KEY ("source_site_id") REFERENCES "sites"("id") ON DELETE CASCADE,
  CONSTRAINT "cross_site_links_target_site_id_fkey" FOREIGN KEY ("target_site_id") REFERENCES "sites"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "cross_site_links_source_site_idx" ON "cross_site_links" ("source_site_id");
--> statement-breakpoint
CREATE INDEX "cross_site_links_target_site_idx" ON "cross_site_links" ("target_site_id");
--> statement-breakpoint
CREATE INDEX "cross_site_links_source_page_idx" ON "cross_site_links" ("source_page_id");
--> statement-breakpoint
CREATE TABLE "link_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "requesting_site_id" uuid NOT NULL,
  "desired_count" integer DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  CONSTRAINT "link_requests_requesting_site_id_fkey" FOREIGN KEY ("requesting_site_id") REFERENCES "sites"("id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "link_requests_site_status_idx" ON "link_requests" ("requesting_site_id", "status");
--> statement-breakpoint
INSERT INTO "networks" ("slug", "name") VALUES ('default', 'Default Network');
