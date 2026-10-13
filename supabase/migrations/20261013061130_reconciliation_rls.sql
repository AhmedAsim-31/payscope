GRANT SELECT ON public.reconciliation_runs, public.reconciliation_findings TO authenticated;
--> statement-breakpoint
CREATE POLICY reconciliation_runs_select_member ON public.reconciliation_runs FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE POLICY reconciliation_findings_select_member ON public.reconciliation_findings FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
