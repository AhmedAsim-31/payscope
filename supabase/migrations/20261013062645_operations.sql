CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM('success', 'failure');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('open', 'investigating', 'resolved');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_type" "audit_actor_type" NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"reason" text,
	"previous_state" jsonb,
	"resulting_state" jsonb,
	"outcome" "audit_outcome" NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "incident_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incident_actions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"category" text NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"status" "incident_status" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"fingerprint" text NOT NULL,
	"related" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"finding_count" integer DEFAULT 1 NOT NULL,
	"resolution_notes" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "incidents_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "incidents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_actions" ADD CONSTRAINT "incident_actions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_actions" ADD CONSTRAINT "incident_actions_incident_fk" FOREIGN KEY ("org_id","incident_id") REFERENCES "public"."incidents"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_org_created_idx" ON "audit_logs" USING btree ("org_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_org_action_idx" ON "audit_logs" USING btree ("org_id","action");--> statement-breakpoint
CREATE INDEX "incident_actions_incident_idx" ON "incident_actions" USING btree ("incident_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_active_fingerprint_idx" ON "incidents" USING btree ("org_id","fingerprint") WHERE "incidents"."status" <> 'resolved';--> statement-breakpoint
CREATE INDEX "incidents_org_opened_idx" ON "incidents" USING btree ("org_id","opened_at" DESC NULLS LAST,"id" DESC NULLS LAST);