drop function if exists "public"."get_remaining_seats"(p_performance_id smallint, p_schedule_id smallint);

alter table "public"."class_ticket_counters" enable row level security;

alter table "public"."gym_ticket_counters" enable row level security;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.issue_class_tickets_with_codes(p_user_id uuid, p_ticket_type_id integer, p_relationship_id integer, p_performance_id integer, p_schedule_id integer, p_issue_count integer, p_codes text[], p_signatures text[], p_person_count integer DEFAULT 1)
 RETURNS TABLE(code text, signature text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  i integer;
  v_ticket_id uuid;
  v_total_cap integer;
  v_junior_cap integer;
  v_is_released boolean;
  v_issued_gen integer;
  v_issued_jun integer;
  v_issued_other integer;
  v_need integer;
  v_rem_gen integer;
  v_rem_jun integer;
  v_rem_gen_raw integer;
  v_add_gen integer := 0;
  v_add_jun integer := 0;
  v_add_other integer := 0;
BEGIN
  IF p_issue_count IS NULL OR p_issue_count <= 0 THEN
    RAISE EXCEPTION 'issue_count must be positive';
  END IF;

  IF array_length(p_codes, 1) IS DISTINCT FROM p_issue_count
     OR array_length(p_signatures, 1) IS DISTINCT FROM p_issue_count THEN
    RAISE EXCEPTION 'codes/signatures length mismatch';
  END IF;

  v_need := p_issue_count * p_person_count;

  IF p_performance_id > 0 AND p_schedule_id > 0 THEN
    INSERT INTO public.class_ticket_counters (class_id, round_id)
    VALUES (p_performance_id, p_schedule_id)
    ON CONFLICT (class_id, round_id) DO NOTHING;

    SELECT
      cp.total_capacity,
      cp.junior_capacity,
      coalesce(cfg.junior_release_open, false),
      ctc.issued_general,
      ctc.issued_junior,
      ctc.issued_other
    INTO
      v_total_cap,
      v_junior_cap,
      v_is_released,
      v_issued_gen,
      v_issued_jun,
      v_issued_other
    FROM public.class_ticket_counters ctc
    JOIN public.class_performances cp ON cp.id = ctc.class_id
    CROSS JOIN LATERAL (
      SELECT c.junior_release_open
      FROM public.configs c
      ORDER BY c.id ASC
      LIMIT 1
    ) cfg
    WHERE ctc.class_id = p_performance_id
      AND ctc.round_id = p_schedule_id
    FOR UPDATE OF ctc;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'class ticket counter was not initialized';
    END IF;

    IF v_is_released THEN
      v_rem_gen := greatest(
        v_total_cap - v_issued_gen - v_issued_jun - v_issued_other,
        0
      );
      v_rem_jun := v_rem_gen;
    ELSE
      v_rem_gen_raw := (v_total_cap - v_junior_cap)
        - v_issued_gen
        - v_issued_other;
      v_rem_gen := greatest(v_rem_gen_raw, 0);
      v_rem_jun := greatest(
        v_junior_cap - v_issued_jun - greatest(-v_rem_gen_raw, 0),
        0
      );
    END IF;

    IF p_ticket_type_id = 5 THEN
      IF (v_is_released AND v_rem_gen < v_need)
         OR (NOT v_is_released AND v_rem_jun < v_need) THEN
        RAISE EXCEPTION '中学生用の予約枠が上限に達しました。';
      END IF;
      v_add_jun := v_need;
    ELSIF p_ticket_type_id = 8 THEN
      IF (v_rem_gen + v_rem_jun) < v_need THEN
        RAISE EXCEPTION 'この公演はすでに満席です。';
      END IF;
      v_add_gen := v_need;
    ELSIF p_ticket_type_id = 1 THEN
      IF v_rem_gen < v_need THEN
        RAISE EXCEPTION '招待券用の残席がありません。';
      END IF;
      v_add_gen := v_need;
    ELSE
      IF (v_rem_gen + v_rem_jun) < v_need THEN
        RAISE EXCEPTION '規定の定員を超過しています。';
      END IF;
      v_add_other := v_need;
    END IF;

    UPDATE public.class_ticket_counters
    SET
      issued_general = issued_general + v_add_gen,
      issued_junior = issued_junior + v_add_jun,
      issued_other = issued_other + v_add_other,
      updated_at = now()
    WHERE class_id = p_performance_id
      AND round_id = p_schedule_id;
  END IF;

  FOR i IN 1..p_issue_count LOOP
    INSERT INTO public.tickets (
      user_id,
      ticket_type,
      relationship,
      status,
      code,
      signature,
      person_count
    )
    VALUES (
      p_user_id,
      p_ticket_type_id,
      p_relationship_id,
      'valid',
      p_codes[i],
      p_signatures[i],
      p_person_count
    )
    RETURNING id INTO v_ticket_id;

    IF p_performance_id > 0 AND p_schedule_id > 0 THEN
      INSERT INTO public.class_tickets (id, class_id, round_id)
      VALUES (v_ticket_id, p_performance_id, p_schedule_id);
    END IF;
  END LOOP;

  RETURN QUERY SELECT unnest(p_codes), unnest(p_signatures);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.issue_gym_tickets_with_codes(p_user_id uuid, p_ticket_type_id smallint, p_relationship_id smallint, p_performance_id smallint, p_schedule_id smallint, p_issue_count smallint, p_codes text[], p_signatures text[], p_person_count smallint DEFAULT 1)
 RETURNS TABLE(code text, signature text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  i integer;
  v_ticket_id uuid;
  v_capacity integer;
  v_issued_count integer;
  v_need integer;
BEGIN
  IF p_issue_count IS NULL OR p_issue_count <= 0 THEN
    RAISE EXCEPTION 'issue_count must be positive';
  END IF;

  IF array_length(p_codes, 1) IS DISTINCT FROM p_issue_count
     OR array_length(p_signatures, 1) IS DISTINCT FROM p_issue_count THEN
    RAISE EXCEPTION 'codes/signatures length mismatch';
  END IF;

  v_need := p_issue_count * p_person_count;

  INSERT INTO public.gym_ticket_counters (performance_id)
  VALUES (p_performance_id)
  ON CONFLICT (performance_id) DO NOTHING;

  SELECT gp.capacity, gtc.issued_count
  INTO v_capacity, v_issued_count
  FROM public.gym_ticket_counters gtc
  JOIN public.gym_performances gp ON gp.id = gtc.performance_id
  WHERE gtc.performance_id = p_performance_id
  FOR UPDATE OF gtc;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'gym ticket counter was not initialized';
  END IF;

  IF v_issued_count + v_need > v_capacity THEN
    RAISE EXCEPTION '体育館公演の定員を超過しています。';
  END IF;

  UPDATE public.gym_ticket_counters
  SET
    issued_count = issued_count + v_need,
    updated_at = now()
  WHERE performance_id = p_performance_id;

  FOR i IN 1..p_issue_count LOOP
    INSERT INTO public.tickets (
      user_id,
      ticket_type,
      relationship,
      status,
      code,
      signature,
      person_count
    )
    VALUES (
      p_user_id,
      p_ticket_type_id,
      p_relationship_id,
      'valid',
      p_codes[i],
      p_signatures[i],
      p_person_count
    )
    RETURNING id INTO v_ticket_id;

    INSERT INTO public.gym_tickets (id, performance_id)
    VALUES (v_ticket_id, p_performance_id);
  END LOOP;

  RETURN QUERY SELECT unnest(p_codes), unnest(p_signatures);
END;
$function$
;


  create policy "Enable read access for all users"
  on "public"."class_ticket_counters"
  as permissive
  for select
  to public
using (true);



  create policy "Enable read access for all users"
  on "public"."gym_ticket_counters"
  as permissive
  for select
  to public
using (true);



