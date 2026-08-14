-- Allow complaint replies to carry attachments (jsonb array of {n,p,t,...}).
-- Also let R2 visibility checks see keys stored inside complaint logs.

DROP FUNCTION IF EXISTS public.add_complaint_reply(uuid, text);

CREATE OR REPLACE FUNCTION public.add_complaint_reply(
  p_complaint_id uuid,
  p_text text,
  p_attachments jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := public.current_user_id();
  v_role text := public.current_user_role();
  v_name text;
  v_row public.complaints%ROWTYPE;
  v_text text := NULLIF(trim(COALESCE(p_text, '')), '');
  v_atts jsonb := COALESCE(p_attachments, '[]'::jsonb);
  v_entry jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;
  IF jsonb_typeof(v_atts) IS DISTINCT FROM 'array' THEN
    v_atts := '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(elem), '[]'::jsonb)
    INTO v_atts
  FROM jsonb_array_elements(v_atts) AS elem
  WHERE COALESCE(elem ->> 'p', elem ->> 'path', elem ->> 'u', elem ->> 'url') IS NOT NULL
    AND COALESCE(elem ->> '__anon', '') IS DISTINCT FROM 'true';

  IF v_text IS NULL AND jsonb_array_length(v_atts) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'اكتب نص الرد أو أرفق ملفاً');
  END IF;

  SELECT * INTO v_row FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'الشكوى غير موجودة');
  END IF;

  IF v_row.employee_id <> v_uid AND v_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا تملك صلاحية الرد على هذه الشكوى');
  END IF;

  IF v_row.status = 'resolved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'الشكوى محلولة — الرد مقفول');
  END IF;

  SELECT name INTO v_name FROM public.users WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'admin'
     AND EXISTS (
       SELECT 1
       FROM jsonb_array_elements(COALESCE(v_row.attachments, '[]'::jsonb)) AS elem
       WHERE (elem ->> '__anon') = 'true'
          OR (elem -> '__anon') = 'true'::jsonb
     )
  THEN
    v_name := 'مجهول';
  END IF;

  v_entry := jsonb_build_object(
    'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
    'author', COALESCE(v_name, 'مستخدم'),
    'role', v_role,
    'is_admin', (v_role = 'admin'),
    'text', COALESCE(v_text, ''),
    'attachments', v_atts
  );

  UPDATE public.complaints
  SET logs = logs || jsonb_build_array(v_entry), updated_at = now()
  WHERE id = p_complaint_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'complaint', to_jsonb(v_row));
END;
$function$;

GRANT EXECUTE ON FUNCTION public.add_complaint_reply(uuid, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.mirsad_user_can_see_attachment(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH fname AS (
    SELECT regexp_replace(COALESCE(p_key, ''), '^.*/', '') AS f
  )
  SELECT COALESCE((
    SELECT EXISTS (
      SELECT 1 FROM public.violations v, fname
      WHERE length(fname.f) > 0
        AND position(fname.f IN COALESCE(v.attachments::text, '')) > 0
    )
    OR EXISTS (
      SELECT 1 FROM public.complaints c, fname
      WHERE length(fname.f) > 0
        AND (
          position(fname.f IN COALESCE(c.attachments::text, '')) > 0
          OR position(fname.f IN COALESCE(c.logs::text, '')) > 0
        )
    )
  ), false);
$function$;
