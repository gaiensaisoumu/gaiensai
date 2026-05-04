-- Reduce ticket issuing contention by replacing per-request aggregate counts
-- with per-performance capacity counters.

CREATE INDEX IF NOT EXISTS class_tickets_class_round_id_idx
  ON public.class_tickets USING btree (class_id, round_id, id);

CREATE INDEX IF NOT EXISTS gym_tickets_performance_id_id_idx
  ON public.gym_tickets USING btree (performance_id, id);

CREATE INDEX IF NOT EXISTS tickets_user_valid_type_idx
  ON public.tickets USING btree (user_id, ticket_type)
  WHERE status = 'valid';

CREATE INDEX IF NOT EXISTS tickets_valid_id_type_person_idx
  ON public.tickets USING btree (id, ticket_type, person_count)
  WHERE status = 'valid';

CREATE TABLE IF NOT EXISTS public.class_ticket_counters (
  class_id smallint NOT NULL,
  round_id smallint NOT NULL,
  issued_general integer NOT NULL DEFAULT 0,
  issued_junior integer NOT NULL DEFAULT 0,
  issued_other integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, round_id),
  FOREIGN KEY (class_id) REFERENCES public.class_performances(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  FOREIGN KEY (round_id) REFERENCES public.performances_schedule(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CHECK (issued_general >= 0),
  CHECK (issued_junior >= 0),
  CHECK (issued_other >= 0)
);

CREATE TABLE IF NOT EXISTS public.gym_ticket_counters (
  performance_id smallint PRIMARY KEY REFERENCES public.gym_performances(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  issued_count integer NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CHECK (issued_count >= 0)
);

GRANT SELECT ON TABLE public.class_ticket_counters TO anon, authenticated;
GRANT SELECT ON TABLE public.gym_ticket_counters TO anon, authenticated;
GRANT ALL ON TABLE public.class_ticket_counters TO service_role;
GRANT ALL ON TABLE public.gym_ticket_counters TO service_role;

INSERT INTO public.class_ticket_counters (
  class_id,
  round_id,
  issued_general,
  issued_junior,
  issued_other
)
SELECT
  ct.class_id,
  ct.round_id,
  coalesce(sum(t.person_count) FILTER (
    WHERE t.status = 'valid' AND t.ticket_type IN (1, 8)
  ), 0)::integer AS issued_general,
  coalesce(sum(t.person_count) FILTER (
    WHERE t.status = 'valid' AND t.ticket_type = 5
  ), 0)::integer AS issued_junior,
  coalesce(sum(t.person_count) FILTER (
    WHERE t.status = 'valid' AND t.ticket_type NOT IN (1, 5, 8)
  ), 0)::integer AS issued_other
FROM public.class_tickets ct
JOIN public.tickets t ON t.id = ct.id
GROUP BY ct.class_id, ct.round_id
ON CONFLICT (class_id, round_id) DO UPDATE
SET
  issued_general = EXCLUDED.issued_general,
  issued_junior = EXCLUDED.issued_junior,
  issued_other = EXCLUDED.issued_other,
  updated_at = now();

INSERT INTO public.gym_ticket_counters (performance_id, issued_count)
SELECT
  gt.performance_id,
  coalesce(sum(t.person_count) FILTER (WHERE t.status = 'valid'), 0)::integer
FROM public.gym_tickets gt
JOIN public.tickets t ON t.id = gt.id
GROUP BY gt.performance_id
ON CONFLICT (performance_id) DO UPDATE
SET
  issued_count = EXCLUDED.issued_count,
  updated_at = now();

CREATE OR REPLACE FUNCTION public.get_remaining_seats(
  p_performance_id smallint,
  p_schedule_id smallint
) RETURNS TABLE(remaining_general integer, remaining_junior integer)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  total_cap integer;
  junior_cap integer;
  is_released boolean;
  issued_gen integer;
  issued_jun integer;
  issued_other_count integer;
  physical_general_cap integer;
  rem_gen_raw integer;
BEGIN
  SELECT cp.total_capacity, cp.junior_capacity
  INTO total_cap, junior_cap
  FROM public.class_performances cp
  WHERE cp.id = p_performance_id
  LIMIT 1;

  IF total_cap IS NULL OR junior_cap IS NULL THEN
    RETURN QUERY SELECT 0, 0;
    RETURN;
  END IF;

  SELECT coalesce(c.junior_release_open, false)
  INTO is_released
  FROM public.configs c
  ORDER BY c.id ASC
  LIMIT 1;

  SELECT
    coalesce(ctc.issued_general, 0),
    coalesce(ctc.issued_junior, 0),
    coalesce(ctc.issued_other, 0)
  INTO issued_gen, issued_jun, issued_other_count
  FROM public.class_ticket_counters ctc
  WHERE ctc.class_id = p_performance_id
    AND ctc.round_id = p_schedule_id;

  issued_gen := coalesce(issued_gen, 0);
  issued_jun := coalesce(issued_jun, 0);
  issued_other_count := coalesce(issued_other_count, 0);
  is_released := coalesce(is_released, false);

  IF is_released THEN
    RETURN QUERY
    SELECT
      greatest(total_cap - issued_gen - issued_jun - issued_other_count, 0),
      greatest(total_cap - issued_gen - issued_jun - issued_other_count, 0);
  ELSE
    physical_general_cap := total_cap - junior_cap;
    rem_gen_raw := physical_general_cap - issued_gen - issued_other_count;

    RETURN QUERY
    SELECT
      greatest(rem_gen_raw, 0),
      greatest(junior_cap - issued_jun - greatest(-rem_gen_raw, 0), 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_class_ticket_counter_for_ticket_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_class_id smallint;
  v_round_id smallint;
  old_general integer := 0;
  old_junior integer := 0;
  old_other integer := 0;
  new_general integer := 0;
  new_junior integer := 0;
  new_other integer := 0;
BEGIN
  SELECT ct.class_id, ct.round_id
  INTO v_class_id, v_round_id
  FROM public.class_tickets ct
  WHERE ct.id = NEW.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'valid' THEN
    IF OLD.ticket_type IN (1, 8) THEN
      old_general := OLD.person_count;
    ELSIF OLD.ticket_type = 5 THEN
      old_junior := OLD.person_count;
    ELSE
      old_other := OLD.person_count;
    END IF;
  END IF;

  IF NEW.status = 'valid' THEN
    IF NEW.ticket_type IN (1, 8) THEN
      new_general := NEW.person_count;
    ELSIF NEW.ticket_type = 5 THEN
      new_junior := NEW.person_count;
    ELSE
      new_other := NEW.person_count;
    END IF;
  END IF;

  IF old_general = new_general
     AND old_junior = new_junior
     AND old_other = new_other THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.class_ticket_counters (
    class_id,
    round_id,
    issued_general,
    issued_junior,
    issued_other
  )
  VALUES (
    v_class_id,
    v_round_id,
    greatest(new_general - old_general, 0),
    greatest(new_junior - old_junior, 0),
    greatest(new_other - old_other, 0)
  )
  ON CONFLICT (class_id, round_id) DO UPDATE
  SET
    issued_general = greatest(
      public.class_ticket_counters.issued_general
        + new_general - old_general,
      0
    ),
    issued_junior = greatest(
      public.class_ticket_counters.issued_junior
        + new_junior - old_junior,
      0
    ),
    issued_other = greatest(
      public.class_ticket_counters.issued_other
        + new_other - old_other,
      0
    ),
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_gym_ticket_counter_for_ticket_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_performance_id smallint;
  old_count integer := 0;
  new_count integer := 0;
BEGIN
  SELECT gt.performance_id
  INTO v_performance_id
  FROM public.gym_tickets gt
  WHERE gt.id = NEW.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'valid' THEN
    old_count := OLD.person_count;
  END IF;

  IF NEW.status = 'valid' THEN
    new_count := NEW.person_count;
  END IF;

  IF old_count = new_count THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.gym_ticket_counters (performance_id, issued_count)
  VALUES (v_performance_id, greatest(new_count - old_count, 0))
  ON CONFLICT (performance_id) DO UPDATE
  SET
    issued_count = greatest(
      public.gym_ticket_counters.issued_count + new_count - old_count,
      0
    ),
    updated_at = now();

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_class_ticket_counter_for_mapping_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ticket public.tickets%ROWTYPE;
  v_general integer := 0;
  v_junior integer := 0;
  v_other integer := 0;
BEGIN
  SELECT *
  INTO v_ticket
  FROM public.tickets
  WHERE id = OLD.id
  LIMIT 1;

  IF NOT FOUND OR v_ticket.status IS DISTINCT FROM 'valid' THEN
    RETURN OLD;
  END IF;

  IF v_ticket.ticket_type IN (1, 8) THEN
    v_general := v_ticket.person_count;
  ELSIF v_ticket.ticket_type = 5 THEN
    v_junior := v_ticket.person_count;
  ELSE
    v_other := v_ticket.person_count;
  END IF;

  UPDATE public.class_ticket_counters
  SET
    issued_general = greatest(issued_general - v_general, 0),
    issued_junior = greatest(issued_junior - v_junior, 0),
    issued_other = greatest(issued_other - v_other, 0),
    updated_at = now()
  WHERE class_id = OLD.class_id
    AND round_id = OLD.round_id;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION public.adjust_gym_ticket_counter_for_mapping_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status public.ticket_status;
  v_person_count integer;
BEGIN
  SELECT status, person_count
  INTO v_status, v_person_count
  FROM public.tickets
  WHERE id = OLD.id
  LIMIT 1;

  IF NOT FOUND OR v_status IS DISTINCT FROM 'valid' THEN
    RETURN OLD;
  END IF;

  UPDATE public.gym_ticket_counters
  SET
    issued_count = greatest(issued_count - v_person_count, 0),
    updated_at = now()
  WHERE performance_id = OLD.performance_id;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tickets_class_capacity_counter_update
  ON public.tickets;

CREATE TRIGGER tickets_class_capacity_counter_update
AFTER UPDATE OF status, ticket_type, person_count ON public.tickets
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.ticket_type IS DISTINCT FROM NEW.ticket_type
  OR OLD.person_count IS DISTINCT FROM NEW.person_count
)
EXECUTE FUNCTION public.adjust_class_ticket_counter_for_ticket_update();

DROP TRIGGER IF EXISTS tickets_gym_capacity_counter_update
  ON public.tickets;

CREATE TRIGGER tickets_gym_capacity_counter_update
AFTER UPDATE OF status, person_count ON public.tickets
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status
  OR OLD.person_count IS DISTINCT FROM NEW.person_count
)
EXECUTE FUNCTION public.adjust_gym_ticket_counter_for_ticket_update();

DROP TRIGGER IF EXISTS class_tickets_capacity_counter_delete
  ON public.class_tickets;

CREATE TRIGGER class_tickets_capacity_counter_delete
BEFORE DELETE ON public.class_tickets
FOR EACH ROW
EXECUTE FUNCTION public.adjust_class_ticket_counter_for_mapping_delete();

DROP TRIGGER IF EXISTS gym_tickets_capacity_counter_delete
  ON public.gym_tickets;

CREATE TRIGGER gym_tickets_capacity_counter_delete
BEFORE DELETE ON public.gym_tickets
FOR EACH ROW
EXECUTE FUNCTION public.adjust_gym_ticket_counter_for_mapping_delete();

CREATE OR REPLACE FUNCTION public.issue_class_tickets_with_codes(
  p_user_id uuid,
  p_ticket_type_id integer,
  p_relationship_id integer,
  p_performance_id integer,
  p_schedule_id integer,
  p_issue_count integer,
  p_codes text[],
  p_signatures text[],
  p_person_count integer DEFAULT 1
) RETURNS TABLE(code text, signature text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.issue_gym_tickets_with_codes(
  p_user_id uuid,
  p_ticket_type_id smallint,
  p_relationship_id smallint,
  p_performance_id smallint,
  p_schedule_id smallint,
  p_issue_count smallint,
  p_codes text[],
  p_signatures text[],
  p_person_count smallint DEFAULT 1
) RETURNS TABLE(code text, signature text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;
