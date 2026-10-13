CREATE INDEX "audit_logs_org_target_idx" ON "audit_logs" USING btree ("org_id","target_type","target_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reconciliation_findings_org_subject_idx" ON "reconciliation_findings" USING btree ("org_id","subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "payment_records_org_customer_idx" ON "payment_records" USING btree ("org_id","customer_id","created_at","id");--> statement-breakpoint
CREATE INDEX "payment_records_org_subscription_idx" ON "payment_records" USING btree ("org_id","connection_id","provider_subscription_id");--> statement-breakpoint
CREATE INDEX "subscription_records_org_customer_idx" ON "subscription_records" USING btree ("org_id","customer_id");