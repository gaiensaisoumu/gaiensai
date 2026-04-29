set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.split_and_register_junior(p_parent_auth_id uuid, p_parent_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'extensions'
AS $function$
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
$function$
;


