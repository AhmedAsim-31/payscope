GRANT SELECT (id, org_id, provider, mode, status, display_name, external_account_id, capabilities, last_verified_at, last_error, created_at, updated_at) ON public.provider_connections TO authenticated;
--> statement-breakpoint
GRANT SELECT ON public.customers, public.provider_customer_mappings, public.payment_records, public.subscription_records, public.entitlement_records, public.provider_events, public.event_processing_attempts, public.background_jobs TO authenticated;
--> statement-breakpoint
CREATE POLICY provider_connections_select_member ON public.provider_connections FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE POLICY customers_select_member ON public.customers FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE POLICY provider_customer_mappings_select_member ON public.provider_customer_mappings FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE POLICY payment_records_select_member ON public.payment_records FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE POLICY subscription_records_select_member ON public.subscription_records FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE POLICY entitlement_records_select_member ON public.entitlement_records FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE POLICY provider_events_select_member ON public.provider_events FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE POLICY event_processing_attempts_select_member ON public.event_processing_attempts FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE POLICY background_jobs_select_member ON public.background_jobs FOR SELECT TO authenticated
  USING (org_id IS NOT NULL AND app.is_org_member(org_id));
