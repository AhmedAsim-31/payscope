GRANT SELECT ON public.audit_logs, public.incidents, public.incident_actions TO authenticated;
--> statement-breakpoint
CREATE POLICY audit_logs_select_member ON public.audit_logs FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE POLICY incidents_select_member ON public.incidents FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE POLICY incident_actions_select_member ON public.incident_actions FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE FUNCTION public.audit_logs_reject_mutation() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.audit_logs_reject_mutation();
