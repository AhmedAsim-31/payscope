ALTER TABLE "provider_events" ADD COLUMN "payload_pruned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "event_processing_attempts_job_idx" ON "event_processing_attempts" USING btree ("job_id") WHERE "event_processing_attempts"."job_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "provider_events_payload_retention_idx" ON "provider_events" USING btree ("received_at") WHERE "provider_events"."payload_pruned_at" IS NULL AND "provider_events"."status" IN ('processed', 'duplicate', 'ignored');--> statement-breakpoint
CREATE INDEX "background_jobs_finished_retention_idx" ON "background_jobs" USING btree ("updated_at") WHERE "background_jobs"."status" IN ('succeeded', 'failed', 'dead');--> statement-breakpoint
CREATE INDEX "idempotency_records_expires_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "demo_scenario_runs_finished_retention_idx" ON "demo_scenario_runs" USING btree ("started_at") WHERE "demo_scenario_runs"."status" <> 'running';