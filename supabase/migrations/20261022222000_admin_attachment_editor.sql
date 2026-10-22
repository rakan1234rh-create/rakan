CREATE TABLE IF NOT EXISTS public.violation_attachment_admin_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_id uuid NOT NULL REFERENCES public.violations(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES public.users(id),
  action text NOT NULL CHECK (action IN ('add', 'delete', 'replace')),
  added_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  removed_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.violation_attachment_admin_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS violation_attachment_admin_audit_admin_only ON public.violation_attachment_admin_audit;
CREATE POLICY violation_attachment_admin_audit_admin_only
  ON public.violation_attachment_admin_audit
  FOR ALL TO authenticated
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

CREATE OR REPLACE FUNCTION public.admin_update_violation_attachments(
  p_violation_id uuid,
  p_attachments jsonb,
  p_action text,
  p_added_names jsonb DEFAULT '[]'::jsonb,
  p_removed_names jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, pg_temp
AS $function$
DECLARE
  v_actor uuid := public.current_user_id();
  v_logs jsonb;
  v_atts jsonb;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_actor IS NULL OR public.current_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'admin_only';
  END IF;
  IF p_violation_id IS NULL OR p_action NOT IN ('add', 'delete', 'replace')
     OR jsonb_typeof(COALESCE(p_attachments, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'invalid_attachment_update';
  END IF;

  v_atts := COALESCE(p_attachments, '[]'::jsonb);
  UPDATE public.violations
  SET attachments = v_atts, updated_at = now()
  WHERE id = p_violation_id
  RETURNING logs INTO v_logs;
  IF NOT FOUND THEN RAISE EXCEPTION 'violation_not_found'; END IF;

  INSERT INTO public.violation_attachment_admin_audit
    (violation_id, actor_id, action, added_names, removed_names)
  VALUES
    (p_violation_id, v_actor, p_action, COALESCE(p_added_names, '[]'::jsonb), COALESCE(p_removed_names, '[]'::jsonb));

  SELECT jsonb_build_object('ok', true, 'id', v.id, 'attachments', v.attachments)
    INTO v_result FROM public.violations v WHERE v.id = p_violation_id;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_violation_attachments(uuid, jsonb, text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_violation_attachments(uuid, jsonb, text, jsonb, jsonb) TO authenticated;
