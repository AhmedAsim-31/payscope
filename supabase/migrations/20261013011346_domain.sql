CREATE TYPE "public"."attempt_outcome" AS ENUM('succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('pending', 'processing', 'processed', 'failed', 'duplicate', 'needs_attention', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."failure_category" AS ENUM('transient', 'permanent', 'invalid_input', 'provider_auth', 'unsupported_event', 'state_conflict');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE TYPE "public"."connection_mode" AS ENUM('sandbox', 'simulation');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('active', 'unverified', 'error', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('stripe', 'paddle', 'paypal', 'revenuecat');--> statement-breakpoint
CREATE TYPE "public"."entitlement_source" AS ENUM('provider_event', 'reconciliation', 'manual_repair', 'scenario');--> statement-breakpoint
CREATE TYPE "public"."entitlement_state" AS ENUM('active', 'expired', 'revoked', 'inconsistent');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'disputed', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'expired', 'paused');--> statement-breakpoint
CREATE TABLE "event_processing_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"job_id" uuid,
	"attempt_number" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"outcome" "attempt_outcome",
	"failure_category" "failure_category",
	"error_message" text,
	"retryable" boolean,
	"next_retry_at" timestamp with time zone,
	"correlation_id" text,
	CONSTRAINT "event_processing_attempts_event_attempt_unique" UNIQUE("event_id","attempt_number")
);
--> statement-breakpoint
ALTER TABLE "event_processing_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"normalized_type" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"status" "event_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"signature_verified" boolean NOT NULL,
	"payload" jsonb NOT NULL,
	"object_ref" text,
	CONSTRAINT "provider_events_connection_event_unique" UNIQUE("connection_id","provider_event_id"),
	CONSTRAINT "provider_events_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "provider_events_payload_size_check" CHECK (pg_column_size("provider_events"."payload") <= 262144)
);
--> statement-breakpoint
ALTER TABLE "provider_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"kind" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "background_jobs_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "background_jobs_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "background_jobs_attempts_check" CHECK ("background_jobs"."attempt_count" >= 0 AND "background_jobs"."max_attempts" >= 1)
);
--> statement-breakpoint
ALTER TABLE "background_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_records_org_scope_key_unique" UNIQUE("org_id","scope","key")
);
--> statement-breakpoint
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text,
	"display_name" text,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"mode" "connection_mode" NOT NULL,
	"status" "connection_status" NOT NULL,
	"display_name" text NOT NULL,
	"external_account_id" text NOT NULL,
	"credentials_ciphertext" "bytea",
	"credentials_key_version" integer,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_connections_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "provider_connections_org_provider_account_unique" UNIQUE("org_id","provider","external_account_id")
);
--> statement-breakpoint
ALTER TABLE "provider_connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "provider_customer_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_customer_mappings_connection_customer_unique" UNIQUE("connection_id","provider_customer_id")
);
--> statement-breakpoint
ALTER TABLE "provider_customer_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "entitlement_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"subscription_id" uuid,
	"entitlement_key" text NOT NULL,
	"state" "entitlement_state" NOT NULL,
	"source" "entitlement_source" NOT NULL,
	"granted_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"reconciliation_status" text,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_records_customer_key_unique" UNIQUE("org_id","customer_id","entitlement_key")
);
--> statement-breakpoint
ALTER TABLE "entitlement_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"customer_id" uuid,
	"provider_payment_id" text NOT NULL,
	"status" "payment_status" NOT NULL,
	"amount_minor" bigint NOT NULL,
	"amount_refunded_minor" bigint DEFAULT 0 NOT NULL,
	"currency" char(3) NOT NULL,
	"provider_created_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_records_connection_payment_unique" UNIQUE("connection_id","provider_payment_id"),
	CONSTRAINT "payment_records_org_id_id_unique" UNIQUE("org_id","id"),
	CONSTRAINT "payment_records_currency_check" CHECK ("payment_records"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "payment_records_amount_check" CHECK ("payment_records"."amount_minor" >= 0),
	CONSTRAINT "payment_records_refunded_check" CHECK ("payment_records"."amount_refunded_minor" >= 0 AND "payment_records"."amount_refunded_minor" <= "payment_records"."amount_minor")
);
--> statement-breakpoint
ALTER TABLE "payment_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"provider_subscription_id" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"plan_ref" text,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"last_event_at" timestamp with time zone,
	"version" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_records_connection_subscription_unique" UNIQUE("connection_id","provider_subscription_id"),
	CONSTRAINT "subscription_records_org_id_id_unique" UNIQUE("org_id","id")
);
--> statement-breakpoint
ALTER TABLE "subscription_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_processing_attempts" ADD CONSTRAINT "event_processing_attempts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_processing_attempts" ADD CONSTRAINT "event_processing_attempts_event_fk" FOREIGN KEY ("org_id","event_id") REFERENCES "public"."provider_events"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_processing_attempts" ADD CONSTRAINT "event_processing_attempts_job_fk" FOREIGN KEY ("org_id","job_id") REFERENCES "public"."background_jobs"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."provider_connections"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_customer_mappings" ADD CONSTRAINT "provider_customer_mappings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_customer_mappings" ADD CONSTRAINT "provider_customer_mappings_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."provider_connections"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_customer_mappings" ADD CONSTRAINT "provider_customer_mappings_customer_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_records" ADD CONSTRAINT "entitlement_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_records" ADD CONSTRAINT "entitlement_records_customer_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_records" ADD CONSTRAINT "entitlement_records_subscription_fk" FOREIGN KEY ("org_id","subscription_id") REFERENCES "public"."subscription_records"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."provider_connections"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_customer_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_records" ADD CONSTRAINT "subscription_records_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_records" ADD CONSTRAINT "subscription_records_connection_fk" FOREIGN KEY ("org_id","connection_id") REFERENCES "public"."provider_connections"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_records" ADD CONSTRAINT "subscription_records_customer_fk" FOREIGN KEY ("org_id","customer_id") REFERENCES "public"."customers"("org_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_events_org_received_idx" ON "provider_events" USING btree ("org_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "provider_events_org_status_idx" ON "provider_events" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "background_jobs_queued_idx" ON "background_jobs" USING btree ("available_at") WHERE "background_jobs"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "background_jobs_running_lease_idx" ON "background_jobs" USING btree ("lease_expires_at") WHERE "background_jobs"."status" = 'running';--> statement-breakpoint
CREATE INDEX "customers_org_created_idx" ON "customers" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "provider_customer_mappings_customer_idx" ON "provider_customer_mappings" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "entitlement_records_org_state_idx" ON "entitlement_records" USING btree ("org_id","state");--> statement-breakpoint
CREATE INDEX "payment_records_org_created_idx" ON "payment_records" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payment_records_org_status_idx" ON "payment_records" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "subscription_records_org_created_idx" ON "subscription_records" USING btree ("org_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "subscription_records_org_status_idx" ON "subscription_records" USING btree ("org_id","status");