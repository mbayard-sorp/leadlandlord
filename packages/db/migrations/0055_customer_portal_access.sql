CREATE TABLE IF NOT EXISTS "bs_customer_site_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" text NOT NULL,
	"buildsell_site_id" uuid NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "bs_customer_site_access" ADD CONSTRAINT "bs_customer_site_access_buildsell_site_id_buildsell_sites_id_fk" FOREIGN KEY ("buildsell_site_id") REFERENCES "public"."buildsell_sites"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "bs_customer_site_access_user_site_uniq" ON "bs_customer_site_access" USING btree ("auth_user_id","buildsell_site_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bs_customer_site_access_auth_user_idx" ON "bs_customer_site_access" USING btree ("auth_user_id");