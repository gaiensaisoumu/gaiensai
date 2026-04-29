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
declare
  v_ticket_id uuid;
  v_owner_id uuid;
  v_status public.ticket_status;
  v_ticket_type smallint;
  v_performance_id smallint;
begin
  if p_user_id is null then
    raise exception 'user is required';
  end if;

  if p_old_code is null or length(trim(p_old_code)) = 0 then
    raise exception 'old_code is required';
  end if;

  if p_issue_count is null or p_issue_count <> 1 then
    raise exception 'issue_count must be 1';
  end if;

  if p_codes is null or p_signatures is null then
    raise exception 'codes/signatures are required';
  end if;

  if array_length(p_codes, 1) is distinct from p_issue_count
     or array_length(p_signatures, 1) is distinct from p_issue_count then
    raise exception 'codes/signatures length mismatch';
  end if;

  if p_new_relationship_id is null or p_new_relationship_id <= 0 then
    raise exception 'new_relationship_id must be positive';
  end if;

  if p_performance_id <= 0 or p_schedule_id <> 0 then
    raise exception 'gym ticket reissue requires performance_id > 0 and schedule_id = 0';
  end if;

  select t.id, t.user_id, t.status, t.ticket_type
    into v_ticket_id, v_owner_id, v_status, v_ticket_type
  from public.tickets as t
  where t.code = p_old_code
  limit 1
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;

  if v_owner_id is distinct from p_user_id then
    raise exception 'only the ticket owner may reissue the ticket';
  end if;

  if v_status is distinct from 'valid' then
    raise exception 'only valid tickets can be reissued';
  end if;

  if v_ticket_type is distinct from p_ticket_type_id then
    raise exception 'ticket_type mismatch';
  end if;

  select performance_id
    into v_performance_id
  from public.gym_tickets
  where id = v_ticket_id
  limit 1
  for update;

  if not found then
    raise exception 'gym ticket mapping not found';
  end if;

  if v_performance_id is distinct from p_performance_id then
    raise exception 'performance mismatch';
  end if;

  update public.tickets
    set status = 'cancelled', updated_at = now()
  where id = v_ticket_id;

  return query
    select it.code, it.signature
    from public.issue_gym_tickets_with_codes(
      p_user_id,
      p_ticket_type_id,
      p_new_relationship_id,
      p_performance_id,
      p_schedule_id,
      p_issue_count,
      p_codes,
      p_signatures,
      p_person_count
    ) as it;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reissue_ticket_change_relationship_with_codes(p_user_id uuid, p_old_code text, p_ticket_type_id smallint, p_performance_id smallint, p_schedule_id smallint, p_new_relationship_id smallint, p_issue_count smallint, p_codes text[], p_signatures text[], p_person_count smallint DEFAULT 1)
 RETURNS TABLE(code text, signature text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
declare
  v_ticket_id uuid;
  v_owner_id uuid;
  v_status public.ticket_status;
  v_ticket_type smallint;
  v_class_id smallint;
  v_round_id smallint;
begin
  if p_user_id is null then
    raise exception 'user is required';
  end if;

  if p_old_code is null or length(trim(p_old_code)) = 0 then
    raise exception 'old_code is required';
  end if;

  if p_issue_count is null or p_issue_count <> 1 then
    raise exception 'issue_count must be 1';
  end if;

  if p_codes is null or p_signatures is null then
    raise exception 'codes/signatures are required';
  end if;

  if array_length(p_codes, 1) is distinct from p_issue_count
     or array_length(p_signatures, 1) is distinct from p_issue_count then
    raise exception 'codes/signatures length mismatch';
  end if;

  if p_new_relationship_id is null or p_new_relationship_id <= 0 then
    raise exception 'new_relationship_id must be positive';
  end if;

  select t.id, t.user_id, t.status, t.ticket_type
    into v_ticket_id, v_owner_id, v_status, v_ticket_type
  from public.tickets as t
  where t.code = p_old_code
  limit 1
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;

  if v_owner_id is distinct from p_user_id then
    raise exception 'only the ticket owner may reissue the ticket';
  end if;

  if v_status is distinct from 'valid' then
    raise exception 'only valid tickets can be reissued';
  end if;

  if v_ticket_type is distinct from p_ticket_type_id then
    raise exception 'ticket_type mismatch';
  end if;

  if p_ticket_type_id = 4 then
    if p_performance_id <> 0 or p_schedule_id <> 0 then
      raise exception 'admission-only ticket requires performanceId=0 and scheduleId=0';
    end if;
  else
    select class_id, round_id
      into v_class_id, v_round_id
    from public.class_tickets
    where id = v_ticket_id
    limit 1
    for update;

    if not found then
      raise exception 'class ticket mapping not found';
    end if;

    if v_class_id is distinct from p_performance_id or v_round_id is distinct from p_schedule_id then
      raise exception 'performance/schedule mismatch';
    end if;
  end if;

  update public.tickets
    set status = 'cancelled', updated_at = now()
  where id = v_ticket_id;

  return query
    select it.code, it.signature
    from public.issue_class_tickets_with_codes(
      p_user_id,
      p_ticket_type_id,
      p_new_relationship_id,
      p_performance_id,
      p_schedule_id,
      p_issue_count,
      p_codes,
      p_signatures,
      p_person_count
    ) as it;
end;
$function$
;
