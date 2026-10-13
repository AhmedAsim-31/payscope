CREATE TYPE "public"."finding_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'reviewed', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."finding_type" AS ENUM('provider_payment_missing_locally', 'status_mismatch', 'refund_inconsistent', 'expired_externally_active_locally', 'entitlement_missing_or_stale', 'provider_object_not_found', 'provider_unavailable', 'mapping_missing_or_ambiguous');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_mode" AS ENUM('local', 'provider');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_run_status" AS ENUM('running', 'completed', 'failed', 'partial');--> statement-breakpoint
CREATE TABLE "reconciliation_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" "finding_type" NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recommended_action" text NOT NULL,
	"first_seen_run_id" uuid NOT NULL,
	"last_seen_run_id" uuid NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_findings_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "reconciliation_findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid,
	"status" "reconciliation_run_status" DEFAULT 'running' NOT NULL,
	"mode" "reconciliation_mode" NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"examined_count" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"mismatched_count" integer DEFAULT 0 NOT NULL,
	"unavailable_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"triggered_by" uuid,
	CONSTRAINT "reconciliation_runs_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "reconciliation_runs_counts_check" CHECK ("reconciliation_runs"."examined_count" >= 0 AND "reconciliation_runs"."matched_count" >= 0 AND "reconciliation_runs"."mismatched_count" >= 0 AND "reconciliation_runs"."unavailable_count" >= 0 AND "reconciliation_runs"."failed_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_first_run_fk" FOREIGN KEY ("org_id","first_seen_run_id") REFERENCES "public"."reconciliation_runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_findings" ADD CONSTRAINT "reconciliation_findings_last_run_fk" FOREIGN KEY ("org_id","last_seen_run_id") REFERENCES "public"."reconciliation_runs"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."provider_connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_findings_open_fingerprint_idx" ON "reconciliation_findings" USING btree ("org_id","fingerprint") WHERE "reconciliation_findings"."status" IN ('open', 'reviewed');--> statement-breakpoint
CREATE INDEX "reconciliation_findings_org_created_idx" ON "reconciliation_findings" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reconciliation_findings_org_status_idx" ON "reconciliation_findings" USING btree ("org_id","status","type");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_runs_one_running_idx" ON "reconciliation_runs" USING btree ("org_id",coalesce("connection_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "reconciliation_runs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "reconciliation_runs_org_started_idx" ON "reconciliation_runs" USING btree ("org_id","started_at" DESC NULLS LAST);