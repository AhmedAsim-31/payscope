CREATE SCHEMA IF NOT EXISTS app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO authenticated;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.is_org_member(target_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.org_id = target_org AND m.user_id = (SELECT auth.uid())
  )
$$;
--> statement-breakpoint
REVOKE EXECUTE ON FUNCTION app.is_org_member(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.is_org_member(uuid) TO authenticated;
--> statement-breakpoint
GRANT SELECT ON public.profiles, public.organizations, public.memberships TO authenticated;
--> statement-breakpoint
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY organizations_select_member ON public.organizations FOR SELECT TO authenticated
  USING (app.is_org_member(id));
--> statement-breakpoint
CREATE POLICY memberships_select_member ON public.memberships FOR SELECT TO authenticated
  USING (app.is_org_member(org_id));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.guard_last_owner() RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF OLD.role = 'OWNER' AND (TG_OP = 'DELETE' OR NEW.role <> 'OWNER') THEN
    PERFORM 1 FROM public.organizations WHERE id = OLD.org_id FOR UPDATE;
    IF FOUND AND NOT EXISTS (
      SELECT 1 FROM public.memberships
      WHERE org_id = OLD.org_id AND role = 'OWNER' AND id <> OLD.id
    ) THEN
      RAISE EXCEPTION 'last_owner' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER memberships_guard_last_owner
BEFORE UPDATE OF role OR DELETE ON public.memberships
FOR EACH ROW EXECUTE FUNCTION app.guard_last_owner();
