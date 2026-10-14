ALTER TABLE "subscription_records" ADD COLUMN "canceled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscription_records" ADD COLUMN "ended_at" timestamp with time zone;