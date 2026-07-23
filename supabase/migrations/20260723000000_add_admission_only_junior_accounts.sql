ALTER TABLE public.configs
ADD COLUMN IF NOT EXISTS max_admission_only_junior_accounts integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.junior_admission_only_account_counts (
  id integer PRIMARY KEY DEFAULT 1,
  admission_only_count integer NOT NULL DEFAULT 0,
  CONSTRAINT junior_admission_only_account_counts_single_row CHECK (id = 1)
);

INSERT INTO public.junior_admission_only_account_counts (id, admission_only_count)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.normalize_junior_application_day(p_application_day text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  normalized_application_day text;
  class_day_value text;
  gym_day_value text;
BEGIN
  IF p_application_day IS NULL THEN
    RETURN NULL;
  END IF;

  normalized_application_day := trim(p_application_day);
  IF normalized_application_day = '' THEN
    RETURN NULL;
  END IF;

  IF normalized_application_day ~* '^admission_only(=true)?$' THEN
    RETURN 'admission_only';
  END IF;

  IF normalized_application_day ~* '^((class_day|gym_day)=.+)(;((class_day|gym_day)=.+))*$' THEN
    class_day_value := null;
    gym_day_value := null;

    SELECT split_part(value_pair, '=', 2)
      INTO class_day_value
    FROM regexp_split_to_table(normalized_application_day, ';') AS value_pair
    WHERE split_part(value_pair, '=', 1) = 'class_day'
    LIMIT 1;

    SELECT split_part(value_pair, '=', 2)
      INTO gym_day_value
    FROM regexp_split_to_table(normalized_application_day, ';') AS value_pair
    WHERE split_part(value_pair, '=', 1) = 'gym_day'
    LIMIT 1;

    IF class_day_value IS NOT NULL OR gym_day_value IS NOT NULL THEN
      class_day_value := trim(coalesce(class_day_value, ''));
      gym_day_value := trim(coalesce(gym_day_value, ''));

      IF class_day_value ~* '^admission_only(=true)?$'
         AND gym_day_value ~* '^admission_only(=true)?$' THEN
        RETURN 'admission_only';
      END IF;
    END IF;
  END IF;

  IF normalized_application_day ~* '^(day1|day2|1|2)(\&(day1|day2|1|2))*$'
     OR normalized_application_day ~* '^(((class_day|gym_day)=(day1|day2|1|2)(\&(day1|day2|1|2))*)(;((class_day|gym_day)=(day1|day2|1|2)(\&(day1|day2|1|2))*))*)$' THEN
    RETURN lower(normalized_application_day);
  END IF;

  RAISE EXCEPTION 'INVALID_APPLICATION_DAY';
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_junior_secret_code(p_secret_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  v_hashed_password text;
BEGIN
  SELECT junior_password INTO v_hashed_password
  FROM public.configs
  LIMIT 1;

  IF v_hashed_password IS NULL OR v_hashed_password = '' THEN
    RETURN false;
  END IF;

  IF v_hashed_password = extensions.crypt(p_secret_code, v_hashed_password) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_admission_only_junior_account_count()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT admission_only_count
  FROM public.junior_admission_only_account_counts
  WHERE id = 1;
$$;

GRANT ALL ON FUNCTION public.get_admission_only_junior_account_count() TO anon;
GRANT ALL ON FUNCTION public.get_admission_only_junior_account_count() TO authenticated;
GRANT ALL ON FUNCTION public.get_admission_only_junior_account_count() TO service_role;

CREATE OR REPLACE FUNCTION public.sync_admission_only_junior_account_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.junior_admission_only_account_counts
  SET admission_only_count = (
    SELECT COUNT(*)
    FROM public.users
    WHERE application_day = 'admission_only'
      AND role = 'junior'
  )
  WHERE id = 1;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_admission_only_junior_account_count ON public.users;
CREATE TRIGGER trg_sync_admission_only_junior_account_count
AFTER INSERT OR UPDATE OF application_day, role OR DELETE ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.sync_admission_only_junior_account_count();

CREATE OR REPLACE FUNCTION public.validate_admission_only_junior_account_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_count integer;
  max_count integer;
  next_day text;
BEGIN
  next_day := public.normalize_junior_application_day(
    CASE WHEN TG_OP = 'DELETE' THEN OLD.application_day ELSE NEW.application_day END
  );
  IF next_day IS DISTINCT FROM 'admission_only' THEN
    RETURN NEW;
  END IF;

  SELECT admission_only_count INTO current_count
  FROM public.junior_admission_only_account_counts
  WHERE id = 1;

  SELECT max_admission_only_junior_accounts INTO max_count
  FROM public.configs
  WHERE id = 1;

  IF max_count IS NOT NULL AND max_count >= 0 AND current_count >= max_count THEN
    RAISE EXCEPTION 'ADMISSION_ONLY_JUNIOR_ACCOUNT_LIMIT_REACHED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_admission_only_junior_account_limit ON public.users;
CREATE TRIGGER trg_validate_admission_only_junior_account_limit
BEFORE INSERT OR UPDATE OF application_day ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.validate_admission_only_junior_account_limit();

CREATE OR REPLACE FUNCTION public.register_junior(
  junior_usage_type smallint,
  p_application_day text DEFAULT NULL,
  p_secret_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  next_affiliation integer;
  normalized_application_day text;
  v_hashed_password text;
begin
  if junior_usage_type < 0 or junior_usage_type > 3 then
    raise exception 'INVALID_JUNIOR_USAGE_TYPE';
  end if;

  select junior_password into v_hashed_password
  from public.configs
  limit 1;

  if v_hashed_password is null or v_hashed_password = '' then
    raise exception '合言葉が設定されていません。管理者にお問い合わせください。';
  end if;

  if v_hashed_password != extensions.crypt(p_secret_code, v_hashed_password) then
    raise exception '合言葉が正しくありません。';
  end if;

  normalized_application_day := public.normalize_junior_application_day(p_application_day);

  next_affiliation := public.issue_junior_id();

  insert into public.users (id, email, affiliation, role, clubs, junior_usage_type, application_day)
  values (
    auth.uid(),
    (select email from auth.users where id = auth.uid()),
    next_affiliation,
    'junior',
    null,
    junior_usage_type,
    normalized_application_day
  );
end;
$$;

CREATE OR REPLACE FUNCTION public.split_and_register_junior(
  p_parent_auth_id uuid,
  p_parent_email text,
  p_application_day text DEFAULT NULL,
  p_secret_code text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
    v_junior_id uuid := auth.uid();
    v_junior_email text;
    next_junior_affiliation integer;
    next_parent_affiliation integer;
    normalized_application_day text;
    v_hashed_password text;
BEGIN
    IF v_junior_id IS NULL THEN
        RAISE EXCEPTION '認証されていません。再ログインしてください。';
    END IF;

    IF EXISTS (SELECT 1 FROM public.users WHERE id = v_junior_id) THEN
        RAISE EXCEPTION 'このユーザーは既に登録済みです。';
    END IF;

    SELECT junior_password INTO v_hashed_password
    FROM public.configs
    LIMIT 1;

    IF v_hashed_password IS NULL OR v_hashed_password = '' THEN
        RAISE EXCEPTION '合言葉が設定されていません。管理者にお問い合わせください。';
    END IF;

    IF v_hashed_password != extensions.crypt(p_secret_code, v_hashed_password) THEN
        RAISE EXCEPTION '合言葉が正しくありません。';
    END IF;

    normalized_application_day := public.normalize_junior_application_day(p_application_day);

    SELECT email INTO v_junior_email FROM auth.users WHERE id = v_junior_id;

    next_junior_affiliation := public.issue_junior_id();

    INSERT INTO public.users (id, email, affiliation, role, clubs, junior_usage_type, application_day)
    VALUES (v_junior_id, v_junior_email, next_junior_affiliation, 'junior', null, 2, normalized_application_day);

    next_parent_affiliation := public.issue_junior_id();

    INSERT INTO public.users (id, email, affiliation, role, clubs, junior_usage_type, application_day)
    VALUES (p_parent_auth_id, p_parent_email, next_parent_affiliation, 'junior', null, 3, normalized_application_day);
END;
$$;

alter table "public"."junior_admission_only_account_counts" enable row level security;


  create policy "Enable read access for all users"
  on "public"."junior_admission_only_account_counts"
  as permissive
  for select
  to public
using (true);



DROP FUNCTION IF EXISTS public.register_junior(smallint, text);
DROP FUNCTION IF EXISTS public.split_and_register_junior(uuid, text, text);

GRANT ALL ON FUNCTION public.register_junior(smallint, text, text) TO anon;
GRANT ALL ON FUNCTION public.register_junior(smallint, text, text) TO authenticated;
GRANT ALL ON FUNCTION public.register_junior(smallint, text, text) TO service_role;

GRANT ALL ON FUNCTION public.split_and_register_junior(uuid, text, text, text) TO anon;
GRANT ALL ON FUNCTION public.split_and_register_junior(uuid, text, text, text) TO authenticated;
GRANT ALL ON FUNCTION public.split_and_register_junior(uuid, text, text, text) TO service_role;
