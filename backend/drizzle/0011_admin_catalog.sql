ALTER TYPE "public"."order_status" ADD VALUE 'forwarded' BEFORE 'accepted';--> statement-breakpoint
CREATE TABLE "supplier_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wholesaler_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"supply_price_paise" bigint NOT NULL,
	"stock_qty" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_offers_stock_ck" CHECK ("supplier_offers"."stock_qty" >= 0),
	CONSTRAINT "supplier_offers_price_ck" CHECK ("supplier_offers"."supply_price_paise" > 0)
);
--> statement-breakpoint
ALTER TABLE "product_variants" DROP CONSTRAINT "product_variants_stock_ck";--> statement-breakpoint
ALTER TABLE "products" DROP CONSTRAINT "products_wholesaler_id_users_id_fk";
--> statement-breakpoint
DROP INDEX "products_wholesaler_idx";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "wholesaler_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "supply_unit_price_paise" bigint;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_wholesaler_id_users_id_fk" FOREIGN KEY ("wholesaler_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_offers" ADD CONSTRAINT "supplier_offers_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_offers_wholesaler_variant_uq" ON "supplier_offers" USING btree ("wholesaler_id","variant_id");--> statement-breakpoint
CREATE INDEX "supplier_offers_variant_idx" ON "supplier_offers" USING btree ("variant_id");--> statement-breakpoint
-- Existing listings become supplier offers of the wholesaler that listed them, priced at the
-- old price minus the platform commission (5% unless the wholesaler had an override).
INSERT INTO "supplier_offers" ("wholesaler_id", "variant_id", "supply_price_paise", "stock_qty", "is_active")
SELECT p."wholesaler_id", v."id",
       GREATEST(1, v."price_paise" * (10000 - COALESCE(wp."commission_bps", 500)) / 10000),
       v."stock_qty", v."is_active"
FROM "product_variants" v
JOIN "products" p ON p."id" = v."product_id"
LEFT JOIN "wholesaler_profiles" wp ON wp."user_id" = p."wholesaler_id";--> statement-breakpoint
UPDATE "order_items" oi
SET "supply_unit_price_paise" = oi."unit_price_paise" - oi."unit_price_paise" * COALESCE(wp."commission_bps", 500) / 10000
FROM "orders" o LEFT JOIN "wholesaler_profiles" wp ON wp."user_id" = o."wholesaler_id"
WHERE o."id" = oi."order_id";--> statement-breakpoint
ALTER TABLE "product_variants" DROP COLUMN "stock_qty";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "wholesaler_id";