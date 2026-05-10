CREATE TABLE IF NOT EXISTS "phone_provisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"candidate_e164" text NOT NULL,
	"twilio_number_sid" text,
	"locality" text,
	"region" text,
	"capabilities" jsonb,
	"recommended" boolean DEFAULT false NOT NULL,
	"rationale" text,
	"chosen" boolean DEFAULT false NOT NULL,
	"provisioned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "phone_provisions" ADD CONSTRAINT "phone_provisions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "phone_provisions_site_created_idx" ON "phone_provisions" USING btree ("site_id","created_at" DESC NULLS LAST);