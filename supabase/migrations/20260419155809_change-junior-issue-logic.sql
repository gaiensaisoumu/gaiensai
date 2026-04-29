drop function if exists "public"."issue_class_tickets_with_codes"(p_user_id uuid, p_ticket_type_id smallint, p_relationship_id smallint, p_performance_id smallint, p_schedule_id smallint, p_issue_count integer, p_codes text[], p_signatures text[]);

drop function if exists "public"."issue_gym_tickets_with_codes"(p_user_id uuid, p_ticket_type_id smallint, p_relationship_id smallint, p_performance_id smallint, p_schedule_id smallint, p_issue_count integer, p_codes text[], p_signatures text[]);

drop function if exists "public"."reissue_gym_ticket_change_relationship_with_codes"(p_user_id uuid, p_old_code text, p_ticket_type_id smallint, p_performance_id smallint, p_schedule_id smallint, p_new_relationship_id smallint, p_issue_count integer, p_codes text[], p_signatures text[]);

drop function if exists "public"."reissue_ticket_change_relationship_with_codes"(p_user_id uuid, p_old_code text, p_ticket_type_id smallint, p_performance_id smallint, p_schedule_id smallint, p_new_relationship_id smallint, p_issue_count integer, p_codes text[], p_signatures text[]);

alter table "public"."tickets" add column "person_count" smallint not null default 1;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.issue_class_tickets_with_codes(p_user_id uuid, p_ticket_type_id smallint, p_relationship_id smallint, p_performance_id smallint, p_schedule_id smallint, p_issue_count smallint, p_codes text[], p_signatures text[], p_person_count smallint DEFAULT 1)
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
    INSERT INTO public.tickets (user_id, ticket_type, relationship, status, code, signature, person_count)
    VALUES (p_user_id, p_ticket_type_id, p_relationship_id, 'valid', p_codes[i], p_signatures[i], p_person_count)
    RETURNING id INTO v_ticket_id;

    INSERT INTO public.class_tickets (id, class_id, round_id)
    VALUES (v_ticket_id, p_performance_id, p_schedule_id);
  END LOOP;
  RETURN QUERY SELECT unnest(p_codes), unnest(p_signatures);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_gym_tickets_with_codes(p_user_id uuid, p_ticket_type_id smallint, p_relationship_id smallint, p_performance_id smallint, p_schedule_id smallint, p_issue_count smallint, p_codes text[], p_signatures text[], p_person_count smallint DEFAULT 1)
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
    INSERT INTO public.tickets (user_id, ticket_type, relationship, status, code, signature, person_count)
    VALUES (p_user_id, p_ticket_type_id, p_relationship_id, 'valid', p_codes[i], p_signatures[i], p_person_count)
    RETURNING id INTO v_ticket_id;

    INSERT INTO public.gym_tickets (id, performance_id)
    VALUES (v_ticket_id, p_performance_id);
  END LOOP;
  RETURN QUERY SELECT unnest(p_codes), unnest(p_signatures);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reissue_gym_ticket_change_relationship_with_codes(p_user_id uuid, p_old_code text, p_ticket_type_id smallint, p_performance_id smallint, p_schedule_id smallint, p_new_relationship_id smallint, p_issue_count smallint, p_codes text[], p_signatures text[], p_person_count smallint DEFAULT 1)
 RETURNS TABLE(code text, signature text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  UPDATE public.tickets SET status = 'cancelled' WHERE code = p_old_code AND user_id = p_user_id;
  RETURN QUERY SELECT * FROM public.issue_gym_tickets_with_codes(
    p_user_id, p_ticket_type_id, p_new_relationship_id, p_performance_id, p_schedule_id, p_issue_count, p_codes, p_signatures, p_person_count
  );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reissue_ticket_change_relationship_with_codes(p_user_id uuid, p_old_code text, p_ticket_type_id smallint, p_performance_id smallint, p_schedule_id smallint, p_new_relationship_id smallint, p_issue_count smallint, p_codes text[], p_signatures text[], p_person_count smallint DEFAULT 1)
 RETURNS TABLE(code text, signature text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  UPDATE public.tickets SET status = 'cancelled' WHERE code = p_old_code AND user_id = p_user_id;
  RETURN QUERY SELECT * FROM public.issue_class_tickets_with_codes(
    p_user_id, p_ticket_type_id, p_new_relationship_id, p_performance_id, p_schedule_id, p_issue_count, p_codes, p_signatures, p_person_count
  );
END;
$function$
;
