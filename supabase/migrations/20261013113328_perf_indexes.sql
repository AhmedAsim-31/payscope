DROP INDEX "provider_events_org_received_idx";--> statement-breakpoint
DROP INDEX "provider_events_org_status_idx";--> statement-breakpoint
DROP INDEX "audit_logs_org_action_idx";--> statement-breakpoint
DROP INDEX "customers_org_created_idx";--> statement-breakpoint
DROP INDEX "reconciliation_findings_org_created_idx";--> statement-breakpoint
DROP INDEX "reconciliation_findings_org_status_idx";--> statement-breakpoint
DROP INDEX "reconciliation_runs_org_started_idx";--> statement-breakpoint
DROP INDEX "payment_records_org_created_idx";--> statement-breakpoint
DROP INDEX "payment_records_org_status_idx";--> statement-breakpoint
DROP INDEX "subscription_records_org_created_idx";--> statement-breakpoint
DROP INDEX "subscription_records_org_status_idx";--> statement-breakpoint
CREATE INDEX "provider_events_object_ref_idx" ON "provider_events" USING btree ("org_id","connection_id","object_ref","received_at","id");--> statement-breakpoint
CREATE INDEX "entitlement_records_org_created_idx" ON "entitlement_records" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "provider_events_org_received_idx" ON "provider_events" USING btree ("org_id","received_at","id");--> statement-breakpoint
CREATE INDEX "provider_events_org_status_idx" ON "provider_events" USING btree ("org_id","status","received_at","id");--> statement-breakpoint
CREATE INDEX "audit_logs_org_action_idx" ON "audit_logs" USING btree ("org_id","action","created_at","id");--> statement-breakpoint
CREATE INDEX "customers_org_created_idx" ON "customers" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "reconciliation_findings_org_created_idx" ON "reconciliation_findings" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "reconciliation_findings_org_status_idx" ON "reconciliation_findings" USING btree ("org_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "reconciliation_runs_org_started_idx" ON "reconciliation_runs" USING btree ("org_id","started_at","id");--> statement-breakpoint
CREATE INDEX "payment_records_org_created_idx" ON "payment_records" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "payment_records_org_status_idx" ON "payment_records" USING btree ("org_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "subscription_records_org_created_idx" ON "subscription_records" USING btree ("org_id","created_at","id");--> statement-breakpoint
CREATE INDEX "subscription_records_org_status_idx" ON "subscription_records" USING btree ("org_id","status","created_at","id");