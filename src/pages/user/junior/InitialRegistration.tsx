import { useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { supabase } from '../../../lib/supabase';
import {
  resolveJuniorApplicationDays,
  serializeJuniorApplicationDaySelection,
} from './applicationDay';
import { createClient } from '@supabase/supabase-js';
import styles from '../students/InitialRegistration.module.css';
import { useTitle } from '../../../hooks/useTitle';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import Modal from '../../../components/ui/Modal';
import NormalSection from '../../../components/ui/NormalSection';

type InitialRegistrationProps = {
  onRegistered: (commit?: boolean) => Promise<boolean>;
};

const JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID = 7;
const SELF_RELATIONSHIP_ID = 1;
const ISSUE_POLL_MAX_RETRIES = 20;
const ISSUE_POLL_INTERVAL_MS = 300;

type AccountSplitState = {
  showConfirmation: boolean;
  showParentForm: boolean;
  isParentRegistered: boolean;
  savedParentGuardianId: string;
  savedParentBirthDate: string;
};

const InitialRegistration = ({ onRegistered }: InitialRegistrationProps) => {
  const [juniorUsageType, setJuniorUsageType] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [isIssuingTicket, setIsIssuingTicket] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accountSplit, setAccountSplit] = useState<AccountSplitState>({
    showConfirmation: false,
    showParentForm: false,
    isParentRegistered: false,
    savedParentGuardianId: '',
    savedParentBirthDate: '',
  });
  const [parentGuardianId, setParentGuardianId] = useState('');
  const [birthdayYear, setBirthdayYear] = useState('');
  const [birthdayMonth, setBirthdayMonth] = useState('');
  const [birthdayDay, setBirthdayDay] = useState('');
  const [showApplicationDayErrorModal, setShowApplicationDayErrorModal] =
    useState(() => {
      const { classDay, gymDay } = resolveJuniorApplicationDays(
        window.location.search,
      );
      return classDay === null && gymDay === null;
    });

  useTitle('初回登録 - 中学生用ページ');

  const { route } = useLocation();

  const handleUsageTypeChange = (type: number) => {
    setJuniorUsageType(type);
    // 「別々のチケット使用」を選択した場合、確認ダイアログを表示
    if (type === 1) {
      setAccountSplit((prev) => ({
        ...prev,
        showConfirmation: true,
      }));
    }
  };

  const handleSplitConfirmationYes = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const email = session?.user?.email;

      // ログインIDを抽出（メールアドレスから@の前の部分を取得）
      const localPart = email?.replace('@gaiensai.local', '') ?? '';
      const loginId = localPart.match(/^(.*)-\d{8}$/)?.[1] ?? localPart;

      setParentGuardianId(loginId);
      setAccountSplit((prev) => ({
        ...prev,
        showConfirmation: false,
        showParentForm: true,
      }));
    } catch (error) {
      setAccountSplit((prev) => ({
        ...prev,
        showConfirmation: false,
        showParentForm: true,
      }));
    }
  };

  const handleSplitConfirmationNo = () => {
    setAccountSplit((prev) => ({
      ...prev,
      showConfirmation: false,
      showParentForm: false,
    }));
  };

  const handleCloseSplit = () => {
    // フォームのリセット
    setParentGuardianId('');
    setBirthdayYear('');
    setBirthdayMonth('');
    setBirthdayDay('');
    setErrorMessage(null);

    setAccountSplit((prev) => ({
      ...prev,
      showParentForm: false,
    }));
  };

  const handleEditParent = () => {
    // 保存されている値を復元
    if (accountSplit.isParentRegistered) {
      const birthDate = accountSplit.savedParentBirthDate;
      setParentGuardianId(accountSplit.savedParentGuardianId);
      setBirthdayYear(birthDate.substring(0, 4));
      setBirthdayMonth(birthDate.substring(4, 6));
      setBirthdayDay(birthDate.substring(6, 8));
    }

    setAccountSplit((prev) => ({
      ...prev,
      showParentForm: true,
    }));
  };

  const handleParentFormSubmit = async (event: Event) => {
    event.preventDefault();

    if (!parentGuardianId.trim()) {
      setErrorMessage('保護者のIDを入力してください。');
      return;
    }

    if (!birthdayYear.trim() || !birthdayMonth.trim() || !birthdayDay.trim()) {
      setErrorMessage('保護者の誕生日を入力してください。');
      return;
    }

    const normalizedBirthday =
      birthdayYear.trim().padStart(4, '0') +
      birthdayMonth.trim().padStart(2, '0') +
      birthdayDay.trim().padStart(2, '0');

    if (!/^\d{8}$/.test(normalizedBirthday)) {
      alert('誕生日は8桁（例: 20100401）で入力してください。');
      return;
    }

    // 親アカウント情報の一時保存
    setLoading(true);
    setErrorMessage(null);

    try {
      // 親情報を session storage に一時保存（後に使用）
      sessionStorage.setItem(
        'parentAccountData',
        JSON.stringify({
          guardianId: parentGuardianId.trim(),
          birthDate: normalizedBirthday,
        }),
      );

      // 確認表示用に保存
      setAccountSplit((prev) => ({
        ...prev,
        showParentForm: false,
        isParentRegistered: true,
        savedParentGuardianId: parentGuardianId.trim(),
        savedParentBirthDate: normalizedBirthday,
      }));

      setLoading(false);
    } catch (error) {
      setErrorMessage('予期しないエラーが発生しました。');
      setLoading(false);
    }
  };

  const handleSubmit = async (event: Event) => {
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

    setLoading(true);

    try {
      const storedApplicationDay = serializeJuniorApplicationDaySelection(
        classDay ?? null,
        gymDay ?? null,
      );
      const normalizedApplicationDay =
        storedApplicationDay ??
        window.localStorage.getItem('junior_application_day');
      let registerError;

      // アカウント分割が選択されている場合
      if (juniorUsageType === 1 && accountSplit.isParentRegistered) {
        // 1. 保護者用アカウントの情報を準備
        const parentEmail = `${accountSplit.savedParentGuardianId}-${accountSplit.savedParentBirthDate}@gaiensai.local`;
        const parentPassword = accountSplit.savedParentBirthDate;

        // 2. 保護者を Auth に登録 (現在のログインセッションを維持するため一時的なクライアントを使用)
        // supabase.auth.signUp を直接使うと、現在のセッションが保護者に切り替わってしまう可能性があるため
        const tempClient = createClient(
          import.meta.env.VITE_SUPABASE_URL,
          import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
          { auth: { persistSession: false } },
        );

        const { data: authData, error: authError } =
          await tempClient.auth.signUp({
            email: parentEmail,
            password: parentPassword,
          });

        if (authError || !authData.user) {
          setErrorMessage(
            authError?.message === 'User already registered'
              ? 'このID・誕生日の組み合わせは既に登録されています。'
              : '保護者アカウントの作成に失敗しました。',
          );
          setLoading(false);
          return;
        }

        // 3. RPCを呼び出して、中学生本人と保護者の public.users データを登録
        const { error: rpcError } = await supabase.rpc(
          'split_and_register_junior',
          {
            p_parent_auth_id: authData.user.id,
            p_parent_email: parentEmail,
            p_application_day: normalizedApplicationDay,
          },
        );
        registerError = rpcError;
      } else {
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

      const didRefreshProfile = await onRegistered(false);
      if (!didRefreshProfile) {
        setErrorMessage(
          '登録情報の反映確認に失敗しました。時間をおいて再度お試しください。',
        );
        setLoading(false);
        return;
      }

      setIsIssuingTicket(true);

      // 別々のチケット使用の場合、中学生と親両方のチケットを発行
      if (juniorUsageType === 1) {
        // 中学生用チケット発行
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

        // 保護者用チケット発行 (一時的なクライアントで保護者としてログインして実行)
        try {
          const parentEmail = `${accountSplit.savedParentGuardianId}-${accountSplit.savedParentBirthDate}@gaiensai.local`;
          const parentPassword = accountSplit.savedParentBirthDate;
          const tempClient = createClient(
            import.meta.env.VITE_SUPABASE_URL,
            import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
            { auth: { persistSession: false } },
          );

          // 保護者としてログイン
          await tempClient.auth.signInWithPassword({
            email: parentEmail,
            password: parentPassword,
          });

          // 保護者のコンテキストで発券関数を実行
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
          // 保護者側の発券失敗は、中学生側の登録プロセスを中断させないよう何もしない
          // (保護者は後で自分のマイページから手動で発券することも可能なため)
        }
      } else {
        // 共通チケット使用または単独の場合
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

      const didCommitProfile = await onRegistered(true);
      if (!didCommitProfile) {
        setErrorMessage(
          '登録情報の最終反映に失敗しました。時間をおいて再度お試しください。',
        );
        setIsIssuingTicket(false);
        setLoading(false);
        return;
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

  const handleLogout = async () => {
    setShowApplicationDayErrorModal(false);
    await supabase.auth.signOut();
  };

  return (
    <section className={styles.registrationContainer}>
      <h1>初回登録</h1>
      <p className={styles.description}>初回は利用形態の設定をお願いします。</p>
      <form className={styles.form} onSubmit={handleSubmit}>
        <NormalSection>
          <h2 style={{ marginBottom: '0.5rem' }}>利用形態</h2>
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

          {/* 保護者情報確認表示 */}
          {juniorUsageType === 1 && accountSplit.isParentRegistered && (
            <div className={styles.parentInfoConfirmation}>
              <p className={styles.parentInfoLabel}>保護者アカウント:</p>
              <div className={styles.parentInfoContent}>
                <p className={styles.parentInfoItem}>
                  <span className={styles.parentInfoTitle}>ID:</span>
                  <span className={styles.parentInfoValue}>
                    {accountSplit.savedParentGuardianId}
                  </span>
                </p>
                <p className={styles.parentInfoItem}>
                  <span className={styles.parentInfoTitle}>誕生日:</span>
                  <span className={styles.parentInfoValue}>
                    {accountSplit.savedParentBirthDate.replace(
                      /(\d{4})(\d{2})(\d{2})/,
                      '$1年$2月$3日',
                    )}
                  </span>
                </p>
              </div>
              <button
                type='button'
                onClick={handleEditParent}
                className={styles.editParentBtn}
              >
                変更
              </button>
            </div>
          )}
        </NormalSection>

        {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
        <button
          className={styles.submitButton}
          type='submit'
          disabled={loading}
        >
          {loading ? (isIssuingTicket ? '発券中...' : '登録中...') : '登録する'}
        </button>
      </form>
      <section>
        <button onClick={handleLogout} className={styles.logoutBtn}>
          ログアウト
        </button>
      </section>

      {/* アカウント分割確認ダイアログ */}
      {accountSplit.showConfirmation && (
        <div
          className={styles.modal}
          role='dialog'
          aria-labelledby='split-dialog-title'
        >
          <div className={styles.modalContent}>
            <h2 id='split-dialog-title'>アカウント分割確認</h2>
            <p className={styles.modalText}>
              中学生と保護者でアカウントを分割しますか？
            </p>
            <p className={styles.modalDescription}>
              「はい」を選択すると、現在のアカウントを中学生アカウントとし、保護者用アカウントの情報を入力していただきます。
            </p>
            <p className={styles.modalDescription}>
              「いいえ」を選択すると、一つのアカウントでチケットを2枚発行します。チケットはURLを送信すれば、別々の端末でも表示可能です。
            </p>
            <div className={styles.modalActions}>
              <button
                type='button'
                onClick={handleSplitConfirmationNo}
                className={styles.modalButtonSecondary}
              >
                いいえ
              </button>
              <button
                type='button'
                onClick={handleSplitConfirmationYes}
                className={styles.modalButtonPrimary}
              >
                はい
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 保護者情報入力フォーム */}
      {accountSplit.showParentForm && (
        <div
          className={styles.modal}
          role='dialog'
          aria-labelledby='parent-form-title'
        >
          <div className={styles.modalContent}>
            <h2 id='parent-form-title'>保護者情報入力</h2>
            <p>
              ここで入力した情報を用いて、保護者のデバイスでログインをお願いします。
            </p>
            <form
              onSubmit={handleParentFormSubmit}
              className={styles.parentForm}
            >
              <div className={styles.formGroup}>
                <label htmlFor='parent-id' className={styles.label}>
                  保護者のID (そのままでも可)
                </label>
                <input
                  id='parent-id'
                  type='text'
                  className={styles.input}
                  value={parentGuardianId}
                  onChange={(e) => {
                    setParentGuardianId(e.currentTarget.value);
                  }}
                  placeholder='例: 12345'
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <fieldset className={styles.birthdayFieldset}>
                  <legend className={styles.birthdayLegend}>
                    保護者の生年月日
                  </legend>
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

              {errorMessage ? (
                <p className={styles.error}>{errorMessage}</p>
              ) : null}

              <div className={styles.modalActions}>
                <button
                  type='submit'
                  className={styles.modalButtonPrimary}
                  disabled={loading}
                >
                  {loading ? '保存中...' : '保存'}
                </button>
                <button
                  type='button'
                  onClick={handleCloseSplit}
                  className={styles.modalButtonSecondary}
                  disabled={loading}
                >
                  キャンセル
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showApplicationDayErrorModal ? (
        <Modal
          setIsOpen={setShowApplicationDayErrorModal}
          handleAction={handleLogout}
          headingText='申し込み日時の指定エラー'
          buttonText='ログアウト'
          showCancelButton={false}
        >
          <p className={styles.modalText}>
            申し込み日時の情報を取得できませんでした。当選メールに記載されているURLからもう一度アクセスをお願いします。
          </p>
        </Modal>
      ) : null}

      {loading && !accountSplit.showParentForm ? (
        <div className={styles.loadingOverlay} role='status' aria-live='polite'>
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
  );
};

export default InitialRegistration;
