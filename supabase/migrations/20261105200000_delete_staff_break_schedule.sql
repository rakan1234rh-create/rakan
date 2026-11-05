-- Admin: remove (deactivate) a single break-schedule exception (region / branch / user / global row).
CREATE OR REPLACE FUNCTION public.delete_staff_break_schedule(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_uid uuid := public.current_user_id();
  v_n integer;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;
  IF public.current_user_role() IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'مدير النظام فقط يعدل مدد البريك');
  END IF;
  UPDATE public.staff_break_schedules
  SET is_active = false, updated_at = now(), updated_by = v_uid
  WHERE id = p_id AND is_active;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN jsonb_build_object('ok', v_n > 0, 'deleted', v_n, 'error', CASE WHEN v_n = 0 THEN 'الاستثناء غير موجود' ELSE NULL END);
END;
$$;
REVOKE ALL ON FUNCTION public.delete_staff_break_schedule(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_staff_break_schedule(uuid) TO authenticated;
