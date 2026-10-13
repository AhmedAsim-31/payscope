GRANT SELECT ON public.demo_scenario_runs TO authenticated;
--> statement-breakpoint
CREATE POLICY demo_scenario_runs_select_member ON public.demo_scenario_runs FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
