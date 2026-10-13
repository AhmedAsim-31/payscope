CREATE TYPE "public"."scenario_run_status" AS ENUM('running', 'passed', 'failed', 'errored');--> statement-breakpoint
CREATE TABLE "demo_scenario_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"scenario_id" text NOT NULL,
	"status" "scenario_run_status" DEFAULT 'running' NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error" text,
	"result" jsonb,
	CONSTRAINT "demo_scenario_runs_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "demo_scenario_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "demo_scenario_runs" ADD CONSTRAINT "demo_scenario_runs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "demo_scenario_runs_org_scenario_idx" ON "demo_scenario_runs" USING btree ("org_id","scenario_id","started_at" DESC NULLS LAST);