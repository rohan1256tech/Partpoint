ALTER TABLE "orders" ADD COLUMN "delivery_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_otp_attempts" smallint DEFAULT 0 NOT NULL;