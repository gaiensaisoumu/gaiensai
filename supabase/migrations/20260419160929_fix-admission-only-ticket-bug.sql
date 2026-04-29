drop function if exists "public"."issue_class_tickets_with_codes"(p_user_id uuid, p_ticket_type_id smallint, p_relationship_id smallint, p_performance_id smallint, p_schedule_id smallint, p_issue_count smallint, p_codes text[], p_signatures text[], p_person_count smallint);

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.issue_class_tickets_with_codes(p_user_id uuid, p_ticket_type_id integer, p_relationship_id integer, p_performance_id integer, p_schedule_id integer, p_issue_count integer, p_codes text[], p_signatures text[], p_person_count integer DEFAULT 1)
 RETURNS TABLE(code text, signature text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  i integer;
  v_ticket_id uuid;
BEGIN
  FOR i IN 1..p_issue_count LOOP
    -- 1. ticketsテーブルに基本情報を登録
    INSERT INTO public.tickets (user_id, ticket_type, relationship, status, code, signature, person_count)
    VALUES (p_user_id, p_ticket_type_id, p_relationship_id, 'valid', p_codes[i], p_signatures[i], p_person_count)
    RETURNING id INTO v_ticket_id;

    -- 2. 入場専用券（performance_id=0, schedule_id=0）でない場合のみ、class_ticketsに紐付けを登録
    -- これにより、外部キー制約違反を回避します。
    IF p_performance_id > 0 AND p_schedule_id > 0 THEN
      INSERT INTO public.class_tickets (id, class_id, round_id)
      VALUES (v_ticket_id, p_performance_id, p_schedule_id);
    END IF;
  END LOOP;
  RETURN QUERY SELECT unnest(p_codes), unnest(p_signatures);
END;
$function$
;
