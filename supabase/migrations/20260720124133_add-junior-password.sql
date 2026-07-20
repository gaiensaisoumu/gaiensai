alter table "public"."configs" add column "junior_password" text;


CREATE OR REPLACE FUNCTION public.validate_junior_secret_code(p_secret_code text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
declare
  v_hashed_password text;
begin
  -- configsテーブルからハッシュ化された合言葉を取得
  select junior_password into v_hashed_password
  from public.configs
  limit 1;

  -- 合言葉が設定されていない場合はfalseを返す
  if v_hashed_password is null or v_hashed_password = '' then
    return false;
  end if;

  -- bcryptを使用してハッシュ比較（pgcryptoのcrypt関数を使用）
  -- crypt関数は入力とソルトを含むハッシュを比較し、一致すればハッシュを返す
  if v_hashed_password = extensions.crypt(p_secret_code, v_hashed_password) then
    return true;
  else
    return false;
  end if;
end;
$$;

GRANT ALL ON FUNCTION public.validate_junior_secret_code(text) TO anon;
GRANT ALL ON FUNCTION public.validate_junior_secret_code(text) TO authenticated;
GRANT ALL ON FUNCTION public.validate_junior_secret_code(text) TO service_role;


CREATE OR REPLACE FUNCTION public.register_junior(junior_usage_type smallint, p_application_day text DEFAULT NULL, p_secret_code text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
declare
  next_affiliation integer;
  normalized_application_day text;
  v_hashed_password text;
begin
  if junior_usage_type < 0 or junior_usage_type > 3 then
    raise exception 'INVALID_JUNIOR_USAGE_TYPE';
  end if;

  -- 合言葉の検証
  select junior_password into v_hashed_password
  from public.configs
  limit 1;

  if v_hashed_password is null or v_hashed_password = '' then
    raise exception '合言葉が設定されていません。管理者にお問い合わせください。';
  end if;

  if v_hashed_password != extensions.crypt(p_secret_code, v_hashed_password) then
    raise exception '合言葉が正しくありません。';
  end if;

  if p_application_day is not null then
    normalized_application_day := trim(p_application_day);
    if normalized_application_day = '' then
      normalized_application_day := null;
    elsif normalized_application_day !~ '^(day1|day2|1|2)(\&(day1|day2|1|2))*$' and normalized_application_day !~ '^(((class_day|gym_day)=(day1|day2|1|2)(\&(day1|day2|1|2))*)(;((class_day|gym_day)=(day1|day2|1|2)(\&(day1|day2|1|2))*))*)$' then
      raise exception 'INVALID_APPLICATION_DAY';
    end if;
  end if;

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

    -- 合言葉の検証
    SELECT junior_password INTO v_hashed_password
    FROM public.configs
    LIMIT 1;

    IF v_hashed_password IS NULL OR v_hashed_password = '' THEN
        RAISE EXCEPTION '合言葉が設定されていません。管理者にお問い合わせください。';
    END IF;

    IF v_hashed_password != extensions.crypt(p_secret_code, v_hashed_password) THEN
        RAISE EXCEPTION '合言葉が正しくありません。';
    END IF;

    IF p_application_day IS NOT NULL THEN
        normalized_application_day := trim(p_application_day);
        IF normalized_application_day = '' THEN
            normalized_application_day := NULL;
        ELSIF normalized_application_day !~ '^(day1|day2|1|2)(\&(day1|day2|1|2))*$' AND normalized_application_day !~ '^(((class_day|gym_day)=(day1|day2|1|2)(\&(day1|day2|1|2))*)(;((class_day|gym_day)=(day1|day2|1|2)(\&(day1|day2|1|2))*))*)$' THEN
            RAISE EXCEPTION 'INVALID_APPLICATION_DAY';
        END IF;
    END IF;

    SELECT email INTO v_junior_email FROM auth.users WHERE id = v_junior_id;

    next_junior_affiliation := public.issue_junior_id();

    INSERT INTO public.users (id, email, affiliation, role, clubs, junior_usage_type, application_day)
    VALUES (v_junior_id, v_junior_email, next_junior_affiliation, 'junior', null, 2, normalized_application_day);

    next_parent_affiliation := public.issue_junior_id();

    INSERT INTO public.users (id, email, affiliation, role, clubs, junior_usage_type, application_day)
    VALUES (p_parent_auth_id, p_parent_email, next_parent_affiliation, 'junior', null, 3, normalized_application_day);
END;
$$;


CREATE OR REPLACE FUNCTION public.hash_password(p_password text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
begin
  return extensions.crypt(p_password, extensions.gen_salt('bf'));
end;
$$;

GRANT ALL ON FUNCTION public.hash_password(text) TO anon;
GRANT ALL ON FUNCTION public.hash_password(text) TO authenticated;
GRANT ALL ON FUNCTION public.hash_password(text) TO service_role;
