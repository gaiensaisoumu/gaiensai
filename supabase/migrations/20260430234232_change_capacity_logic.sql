-- クラス公演券の発行関数を、厳密な定員チェックとロック付きで更新
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
  v_rem_gen integer;
  v_rem_jun integer;
  v_is_released boolean;
BEGIN
  -- 1. 残数の確認 (入場専用券でない場合のみ)
  IF p_performance_id > 0 AND p_schedule_id > 0 THEN
    -- 同時実行によるオーバーブッキングを防ぐため、対象の公演レコードをロック
    PERFORM 1 FROM public.class_performances WHERE id = p_performance_id FOR UPDATE;

    -- get_remaining_seats を呼び出して最新の残数を計算
    SELECT remaining_general, remaining_junior
    INTO v_rem_gen, v_rem_jun
    FROM public.get_remaining_seats(p_performance_id::smallint, p_schedule_id::smallint);

    -- 枠の解放状態を確認
    SELECT junior_release_open INTO v_is_released FROM public.configs LIMIT 1;

    -- チケットタイプに応じた厳密な残数チェック
    IF p_ticket_type_id = 5 THEN
      -- 中学生チケットの場合
      -- 解放後は general 枠（全合計が入っている）を、解放前は junior 枠をチェック
      IF (v_is_released AND v_rem_gen < (p_issue_count * p_person_count)) OR (NOT v_is_released AND v_rem_jun < (p_issue_count * p_person_count)) THEN
        RAISE EXCEPTION '中学生用の予約枠が上限に達しました。';
      END IF;
    ELSIF p_ticket_type_id = 8 THEN
      -- 当日券（ID: 8）の場合
      IF v_rem_gen + v_rem_jun < (p_issue_count * p_person_count) THEN
        RAISE EXCEPTION 'この公演はすでに満席です。';
      END IF;
    ELSIF p_ticket_type_id = 1 THEN
      -- 一般チケットの場合
      IF v_rem_gen < (p_issue_count * p_person_count) THEN
        RAISE EXCEPTION '招待券用の残席がありません。';
      END IF;
    ELSE
      -- その他のチケットタイプ（入場券など）は合計で判定
      IF (v_rem_gen + v_rem_jun) < (p_issue_count * p_person_count) THEN
        RAISE EXCEPTION '規定の定員を超過しています。';
      END IF;
    END IF;
  END IF;

  -- 2. 発券処理
  FOR i IN 1..p_issue_count LOOP
    INSERT INTO public.tickets (user_id, ticket_type, relationship, status, code, signature, person_count)
    VALUES (p_user_id, p_ticket_type_id, p_relationship_id, 'valid', p_codes[i], p_signatures[i], p_person_count)
    RETURNING id INTO v_ticket_id;

    IF p_performance_id > 0 AND p_schedule_id > 0 THEN
      INSERT INTO public.class_tickets (id, class_id, round_id)
      VALUES (v_ticket_id, p_performance_id, p_schedule_id);
    END IF;
  END LOOP;

  RETURN QUERY SELECT unnest(p_codes), unnest(p_signatures);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."get_remaining_seats"("p_performance_id" smallint, "p_schedule_id" smallint) RETURNS TABLE("remaining_general" integer, "remaining_junior" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  total_cap int;
  junior_cap int;
  issued_gen_sameday int;
  junior_count int;
  is_released boolean;
  v_physical_gen_cap int;
  v_rem_gen_raw int;
begin
  select cp.total_capacity, cp.junior_capacity
  into total_cap, junior_cap
  from public.class_performances cp
  where cp.id = p_performance_id
  limit 1;

  if total_cap is null or junior_cap is null then
    return query select 0, 0;
    return;
  end if;

  select c.junior_release_open
  into is_released
  from public.configs c
  order by c.id asc
  limit 1;

  select
    -- 一般(1)と当日券(8)の合計
    coalesce(sum(t.person_count) filter (where t.ticket_type in (1, 8) and t.status = 'valid'), 0)::int,
    -- 中学生(5)の合計
    coalesce(sum(t.person_count) filter (where t.ticket_type = 5 and t.status = 'valid'), 0)::int
  into issued_gen_sameday, junior_count
  from public.class_tickets ct
  join public.tickets t on t.id = ct.id
  where ct.class_id = p_performance_id
    and ct.round_id = p_schedule_id;

  junior_count := coalesce(junior_count, 0);
  is_released := coalesce(is_released, false);

  if is_released then
    return query
    select
      greatest(total_cap - issued_gen_sameday - junior_count, 0),
      greatest(total_cap - issued_gen_sameday - junior_count, 0); -- 解放後は全合計を参照
  else
    -- 物理的な一般枠のキャパシティ
    v_physical_gen_cap := total_cap - junior_cap;
    -- 一般・当日券による一般枠の残数（マイナスは中学生枠への侵食を意味する）
    v_rem_gen_raw := v_physical_gen_cap - issued_gen_sameday;

    return query
    select
      -- 一般枠の表示上の残数（0以下にはしない）
      greatest(v_rem_gen_raw, 0),
      -- 中学生枠の残数 = 本来の枠 - 発行済み中学生券 - (一般枠からはみ出した当日券)
      greatest(junior_cap - junior_count - greatest(-v_rem_gen_raw, 0), 0);
  end if;
end;
$$;
