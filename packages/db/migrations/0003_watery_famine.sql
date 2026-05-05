CREATE TABLE IF NOT EXISTS "suppression_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"identifier_type" text NOT NULL,
	"reason" text,
	"source_site_id" uuid,
	"channel" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "suppression_list" ADD CONSTRAINT "suppression_list_source_site_id_sites_id_fk" FOREIGN KEY ("source_site_id") REFERENCES "public"."sites"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "suppression_list_identifier_uniq" ON "suppression_list" USING btree ("identifier","identifier_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppression_list_type_idx" ON "suppression_list" USING btree ("identifier_type");