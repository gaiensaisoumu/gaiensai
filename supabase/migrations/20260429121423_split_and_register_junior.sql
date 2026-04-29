


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."rehearsal_type" AS ENUM (
    'official',
    'unofficial'
);


ALTER TYPE "public"."rehearsal_type" OWNER TO "postgres";


CREATE TYPE "public"."ticket_status" AS ENUM (
    'valid',
    'cancelled',
    'used'
);


ALTER TYPE "public"."ticket_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_own_ticket_by_code"("p_code" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_id uuid;
  v_user uuid;
  v_status public.ticket_status;
begin
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'code is required';
  end if;

  select id, user_id, status
  into v_id, v_user, v_status
  from public.tickets
  where code = p_code
  limit 1
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;

  -- only the owner may cancel their ticket
  if v_user is null or v_user <> auth.uid() then
    raise exception 'only the ticket owner may cancel the ticket';
  end if;

  if v_status is distinct from 'valid' then
    raise exception 'only valid tickets can be cancelled';
  end if;

  update public.tickets
  set status = 'cancelled', updated_at = now()
  where id = v_id;

  return true;
end;
$$;


ALTER FUNCTION "public"."cancel_own_ticket_by_code"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  -- 現在ログインしているユーザーのIDを取得し、auth.usersから削除
  delete from auth.users where id = auth.uid();
  delete from public.users where id = auth.uid();
end;
$$;


ALTER FUNCTION "public"."delete_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_remaining_seats"("p_performance_id" smallint, "p_schedule_id" smallint) RETURNS TABLE("remaining_general" integer, "remaining_junior" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  total_cap int;
  junior_cap int;
  general_count int;
  junior_count int;
  is_released boolean;
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
    count(*) filter (where t.ticket_type in (1, 3, 8) and t.status = 'valid')::int,
    count(*) filter (where t.ticket_type = 2 and t.status = 'valid')::int
  into general_count, junior_count
  from public.class_tickets ct
  join public.tickets t on t.id = ct.id
  where ct.class_id = p_performance_id
    and ct.round_id = p_schedule_id;

  general_count := coalesce(general_count, 0);
  junior_count := coalesce(junior_count, 0);
  is_released := coalesce(is_released, false);

  if is_released then
    return query
    select
      greatest(total_cap - general_count - junior_count, 0),
      0;
  else
    return query
    select
      greatest((total_cap - junior_cap) - general_count, 0),
      greatest(junior_cap - junior_count, 0);
  end if;
end;
$$;


ALTER FUNCTION "public"."get_remaining_seats"("p_performance_id" smallint, "p_schedule_id" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_by_email"("user_email" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN (SELECT id
          FROM auth.users
          WHERE email = user_email
          LIMIT 1);
END;
$$;


ALTER FUNCTION "public"."get_user_by_email"("user_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_ticket_code_counter"("p_prefix" "text", "p_increment" integer, "p_max_value" integer) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$declare
  v_last_value bigint;
begin
  if p_prefix is null or length(trim(p_prefix)) = 0 then
    raise exception 'prefix is required';
  end if;

  if p_increment is null or p_increment <= 0 then
    raise exception 'increment must be positive';
  end if;

  -- 1. 行が存在しない場合は初期化（既存なら何もしない）
  insert into public.ticket_code_counters (prefix, last_value)
  values (p_prefix, 0)
  on conflict (prefix) do nothing;

  -- 2. 条件付きでアップデート
  -- WHERE句で「更新後の値がp_max_value以下であること」を保証する
  update public.ticket_code_counters
  set last_value = last_value + p_increment,
      updated_at = now()
  where prefix = p_prefix
    and last_value + p_increment < p_max_value
  returning last_value into v_last_value;

  -- 3. v_last_value が null ということは、WHERE条件に合致しなかった（＝p_max_valueを超えた）ということ
  if v_last_value is null then
    raise exception 'The maximum number of cards that can be issued (% cards) has been exceeded. (Current limit: %)', p_max_value, p_max_value;
  end if;

  return v_last_value;
end;$$;


ALTER FUNCTION "public"."increment_ticket_code_counter"("p_prefix" "text", "p_increment" integer, "p_max_value" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_class_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" integer, "p_relationship_id" integer, "p_performance_id" integer, "p_schedule_id" integer, "p_issue_count" integer, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" integer DEFAULT 1) RETURNS TABLE("code" "text", "signature" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."issue_class_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" integer, "p_relationship_id" integer, "p_performance_id" integer, "p_schedule_id" integer, "p_issue_count" integer, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_gym_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" smallint, "p_relationship_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint DEFAULT 1) RETURNS TABLE("code" "text", "signature" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."issue_gym_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" smallint, "p_relationship_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."issue_junior_id"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  next_id int;
  min_id int := 100001;
  max_id int := 101919;
begin
  -- 同時実行による重複採番を防ぐ
  lock table public.users in share row exclusive mode;

  -- ロールが 'junior' の中から最大の affiliation を取得
  select coalesce(max(affiliation), min_id - 1) + 1 into next_id
  from public.users
  where role = 'junior';

  -- 上限チェック
  if next_id > max_id then
    raise exception 'ID_LIMIT_REACHED';
  end if;

  return next_id;
end;
$$;


ALTER FUNCTION "public"."issue_junior_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_junior"("junior_usage_type" smallint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  next_affiliation integer;
begin
  if junior_usage_type < 0 or junior_usage_type > 3 then
    raise exception 'INVALID_JUNIOR_USAGE_TYPE';
  end if;

  next_affiliation := public.issue_junior_id();

  insert into public.users (id, email, affiliation, role, clubs, junior_usage_type)
  values (
    auth.uid(),
    (select email from auth.users where id = auth.uid()),
    next_affiliation,
    'junior',
    null,
    junior_usage_type
  );
end;
$$;


ALTER FUNCTION "public"."register_junior"("junior_usage_type" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."register_student"("affiliation" integer, "clubs" "text"[] DEFAULT NULL::"text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.users (id, email, affiliation, role, clubs)
  VALUES (
    auth.uid(),
    (SELECT email FROM auth.users WHERE id = auth.uid()),
    affiliation,
    'student',
    clubs
  );
END;
$$;


ALTER FUNCTION "public"."register_student"("affiliation" integer, "clubs" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reissue_gym_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint DEFAULT 1) RETURNS TABLE("code" "text", "signature" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."reissue_gym_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reissue_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint DEFAULT 1) RETURNS TABLE("code" "text", "signature" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;


ALTER FUNCTION "public"."reissue_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rollback_ticket_code_counter"("p_prefix" "text", "p_decrement" integer, "p_expected_last_value" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_applied boolean;
begin
  if p_prefix is null or length(trim(p_prefix)) = 0 then
    raise exception 'prefix is required';
  end if;

  if p_decrement is null or p_decrement <= 0 then
    raise exception 'decrement must be positive';
  end if;

  if p_expected_last_value is null or p_expected_last_value < 0 then
    raise exception 'expected_last_value must be non-negative';
  end if;

  -- 巻き戻しは「このリクエストが更新した直後の値」のときだけ適用する。
  -- 他トランザクションで値が進んでいる場合は false を返し、カウンタを壊さない。
  update public.ticket_code_counters
  set
    last_value = last_value - p_decrement,
    updated_at = now()
  where prefix = p_prefix
    and last_value = p_expected_last_value
    and last_value - p_decrement >= 0
  returning true into v_applied;

  return coalesce(v_applied, false);
end;
$$;


ALTER FUNCTION "public"."rollback_ticket_code_counter"("p_prefix" "text", "p_decrement" integer, "p_expected_last_value" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
    v_junior_id uuid := auth.uid();
    v_junior_email text;
    next_junior_affiliation integer;
    next_parent_affiliation integer;
BEGIN
    -- 1. ログイン済みかチェック
    IF v_junior_id IS NULL THEN
        RAISE EXCEPTION '認証されていません。再ログインしてください。';
    END IF;

    -- 2. 中学生(自分)が public.users に既に登録がないかチェック
    IF EXISTS (SELECT 1 FROM public.users WHERE id = v_junior_id) THEN
        RAISE EXCEPTION 'このユーザーは既に登録済みです。';
    END IF;

    -- 3. 現在の中学生(ログイン中)のメールアドレス取得
    SELECT email INTO v_junior_email FROM auth.users WHERE id = v_junior_id;

    -- 4. 中学生用の affiliation (ID) 発行
    next_junior_affiliation := public.issue_junior_id();

    -- 5. 中学生（自分）を public.users に登録 (junior_usage_type = 2: 中学生のみ)
    INSERT INTO public.users (id, email, affiliation, role, clubs, junior_usage_type)
    VALUES (v_junior_id, v_junior_email, next_junior_affiliation, 'junior', null, 2);

    -- 6. 保護者用の affiliation (ID) 発行
    next_parent_affiliation := public.issue_junior_id();

    -- 7. 保護者を public.users に登録 (junior_usage_type = 3: 保護者のみ)
    -- クライアントから渡された p_parent_auth_id を使用
    INSERT INTO public.users (id, email, affiliation, role, clubs, junior_usage_type)
    VALUES (p_parent_auth_id, p_parent_email, next_parent_affiliation, 'junior', null, 3);

    -- 注意: auth.identities などの認証データはクライアント側の signUp で自動生成されるためここでは不要
END;
$$;


ALTER FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."admin_auth_rate_limits" (
    "ip_address" "text" NOT NULL,
    "failed_attempts" integer DEFAULT 0 NOT NULL,
    "last_failed_at" timestamp with time zone,
    "locked_until" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_auth_rate_limits_failed_attempts_check" CHECK (("failed_attempts" >= 0))
);


ALTER TABLE "public"."admin_auth_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."admin_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_used_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "admin_sessions_expires_after_created" CHECK (("expires_at" > "created_at"))
);


ALTER TABLE "public"."admin_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."class_performances" (
    "year" smallint,
    "class_name" "text",
    "title" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "junior_capacity" smallint DEFAULT '10'::smallint,
    "total_capacity" smallint DEFAULT '50'::smallint,
    "id" smallint NOT NULL,
    "is_accepting" boolean DEFAULT true
);


ALTER TABLE "public"."class_performances" OWNER TO "postgres";


ALTER TABLE "public"."class_performances" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."class_performances_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."class_tickets" (
    "id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "class_id" smallint NOT NULL,
    "round_id" smallint NOT NULL
);


ALTER TABLE "public"."class_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."configs" (
    "id" integer DEFAULT 1 NOT NULL,
    "event_year" integer DEFAULT 2025 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "admin_password" "text" DEFAULT 'admin123'::"text" NOT NULL,
    "show_length" smallint DEFAULT '60'::smallint NOT NULL,
    "junior_release_open" boolean DEFAULT false NOT NULL,
    "max_tickets_per_user" smallint DEFAULT '20'::smallint NOT NULL,
    "max_tickets_per_junior_user" smallint DEFAULT '1'::smallint NOT NULL,
    CONSTRAINT "single_row" CHECK (("id" = 1))
);


ALTER TABLE "public"."configs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gym_performances" (
    "id" smallint NOT NULL,
    "group_name" "text" NOT NULL,
    "round_name" "text" NOT NULL,
    "start_at" timestamp with time zone NOT NULL,
    "end_at" timestamp with time zone NOT NULL,
    "capacity" smallint NOT NULL,
    "year" smallint NOT NULL,
    "is_accepting" boolean DEFAULT true
);


ALTER TABLE "public"."gym_performances" OWNER TO "postgres";


ALTER TABLE "public"."gym_performances" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."gym_performances_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."gym_tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "performance_id" smallint NOT NULL
);


ALTER TABLE "public"."gym_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."keep_alive" (
    "id" integer NOT NULL,
    "last_ping" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."keep_alive" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."performances_schedule" (
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "start_at" timestamp with time zone NOT NULL,
    "id" smallint NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "round_name" "text" NOT NULL
);


ALTER TABLE "public"."performances_schedule" OWNER TO "postgres";


ALTER TABLE "public"."performances_schedule" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."performances_schedule_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."rehearsals" (
    "id" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "class_id" smallint NOT NULL,
    "round_id" smallint,
    "round_name" "text" NOT NULL,
    "start_time" timestamp with time zone,
    "is_active" boolean DEFAULT true NOT NULL,
    "type" "public"."rehearsal_type" DEFAULT 'official'::"public"."rehearsal_type" NOT NULL
);


ALTER TABLE "public"."rehearsals" OWNER TO "postgres";


ALTER TABLE "public"."rehearsals" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."rehearsals_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."relationships" (
    "id" smallint NOT NULL,
    "name" "text",
    "is_accepting" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."relationships" OWNER TO "postgres";


ALTER TABLE "public"."relationships" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."relationships_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ticket_code_counters" (
    "prefix" "text" NOT NULL,
    "last_value" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ticket_code_counters_last_value_check" CHECK (("last_value" >= 0))
);


ALTER TABLE "public"."ticket_code_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticket_issue_controls" (
    "id" smallint DEFAULT 1 NOT NULL,
    "class_invite_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    "rehearsal_invite_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    "gym_invite_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    "entry_only_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "same_day_class_mode" "text" DEFAULT 'open'::"text",
    "same_day_gym_mode" "text" DEFAULT 'open'::"text",
    "junior_class_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    "junior_entry_only_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    "junior_gym_mode" "text" DEFAULT 'open'::"text" NOT NULL,
    CONSTRAINT "ticket_issue_controls_class_invite_mode_check" CHECK (("class_invite_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"]))),
    CONSTRAINT "ticket_issue_controls_entry_only_mode_check" CHECK (("entry_only_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"]))),
    CONSTRAINT "ticket_issue_controls_gym_invite_mode_check" CHECK (("gym_invite_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"]))),
    CONSTRAINT "ticket_issue_controls_id_check" CHECK (("id" = 1)),
    CONSTRAINT "ticket_issue_controls_junior_class_mode_check" CHECK (("junior_class_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"]))),
    CONSTRAINT "ticket_issue_controls_junior_entry_only_mode_check" CHECK (("junior_entry_only_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"]))),
    CONSTRAINT "ticket_issue_controls_junior_gym_mode_check" CHECK (("junior_gym_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"]))),
    CONSTRAINT "ticket_issue_controls_rehearsal_invite_mode_check" CHECK (("rehearsal_invite_mode" = ANY (ARRAY['open'::"text", 'only-own'::"text", 'public-rehearsals'::"text", 'auto'::"text", 'off'::"text"])))
);


ALTER TABLE "public"."ticket_issue_controls" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ticket_types" (
    "id" smallint NOT NULL,
    "name" "text",
    "type" "text"
);


ALTER TABLE "public"."ticket_types" OWNER TO "postgres";


ALTER TABLE "public"."ticket_types" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."ticket_types_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."tickets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "ticket_type" smallint NOT NULL,
    "status" "public"."ticket_status" DEFAULT 'valid'::"public"."ticket_status" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "relationship" smallint NOT NULL,
    "signature" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "person_count" smallint DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text" NOT NULL,
    "affiliation" integer NOT NULL,
    "role" "text",
    "clubs" "text"[],
    "junior_usage_type" smallint
);


ALTER TABLE "public"."users" OWNER TO "postgres";


ALTER TABLE ONLY "public"."relationships"
    ADD CONSTRAINT "Relationships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_auth_rate_limits"
    ADD CONSTRAINT "admin_auth_rate_limits_pkey" PRIMARY KEY ("ip_address");



ALTER TABLE ONLY "public"."admin_sessions"
    ADD CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."admin_sessions"
    ADD CONSTRAINT "admin_sessions_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."class_tickets"
    ADD CONSTRAINT "class_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."configs"
    ADD CONSTRAINT "configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gym_performances"
    ADD CONSTRAINT "gym_performances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."gym_tickets"
    ADD CONSTRAINT "gym_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."keep_alive"
    ADD CONSTRAINT "keep_alive_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."class_performances"
    ADD CONSTRAINT "performances_class_name_key" UNIQUE ("class_name");



ALTER TABLE ONLY "public"."class_performances"
    ADD CONSTRAINT "performances_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."performances_schedule"
    ADD CONSTRAINT "performances_schedule_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rehearsals"
    ADD CONSTRAINT "rehearsals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ticket_code_counters"
    ADD CONSTRAINT "ticket_code_counters_pkey" PRIMARY KEY ("prefix");



ALTER TABLE ONLY "public"."ticket_issue_controls"
    ADD CONSTRAINT "ticket_issue_controls_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ticket_types"
    ADD CONSTRAINT "ticket_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_affiliation_key" UNIQUE ("affiliation");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "admin_auth_rate_limits_locked_until_idx" ON "public"."admin_auth_rate_limits" USING "btree" ("locked_until");



CREATE INDEX "admin_sessions_expires_at_idx" ON "public"."admin_sessions" USING "btree" ("expires_at");



CREATE INDEX "admin_sessions_revoked_at_idx" ON "public"."admin_sessions" USING "btree" ("revoked_at");



CREATE INDEX "class_tickets_class_id_idx" ON "public"."class_tickets" USING "btree" ("class_id");



CREATE INDEX "class_tickets_round_id_idx" ON "public"."class_tickets" USING "btree" ("round_id");



CREATE INDEX "gym_tickets_performance_id_idx" ON "public"."gym_tickets" USING "btree" ("performance_id");



CREATE INDEX "rehearsals_class_id_idx" ON "public"."rehearsals" USING "btree" ("class_id");



CREATE INDEX "tickets_relationship_idx" ON "public"."tickets" USING "btree" ("relationship");



CREATE INDEX "tickets_ticket_type_idx" ON "public"."tickets" USING "btree" ("ticket_type");



CREATE INDEX "tickets_user_id_idx" ON "public"."tickets" USING "btree" ("user_id");



ALTER TABLE ONLY "public"."class_tickets"
    ADD CONSTRAINT "class_tickets_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."class_performances"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_tickets"
    ADD CONSTRAINT "class_tickets_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."tickets"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."class_tickets"
    ADD CONSTRAINT "class_tickets_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "public"."performances_schedule"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gym_tickets"
    ADD CONSTRAINT "gym_tickets_id_fkey" FOREIGN KEY ("id") REFERENCES "public"."tickets"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gym_tickets"
    ADD CONSTRAINT "gym_tickets_performance_id_fkey" FOREIGN KEY ("performance_id") REFERENCES "public"."gym_performances"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."rehearsals"
    ADD CONSTRAINT "rehearsals_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "public"."class_performances"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_relationship_fkey" FOREIGN KEY ("relationship") REFERENCES "public"."relationships"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_ticket_type_fkey" FOREIGN KEY ("ticket_type") REFERENCES "public"."ticket_types"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tickets"
    ADD CONSTRAINT "tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON UPDATE CASCADE ON DELETE CASCADE;



CREATE POLICY "Enable read access for all users" ON "public"."class_performances" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."class_tickets" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."configs" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."gym_performances" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."gym_tickets" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."performances_schedule" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."rehearsals" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."relationships" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ticket_code_counters" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ticket_issue_controls" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."ticket_types" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."tickets" FOR SELECT USING (true);



CREATE POLICY "Enable read access for no users" ON "public"."admin_auth_rate_limits" FOR SELECT USING (false);



CREATE POLICY "Enable read access for no users" ON "public"."admin_sessions" FOR SELECT USING (false);



CREATE POLICY "Enable users to view their own data only" ON "public"."users" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "id"));



ALTER TABLE "public"."admin_auth_rate_limits" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."admin_sessions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allow anon update keep alive" ON "public"."keep_alive" FOR UPDATE TO "anon" USING (("id" = 1)) WITH CHECK (("id" = 1));



CREATE POLICY "allow anon upsert keep alive" ON "public"."keep_alive" FOR INSERT TO "anon" WITH CHECK (("id" = 1));



ALTER TABLE "public"."class_performances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."class_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gym_performances" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."gym_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."keep_alive" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."performances_schedule" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rehearsals" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."relationships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ticket_code_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ticket_issue_controls" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ticket_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";





























































































































































































GRANT ALL ON FUNCTION "public"."cancel_own_ticket_by_code"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."cancel_own_ticket_by_code"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_own_ticket_by_code"("p_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."delete_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_remaining_seats"("p_performance_id" smallint, "p_schedule_id" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."get_remaining_seats"("p_performance_id" smallint, "p_schedule_id" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_remaining_seats"("p_performance_id" smallint, "p_schedule_id" smallint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_by_email"("user_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_by_email"("user_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_user_by_email"("user_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_by_email"("user_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."increment_ticket_code_counter"("p_prefix" "text", "p_increment" integer, "p_max_value" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_ticket_code_counter"("p_prefix" "text", "p_increment" integer, "p_max_value" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_ticket_code_counter"("p_prefix" "text", "p_increment" integer, "p_max_value" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."issue_class_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" integer, "p_relationship_id" integer, "p_performance_id" integer, "p_schedule_id" integer, "p_issue_count" integer, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."issue_class_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" integer, "p_relationship_id" integer, "p_performance_id" integer, "p_schedule_id" integer, "p_issue_count" integer, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."issue_class_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" integer, "p_relationship_id" integer, "p_performance_id" integer, "p_schedule_id" integer, "p_issue_count" integer, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."issue_gym_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" smallint, "p_relationship_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."issue_gym_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" smallint, "p_relationship_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."issue_gym_tickets_with_codes"("p_user_id" "uuid", "p_ticket_type_id" smallint, "p_relationship_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."issue_junior_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."issue_junior_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."issue_junior_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."register_junior"("junior_usage_type" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."register_junior"("junior_usage_type" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_junior"("junior_usage_type" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."register_student"("affiliation" integer, "clubs" "text"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."register_student"("affiliation" integer, "clubs" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."register_student"("affiliation" integer, "clubs" "text"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."reissue_gym_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."reissue_gym_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reissue_gym_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."reissue_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "anon";
GRANT ALL ON FUNCTION "public"."reissue_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reissue_ticket_change_relationship_with_codes"("p_user_id" "uuid", "p_old_code" "text", "p_ticket_type_id" smallint, "p_performance_id" smallint, "p_schedule_id" smallint, "p_new_relationship_id" smallint, "p_issue_count" smallint, "p_codes" "text"[], "p_signatures" "text"[], "p_person_count" smallint) TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rollback_ticket_code_counter"("p_prefix" "text", "p_decrement" integer, "p_expected_last_value" bigint) TO "anon";
GRANT ALL ON FUNCTION "public"."rollback_ticket_code_counter"("p_prefix" "text", "p_decrement" integer, "p_expected_last_value" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."rollback_ticket_code_counter"("p_prefix" "text", "p_decrement" integer, "p_expected_last_value" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."split_and_register_junior"("p_parent_auth_id" "uuid", "p_parent_email" "text") TO "service_role";
























GRANT ALL ON TABLE "public"."admin_auth_rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."admin_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."class_performances" TO "anon";
GRANT ALL ON TABLE "public"."class_performances" TO "authenticated";
GRANT ALL ON TABLE "public"."class_performances" TO "service_role";



GRANT ALL ON SEQUENCE "public"."class_performances_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."class_performances_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."class_performances_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."class_tickets" TO "anon";
GRANT ALL ON TABLE "public"."class_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."class_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."configs" TO "anon";
GRANT ALL ON TABLE "public"."configs" TO "authenticated";
GRANT ALL ON TABLE "public"."configs" TO "service_role";



GRANT ALL ON TABLE "public"."gym_performances" TO "anon";
GRANT ALL ON TABLE "public"."gym_performances" TO "authenticated";
GRANT ALL ON TABLE "public"."gym_performances" TO "service_role";



GRANT ALL ON SEQUENCE "public"."gym_performances_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."gym_performances_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."gym_performances_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."gym_tickets" TO "anon";
GRANT ALL ON TABLE "public"."gym_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."gym_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."keep_alive" TO "anon";
GRANT ALL ON TABLE "public"."keep_alive" TO "authenticated";
GRANT ALL ON TABLE "public"."keep_alive" TO "service_role";



GRANT ALL ON TABLE "public"."performances_schedule" TO "anon";
GRANT ALL ON TABLE "public"."performances_schedule" TO "authenticated";
GRANT ALL ON TABLE "public"."performances_schedule" TO "service_role";



GRANT ALL ON SEQUENCE "public"."performances_schedule_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."performances_schedule_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."performances_schedule_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."rehearsals" TO "anon";
GRANT ALL ON TABLE "public"."rehearsals" TO "authenticated";
GRANT ALL ON TABLE "public"."rehearsals" TO "service_role";



GRANT ALL ON SEQUENCE "public"."rehearsals_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."rehearsals_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."rehearsals_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."relationships" TO "anon";
GRANT ALL ON TABLE "public"."relationships" TO "authenticated";
GRANT ALL ON TABLE "public"."relationships" TO "service_role";



GRANT ALL ON SEQUENCE "public"."relationships_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."relationships_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."relationships_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_code_counters" TO "anon";
GRANT ALL ON TABLE "public"."ticket_code_counters" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_code_counters" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_issue_controls" TO "anon";
GRANT ALL ON TABLE "public"."ticket_issue_controls" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_issue_controls" TO "service_role";



GRANT ALL ON TABLE "public"."ticket_types" TO "anon";
GRANT ALL ON TABLE "public"."ticket_types" TO "authenticated";
GRANT ALL ON TABLE "public"."ticket_types" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ticket_types_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ticket_types_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ticket_types_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."tickets" TO "anon";
GRANT ALL ON TABLE "public"."tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."tickets" TO "service_role";



GRANT ALL ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT ALL ON TABLE "public"."users" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";
































--
-- Dumped schema changes for auth and storage
--

