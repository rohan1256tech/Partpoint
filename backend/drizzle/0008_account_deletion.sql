ALTER TABLE "users" DROP CONSTRAINT "users_contact_ck";--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD COLUMN "source" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "account_deletion_requests" ADD COLUMN "note" text;--> statement-breakpoint
CREATE INDEX "account_deletion_requests_status_idx" ON "account_deletion_requests" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_contact_ck" CHECK ("users"."deleted_at" IS NOT NULL OR "users"."phone" IS NOT NULL OR "users"."email" IS NOT NULL);