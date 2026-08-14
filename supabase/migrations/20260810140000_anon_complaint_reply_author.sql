-- Mask employee author as مجهول when replying to an anonymous complaint/suggestion.
CREATE OR REPLACE FUNCTION public.add_complaint_reply(
  p_complaint_id uuid,
  p_text text
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
  v_entry jsonb;
  v_is_admin boolean;
  v_is_anon boolean := false;
  v_author text;
BEGIN
  IF v_uid IS NULL OR NOT public.current_user_is_active() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'يجب تسجيل الدخول');
  END IF;
  IF v_text IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'اكتب نص الرد');
  END IF;

  SELECT * INTO v_row FROM public.complaints WHERE id = p_complaint_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'الشكوى غير موجودة');
  END IF;

  IF v_row.employee_id <> v_uid AND v_role IS DISTINCT FROM 'admin' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'لا تملك صلاحية الرد على هذه الشكوى');
  END IF;

  v_is_admin := (v_role = 'admin');
  -- Anonymous flag is stored in attachments as { "__anon": true }
  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(v_row.attachments, '[]'::jsonb)) AS a
    WHERE (a.value ->> '__anon') = 'true'
       OR (a.value -> '__anon') = 'true'::jsonb
  ) INTO v_is_anon;

  SELECT name INTO v_name FROM public.users WHERE id = v_uid;
  IF v_is_anon AND NOT v_is_admin THEN
    v_author := 'مجهول';
  ELSE
    v_author := COALESCE(v_name, 'مستخدم');
  END IF;

  v_entry := jsonb_build_object(
    'at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'),
    'author', v_author,
    'role', v_role,
    'is_admin', v_is_admin,
    'text', v_text
  );

  UPDATE public.complaints
  SET logs = logs || jsonb_build_array(v_entry), updated_at = now()
  WHERE id = p_complaint_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'complaint', to_jsonb(v_row));
END;
$function$;

-- Scrub existing non-admin reply authors on anonymous tickets.
UPDATE public.complaints c
SET logs = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN COALESCE((e.value ->> 'is_admin')::boolean, false) = false
        THEN jsonb_set(e.value, '{author}', '"مجهول"'::jsonb, true)
      ELSE e.value
    END
    ORDER BY e.ordinality
  ), '[]'::jsonb)
  FROM jsonb_array_elements(COALESCE(c.logs, '[]'::jsonb)) WITH ORDINALITY AS e(value, ordinality)
),
updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(COALESCE(c.attachments, '[]'::jsonb)) AS a
  WHERE (a.value ->> '__anon') = 'true'
     OR (a.value -> '__anon') = 'true'::jsonb
);
