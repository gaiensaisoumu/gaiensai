import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { supabase } from '../../../lib/supabase';
import { useTitle } from '../../../hooks/useTitle';
import {
  resolveJuniorApplicationDays,
  serializeJuniorApplicationDaySelection,
} from './applicationDay';
import { createClient } from '@supabase/supabase-js';
import styles from '../students/InitialRegistration.module.css';
import subPageStyles from '../../../styles/sub-pages.module.css';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import Modal from '../../../components/ui/Modal';
import NormalSection from '../../../components/ui/NormalSection';
import type { Session } from '../../../types/types';
import { IoMdHelpCircleOutline } from 'react-icons/io';

const JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID = 7;
const SELF_RELATIONSHIP_ID = 1;
const ISSUE_POLL_MAX_RETRIES = 20;
const ISSUE_POLL_INTERVAL_MS = 300;

interface JuniorSignUpProps {
  onRegistered?: (commit?: boolean) => Promise<boolean>;
}

// コンポーネントで受け取る
const JuniorSignUp = ({ onRegistered }: JuniorSignUpProps) => {
  const [juniorUsageType, setJuniorUsageType] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [isIssuingTicket, setIsIssuingTicket] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loginId, setLoginId] = useState('');
  const [birthdayYear, setBirthdayYear] = useState('');
  const [birthdayMonth, setBirthdayMonth] = useState('');
  const [birthdayDay, setBirthdayDay] = useState('');
  const [parentGuardianId, setParentGuardianId] = useState('');
  const [parentBirthdayYear, setParentBirthdayYear] = useState('');
  const [parentBirthdayMonth, setParentBirthdayMonth] = useState('');
  const [parentBirthdayDay, setParentBirthdayDay] = useState('');
  const [showApplicationDayErrorModal, setShowApplicationDayErrorModal] =
    useState(() => {
      const { classDay, gymDay } = resolveJuniorApplicationDays(
        window.location.search,
      );
      return classDay === null && gymDay === null;
    });

  const [session, setSession] = useState<Session>(null);

  useTitle('中学生アカウント登録');

  const { route } = useLocation();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // 登録処理中(!loading)でない時だけリダイレクト
    if (session && !loading) {
      route('/junior');
    }
  }, [route, session, loading]);

  useEffect(() => {
    // 1. metaタグを作成
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow'; // インデックスもリンクの追跡も禁止
    meta.id = 'dynamic-noindex'; // 削除用の目印

    // 2. headタグの先頭に追加
    document.head.appendChild(meta);

    // 3. クリーンアップ関数（他のページに移動したときは noindex を解除する）
    return () => {
      const targetMeta = document.getElementById('dynamic-noindex');
      if (targetMeta) {
        targetMeta.remove();
      }
    };
  }, []);

  const handleUsageTypeChange = (type: number) => {
    setJuniorUsageType(type);
  };

  const handleSignUp = async (event: Event) => {
    event.preventDefault();
    setErrorMessage(null);

    const { classDay, gymDay } = resolveJuniorApplicationDays(
      window.location.search,
    );
    if (!classDay && !gymDay) {
      setShowApplicationDayErrorModal(true);
      setLoading(false);
      return;
    }

    const normalizedId = loginId.trim();
    const normalizedBirthday =
      birthdayYear.trim().padStart(4, '0') +
      birthdayMonth.trim().padStart(2, '0') +
      birthdayDay.trim().padStart(2, '0');

    const normalizedParentId = parentGuardianId.trim();
    const normalizedParentBirthday =
      parentBirthdayYear.trim().padStart(4, '0') +
      parentBirthdayMonth.trim().padStart(2, '0') +
      parentBirthdayDay.trim().padStart(2, '0');

    // 保護者のみの場合は中学生情報をバリデーションしない
    if (juniorUsageType !== 3) {
      if (!normalizedId) {
        setErrorMessage('IDを入力してください。');
        return;
      }

      if (normalizedId.includes('@')) {
        setErrorMessage('IDに @ は使えません。');
        return;
      }

      if (!/^\d{8}$/.test(normalizedBirthday)) {
        setErrorMessage('誕生日は8桁（例: 20100401）で入力してください。');
        return;
      }
    }

    // アカウント分割または保護者のみの場合、保護者情報をバリデーション
    if (juniorUsageType === 1 || juniorUsageType === 3) {
      if (!normalizedParentId) {
        setErrorMessage('保護者のIDを入力してください。');
        return;
      }

      if (normalizedParentId.includes('@')) {
        setErrorMessage('保護者のIDに @ は使えません。');
        return;
      }

      if (
        !parentBirthdayYear.trim() ||
        !parentBirthdayMonth.trim() ||
        !parentBirthdayDay.trim()
      ) {
        setErrorMessage('保護者の誕生日を入力してください。');
        return;
      }

      if (!/^\d{8}$/.test(normalizedParentBirthday)) {
        setErrorMessage(
          '保護者の誕生日は8桁（例: 20100401）で入力してください。',
        );
        return;
      }
    }

    // アカウント分割の場合は、中学生情報と保護者情報が一致してないことを確認
    if (juniorUsageType === 1) {
      if (
        normalizedId === normalizedParentId &&
        normalizedBirthday === normalizedParentBirthday
      ) {
        setErrorMessage(
          '保護者のIDと誕生日の両方を中学生の情報と同じにはできません。別のIDまたは誕生日を入力してください。',
        );
        return;
      }
    }

    setLoading(true);

    try {
      // 保護者のみの場合は保護者情報をメインとして使用
      const isParentOnly = juniorUsageType === 3;
      const mainId = isParentOnly ? parentGuardianId.trim() : normalizedId;
      const mainBirthday = isParentOnly
        ? parentBirthdayYear.trim().padStart(4, '0') +
          parentBirthdayMonth.trim().padStart(2, '0') +
          parentBirthdayDay.trim().padStart(2, '0')
        : normalizedBirthday;
      const compositeId = `${mainId}-${mainBirthday}`;
      const email = `${compositeId}@gaiensai.local`;
      const password = mainBirthday;

      // Supabase Authに登録
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (authError || !authData.user) {
        setErrorMessage(
          authError?.message === 'User already registered'
            ? 'このID・誕生日の組み合わせは既に登録されています。'
            : 'アカウントの作成に失敗しました。',
        );
        setLoading(false);
        return;
      }

      const storedApplicationDay = serializeJuniorApplicationDaySelection(
        classDay ?? null,
        gymDay ?? null,
      );
      const normalizedApplicationDay =
        storedApplicationDay ??
        window.localStorage.getItem('junior_application_day');
      let registerError;

      // アカウント分割が選択されている場合（保護者のみの場合は中学生アカウントを作成しない）
      if (juniorUsageType === 1) {
        const parentNormalizedBirthday =
          parentBirthdayYear.trim().padStart(4, '0') +
          parentBirthdayMonth.trim().padStart(2, '0') +
          parentBirthdayDay.trim().padStart(2, '0');
        const parentEmail = `${parentGuardianId.trim()}-${parentNormalizedBirthday}@gaiensai.local`;
        const parentPassword = parentNormalizedBirthday;

        const tempClient = createClient(
          import.meta.env.VITE_SUPABASE_URL,
          import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
          { auth: { persistSession: false } },
        );

        const { data: parentAuthData, error: parentAuthError } =
          await tempClient.auth.signUp({
            email: parentEmail,
            password: parentPassword,
          });

        if (parentAuthError || !parentAuthData.user) {
          setErrorMessage(
            parentAuthError?.message === 'User already registered'
              ? 'このID・誕生日の組み合わせは既に登録されています。'
              : '保護者アカウントの作成に失敗しました。',
          );
          setLoading(false);
          return;
        }

        const { error: rpcError } = await supabase.rpc(
          'split_and_register_junior',
          {
            p_parent_auth_id: parentAuthData.user.id,
            p_parent_email: parentEmail,
            p_application_day: normalizedApplicationDay,
          },
        );
        registerError = rpcError;
      } else {
        // 保護者のみ、共通チケット、中学生のみの場合は register_junior を使用
        const { error } = await supabase.rpc('register_junior', {
          junior_usage_type: juniorUsageType,
          p_application_day: normalizedApplicationDay,
        });
        registerError = error;
      }

      if (registerError) {
        setErrorMessage('登録に失敗しました。時間をおいて再度お試しください。');
        setLoading(false);
        return;
      }

      setIsIssuingTicket(true);

      // 別々のチケット使用の場合、中学生と親両方のチケットを発行、保護者のみの場合は親のみ発行
      if (juniorUsageType === 1) {
        const { error: juniorTicketError } = await supabase.functions.invoke(
          'issue-tickets',
          {
            body: {
              ticketTypeId: JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID,
              relationshipId: SELF_RELATIONSHIP_ID,
              performanceId: 0,
              scheduleId: 0,
              issueCount: 1,
            },
          },
        );

        if (juniorTicketError) {
          setErrorMessage(
            '中学生用入場専用券の自動発券に失敗しました。時間をおいて再度お試しください。',
          );
          setIsIssuingTicket(false);
          setLoading(false);
          return;
        }

        try {
          const parentNormalizedBirthday =
            parentBirthdayYear.trim().padStart(4, '0') +
            parentBirthdayMonth.trim().padStart(2, '0') +
            parentBirthdayDay.trim().padStart(2, '0');
          const parentEmail = `${parentGuardianId.trim()}-${parentNormalizedBirthday}@gaiensai.local`;
          const parentPassword = parentNormalizedBirthday;
          const tempClient = createClient(
            import.meta.env.VITE_SUPABASE_URL,
            import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
            { auth: { persistSession: false } },
          );

          await tempClient.auth.signInWithPassword({
            email: parentEmail,
            password: parentPassword,
          });

          await tempClient.functions.invoke('issue-tickets', {
            body: {
              ticketTypeId: JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID,
              relationshipId: SELF_RELATIONSHIP_ID,
              performanceId: 0,
              scheduleId: 0,
              issueCount: 1,
            },
          });
        } catch (parentIssueErr) {
          // 保護者側の発券失敗は無視
        }
      } else if (juniorUsageType === 3) {
        // 保護者のみの場合はチケットを発行しない（中学生用チケットではないため）
        // 必要に応じて別のチケットタイプを発行するロジックを追加
      } else {
        const { error: issueError } = await supabase.functions.invoke(
          'issue-tickets',
          {
            body: {
              ticketTypeId: JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID,
              relationshipId: SELF_RELATIONSHIP_ID,
              performanceId: 0,
              scheduleId: 0,
              issueCount: 1,
            },
          },
        );

        if (issueError) {
          setErrorMessage(
            '入場専用券の自動発券に失敗しました。時間をおいて再度お試しください。',
          );
          setIsIssuingTicket(false);
          setLoading(false);
          return;
        }
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      if (!userId) {
        setErrorMessage(
          '認証情報の取得に失敗しました。再ログインしてください。',
        );
        setIsIssuingTicket(false);
        setLoading(false);
        return;
      }

      let issued = false;
      for (let i = 0; i < ISSUE_POLL_MAX_RETRIES; i++) {
        const { count, error: ticketCheckError } = await supabase
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'valid')
          .eq('ticket_type', JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID);

        if (!ticketCheckError && Number(count ?? 0) > 0) {
          issued = true;
          break;
        }

        await new Promise((resolve) => {
          window.setTimeout(resolve, ISSUE_POLL_INTERVAL_MS);
        });
      }

      if (!issued) {
        setErrorMessage(
          '入場専用券の反映確認に時間がかかっています。時間をおいて再度お試しください。',
        );
        setIsIssuingTicket(false);
        setLoading(false);
        return;
      }

      if (onRegistered) {
        await onRegistered(true);
      }

      route('/junior/mypage');
    } catch (error) {
      setErrorMessage(
        '予期しないエラーが発生しました。時間をおいて再度お試しください。',
      );
      setIsIssuingTicket(false);
      setLoading(false);
    }
  };

  if (session && !loading) {
    return null;
  }

  return (
    <>
      <h1 className={subPageStyles.pageTitle}>中学生用アカウント登録</h1>
      <section className={styles.registrationContainer}>
        <p className={styles.description}>
          ログインに使用するIDと誕生日を入力してアカウントを作成してください。
        </p>
        <form className={styles.form} onSubmit={handleSignUp}>
          <NormalSection>
            <h2 style={{ marginBottom: '0.5rem' }}>利用形態</h2>
            <p>
              「中学生と保護者(共通のチケット使用)」から「別々のチケットを使用」への変更以外は、後から変更できませんのでご注意ください。
            </p>
            <div className={styles.usageTypeSelection}>
              <label
                className={`${styles.usageTypeButton} ${
                  juniorUsageType === 0 ? styles.usageTypeButtonSelected : ''
                }`}
              >
                <input
                  type='radio'
                  name='junior-usage-type'
                  className={styles.usageTypeRadio}
                  checked={juniorUsageType === 0}
                  onChange={() => handleUsageTypeChange(0)}
                />
                中学生と保護者(共通のチケット使用)
              </label>
              <label
                className={`${styles.usageTypeButton} ${
                  juniorUsageType === 1 ? styles.usageTypeButtonSelected : ''
                }`}
              >
                <input
                  type='radio'
                  name='junior-usage-type'
                  className={styles.usageTypeRadio}
                  checked={juniorUsageType === 1}
                  onChange={() => handleUsageTypeChange(1)}
                />
                中学生と保護者(別々のチケット使用)
              </label>
              <label
                className={`${styles.usageTypeButton} ${
                  juniorUsageType === 2 ? styles.usageTypeButtonSelected : ''
                }`}
              >
                <input
                  type='radio'
                  name='junior-usage-type'
                  className={styles.usageTypeRadio}
                  checked={juniorUsageType === 2}
                  onChange={() => handleUsageTypeChange(2)}
                />
                中学生のみ
              </label>
              <label
                className={`${styles.usageTypeButton} ${
                  juniorUsageType === 3 ? styles.usageTypeButtonSelected : ''
                }`}
              >
                <input
                  type='radio'
                  name='junior-usage-type'
                  className={styles.usageTypeRadio}
                  checked={juniorUsageType === 3}
                  onChange={() => handleUsageTypeChange(3)}
                />
                保護者のみ
              </label>
            </div>
            {juniorUsageType === 0 && (
              <>
                <h3 className={styles.h3WithIcon}>
                  <IoMdHelpCircleOutline />
                  中学生と保護者(共通のチケット使用)とは
                </h3>
                <p>
                  1枚のチケットを発行するだけで、保護者と中学生2名分を使えるチケットです。チケットはURLを送信すれば、別々の端末でも表示可能です。
                  同じ公演を見る予定の場合には便利ですが、残り1席の公演は予約できません。
                </p>
              </>
            )}
            {juniorUsageType === 1 && (
              <>
                <h3 className={styles.h3WithIcon}>
                  <IoMdHelpCircleOutline />
                  中学生と保護者(別々のチケット使用)とは
                </h3>
                <p>
                  中学生アカウントと保護者用アカウントの2つを作成して、それぞれでチケットを取得する方式です。ここで入力した保護者情報を用いて、保護者の端末でログインしてください。
                  中学生と保護者で別々の公演を見たい場合、または残り1席の公演が見たい場合におすすめです。
                </p>
              </>
            )}
          </NormalSection>

          {juniorUsageType !== 3 && (
            <NormalSection>
              <h2 style={{ marginBottom: '0.5rem' }}>中学生アカウント情報</h2>
              <div className={styles.formGroup}>
                <label htmlFor='junior-id' className={styles.label}>
                  ID (英数字・6文字以上)
                </label>
                <input
                  id='junior-id'
                  type='text'
                  className={styles.input}
                  value={loginId}
                  onChange={(e) => setLoginId(e.currentTarget.value)}
                  placeholder='フルネームなど忘れないもの'
                  minLength={6}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <fieldset className={styles.birthdayFieldset}>
                  <legend className={styles.birthdayLegend}>生年月日</legend>
                  <label className={styles.birthdayLabel}>
                    <input
                      type='number'
                      className={styles.birthdayInput}
                      placeholder='2000'
                      inputMode='numeric'
                      value={birthdayYear}
                      required={true}
                      min={1000}
                      max={9999}
                      onChange={(e) => setBirthdayYear(e.currentTarget.value)}
                    />
                    <span>年</span>
                  </label>
                  <label className={styles.birthdayLabel}>
                    <input
                      type='number'
                      className={styles.birthdayInput}
                      placeholder='1'
                      inputMode='numeric'
                      value={birthdayMonth}
                      required={true}
                      min={1}
                      max={12}
                      onChange={(e) => setBirthdayMonth(e.currentTarget.value)}
                    />
                    <span>月</span>
                  </label>
                  <label className={styles.birthdayLabel}>
                    <input
                      type='number'
                      className={styles.birthdayInput}
                      placeholder='1'
                      inputMode='numeric'
                      value={birthdayDay}
                      required={true}
                      min={1}
                      max={31}
                      onChange={(e) => setBirthdayDay(e.currentTarget.value)}
                    />
                    <span>日</span>
                  </label>
                </fieldset>
              </div>
            </NormalSection>
          )}

          {(juniorUsageType === 1 || juniorUsageType === 3) && (
            <NormalSection>
              <h2 style={{ marginBottom: '0.5rem' }}>保護者アカウント情報</h2>
              <div className={styles.formGroup}>
                <label htmlFor='parent-id' className={styles.label}>
                  ID (
                  {juniorUsageType === 1
                    ? '中学生アカウントと同じものでも可'
                    : '英数字・6文字以上'}
                  )
                </label>
                <input
                  id='parent-id'
                  type='text'
                  className={styles.input}
                  value={parentGuardianId}
                  onChange={(e) => setParentGuardianId(e.currentTarget.value)}
                  placeholder='フルネームなど忘れないもの'
                  minLength={6}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <fieldset className={styles.birthdayFieldset}>
                  <legend className={styles.birthdayLegend}>
                    {juniorUsageType === 1 ? '保護者の生年月日' : '生年月日'}
                  </legend>
                  <label className={styles.birthdayLabel}>
                    <input
                      type='number'
                      className={styles.birthdayInput}
                      placeholder='2000'
                      inputMode='numeric'
                      value={parentBirthdayYear}
                      required={true}
                      min={1000}
                      max={9999}
                      onChange={(e) =>
                        setParentBirthdayYear(e.currentTarget.value)
                      }
                    />
                    <span>年</span>
                  </label>
                  <label className={styles.birthdayLabel}>
                    <input
                      type='number'
                      className={styles.birthdayInput}
                      placeholder='1'
                      inputMode='numeric'
                      value={parentBirthdayMonth}
                      required={true}
                      min={1}
                      max={12}
                      onChange={(e) =>
                        setParentBirthdayMonth(e.currentTarget.value)
                      }
                    />
                    <span>月</span>
                  </label>
                  <label className={styles.birthdayLabel}>
                    <input
                      type='number'
                      className={styles.birthdayInput}
                      placeholder='1'
                      inputMode='numeric'
                      value={parentBirthdayDay}
                      required={true}
                      min={1}
                      max={31}
                      onChange={(e) =>
                        setParentBirthdayDay(e.currentTarget.value)
                      }
                    />
                    <span>日</span>
                  </label>
                </fieldset>
              </div>
            </NormalSection>
          )}

          {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
          <button
            className={styles.submitButton}
            type='submit'
            disabled={loading}
          >
            {loading
              ? isIssuingTicket
                ? '発券中...'
                : '登録中...'
              : '登録する'}
          </button>
        </form>

        {showApplicationDayErrorModal ? (
          <Modal
            setIsOpen={setShowApplicationDayErrorModal}
            handleAction={() => {
              route('/');
            }}
            headingText='申し込み日時の指定エラー'
            buttonText='トップへ戻る'
            showCancelButton={false}
          >
            <p className={styles.modalText}>
              申し込み日時の情報を取得できませんでした。当選メールに記載されているURLからもう一度アクセスをお願いします。
            </p>
          </Modal>
        ) : null}

        {loading ? (
          <div
            className={styles.loadingOverlay}
            role='status'
            aria-live='polite'
          >
            <div className={styles.loadingOverlayContent}>
              <LoadingSpinner />
              <p className={styles.loadingOverlayText}>
                {isIssuingTicket
                  ? '入場専用券を発券中です...'
                  : '登録処理中です...'}
              </p>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
};

export default JuniorSignUp;
