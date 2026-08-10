-- Security advisor: generate_complaint_number() was missing a pinned
-- search_path (every other new function in the complaints migration has one).

CREATE OR REPLACE FUNCTION public.generate_complaint_number()
RETURNS text
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  year_part text;
  seq_num int;
BEGIN
  year_part := TO_CHAR(NOW(), 'YYYY');
  seq_num := nextval('public.complaints_year_seq');
  RETURN 'C-' || year_part || '-' || LPAD(seq_num::text, 4, '0');
END;
$function$;
