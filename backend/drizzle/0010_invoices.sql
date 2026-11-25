CREATE TABLE "invoice_counters" (
	"wholesaler_id" uuid NOT NULL,
	"financial_year" text NOT NULL,
	"last_serial" integer NOT NULL,
	CONSTRAINT "invoice_counters_wholesaler_id_financial_year_pk" PRIMARY KEY("wholesaler_id","financial_year")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "invoice_number" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "invoice_date" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "invoice_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "invoice_counters" ADD CONSTRAINT "invoice_counters_wholesaler_id_users_id_fk" FOREIGN KEY ("wholesaler_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_invoice_number_uq" ON "orders" USING btree ("wholesaler_id","invoice_number");