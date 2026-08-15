BEGIN;

-- Allow resolving a complaint, or accepting/rejecting a suggestion, with a matching log text.

ALTER TABLE public.complaints DROP CONSTRAINT IF EXISTS complaints_status_check;
ALTER TABLE public.complaints
  ADD CONSTRAINT complaints_status_check
  CHECK (status IN ('pending', 'resolved', 'rejected'));

DROP FUNCTION IF EXISTS public.resolve_complaint(uuid);

CREATE OR REPLACE FUNCTION public.resolve_complaint(
  p_complaint_id uuid,
  p_decision text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_row public.complaints%ROWTYPE;
  v_name text;
  v_entry jsonb;
  v_decision text;
  v_status text;
  v_text text;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;
  IF v_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'مدير النظام فقط يقدر يغلق الشكوى');
  END IF;

  SELECT * INTO v_row FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'الشكوى غير موجودة');
  END IF;

  v_decision := lower(btrim(COALESCE(p_decision, '')));
  IF v_decision NOT IN ('resolved', 'accepted', 'rejected') THEN
    v_decision := CASE WHEN v_row.kind = 'suggestion' THEN 'accepted' ELSE 'resolved' END;
  END IF;
  IF v_row.kind IS DISTINCT FROM 'suggestion' AND v_decision IN ('accepted', 'rejected') THEN
    v_decision := 'resolved';
  END IF;

  IF v_row.status IN ('resolved', 'rejected') THEN
    RETURN jsonb_build_object('ok', true, 'complaint', to_jsonb(v_row));
  END IF;

  IF v_decision = 'rejected' THEN
    v_status := 'rejected';
    v_text := 'تم رفض الاقتراح';
  ELSIF v_decision = 'accepted' THEN
    v_status := 'resolved';
    v_text := 'تم قبول الاقتراح';
  ELSE
    v_status := 'resolved';
    v_text := 'تم حل الشكوى';
  END IF;

  SELECT name INTO v_name FROM public.users WHERE id = v_uid;
  v_entry := jsonb_build_object(
    'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
    'author', COALESCE(v_name, 'الإدارة'),
    'role', v_role,
    'is_admin', true,
    'text', v_text,
    'is_system', true
  );

  UPDATE public.complaints
  SET status = v_status, resolved_at = now(), logs = logs || jsonb_build_array(v_entry), updated_at = now()
  WHERE id = p_complaint_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'complaint', to_jsonb(v_row));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_complaint(uuid, text) TO authenticated;

COMMIT;
