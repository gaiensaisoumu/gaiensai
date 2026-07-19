-- Function to split an existing junior account from shared tickets to separate accounts
-- This function is used when a user wants to split their account from
-- "中学生と保護者(共通のチケット使用)" (usage_type=0) to
-- "中学生のみ" (usage_type=2) and create a new "保護者のみ" (usage_type=3) account

CREATE OR REPLACE FUNCTION public.split_existing_junior_account(
    p_parent_auth_id uuid,
    p_parent_email text,
    p_application_day text DEFAULT NULL
) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
    v_junior_id uuid := auth.uid();
    v_junior_email text;
    v_current_usage_type integer;
    v_current_application_day text;
    next_parent_affiliation integer;
BEGIN
    -- 1. ログイン済みかチェック
    IF v_junior_id IS NULL THEN
        RAISE EXCEPTION '認証されていません。再ログインしてください。';
    END IF;

    -- 2. 中学生(自分)が public.users に登録されているかチェック
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_junior_id) THEN
        RAISE EXCEPTION 'このユーザーは登録されていません。';
    END IF;

    -- 3. 現在の usage_type と application_day を取得
    SELECT junior_usage_type, application_day INTO v_current_usage_type, v_current_application_day
    FROM public.users
    WHERE id = v_junior_id;

    -- 4. 共通チケット使用(0)からのみ分割を許可
    IF v_current_usage_type != 0 THEN
        RAISE EXCEPTION 'このアカウントは分割できません。現在の利用形態: %', v_current_usage_type;
    END IF;

    -- 5. 現在の中学生(ログイン中)のメールアドレス取得
    SELECT email INTO v_junior_email FROM auth.users WHERE id = v_junior_id;

    -- 6. すべての有効なチケットをキャンセル (RLSを回避するためSECURITY DEFINER内で実行)
    UPDATE public.tickets
    SET status = 'cancelled'
    WHERE user_id = v_junior_id
    AND status = 'valid';

    -- 7. 中学生アカウントを更新 (junior_usage_type = 2: 中学生のみ)
    -- application_dayは現在の値を維持（p_application_dayが指定されていればそちらを優先）
    UPDATE public.users
    SET junior_usage_type = 2,
        application_day = COALESCE(p_application_day, v_current_application_day)
    WHERE id = v_junior_id;

    -- 8. 保護者用の affiliation (ID) 発行
    next_parent_affiliation := public.issue_junior_id();

    -- 9. 保護者を public.users に登録 (junior_usage_type = 3: 保護者のみ)
    -- application_dayは現在の値を維持（p_application_dayが指定されていればそちらを優先）
    INSERT INTO public.users (id, email, affiliation, role, clubs, junior_usage_type, application_day)
    VALUES (p_parent_auth_id, p_parent_email, next_parent_affiliation, 'junior', null, 3, COALESCE(p_application_day, v_current_application_day));

END;
$$;

-- Grant permissions
GRANT ALL ON FUNCTION public.split_existing_junior_account(uuid, text, text) TO anon;
GRANT ALL ON FUNCTION public.split_existing_junior_account(uuid, text, text) TO authenticated;
GRANT ALL ON FUNCTION public.split_existing_junior_account(uuid, text, text) TO service_role;
