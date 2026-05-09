-- Phase 3: outbound email audit log + per-mailbox throttle source.
-- Read by packages/db/src/email-throttle.ts to enforce a daily cap with
-- a configurable warmup ramp; the count query filters status='sent' so
-- throttled/failed attempts don't burn the cap.
CREATE TABLE IF NOT EXISTS "email_sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid,
	"mailbox" varchar(320) NOT NULL,
	"to_address" varchar(320) NOT NULL,
	"subject" text NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"provider" varchar(16) NOT NULL,
	"external_id" text,
	"status" varchar(16) NOT NULL,
	"error_message" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "email_sends" ADD CONSTRAINT "email_sends_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_mailbox_sent_at_idx" ON "email_sends" USING btree ("mailbox","sent_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "email_sends_site_id_idx" ON "email_sends" USING btree ("site_id");
