import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import { supabase } from '../../../lib/supabase';
import styles from './InitialRegistration.module.css';
import { useTitle } from '../../../hooks/useTitle';

type InitialRegistrationProps = {
  onRegistered: () => Promise<boolean>;
};

const InitialRegistration = ({ onRegistered }: InitialRegistrationProps) => {
  const [availableClubs, setAvailableClubs] = useState<string[]>([]);
  const [selectedClubs, setSelectedClubs] = useState<string[]>([]);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useTitle('初回登録 - 生徒用ページ');

  const { route } = useLocation();

  useEffect(() => {
    const fetchClubs = async () => {
      const { data, error } = await supabase
        .from('gym_performances')
        .select('group_name');

      if (!error && data) {
        const names = data.map((d) => d.group_name).filter(Boolean);
        const uniqueClubs = Array.from(new Set(names)).sort();
        setAvailableClubs(uniqueClubs);
      }
    };
    void fetchClubs();
  }, []);

  const handleSubmit = async (event: Event) => {
    event.preventDefault();
    setErrorMessage(null);

    if (password !== confirmPassword) {
      setErrorMessage('パスワードが一致しません。');
      return;
    }

    const {
      data: { user },
      error: getUserError,
    } = await supabase.auth.getUser();

    if (getUserError || !user) {
      setErrorMessage('ユーザー情報の取得に失敗しました。');
      return;
    }

    const localPart = user.email?.split('@')[0] ?? '';
    const userAffiliation = Number(localPart);

    setLoading(true);

    // パスワードの更新
    const { error: passwordError } = await supabase.auth.updateUser({
      password: password,
    });

    if (passwordError) {
      if (
        passwordError.message.includes(
          'New password should be different from the old password.',
        )
      ) {
        setErrorMessage('パスワードは古いものと異なる必要があります。');
        setLoading(false);
        return;
      }
      setErrorMessage(
        `パスワードの変更に失敗しました: ${passwordError.message}`,
      );
      setLoading(false);
      return;
    }

    // サーバーサイド関数 (RPC) で users テーブルに登録
    const { error } = await supabase.rpc('register_student', {
      affiliation: userAffiliation,
      clubs: selectedClubs.length > 0 ? selectedClubs : null,
    });

    setLoading(false);

    if (error) {
      if (error.code === '23505') {
        setErrorMessage(
          '同じ学年・クラス・番号のユーザーが既に登録されています。入力内容が正しい場合は、お手数ですが、外苑祭総務へお問い合わせください。',
        );
        return;
      }

      setErrorMessage('登録に失敗しました。時間をおいて再度お試しください。');
      return;
    }

    const didRefreshProfile = await onRegistered();
    if (!didRefreshProfile) {
      setErrorMessage(
        '登録情報の反映確認に失敗しました。時間をおいて再度お試しください。',
      );
      return;
    }

    route('/students/dashboard');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <section className={styles.registrationContainer}>
      <h1>初回登録</h1>
      <p className={styles.description}>
        初回は登録情報の設定とパスワード変更をお願いします。
      </p>
      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.clubSelection}>
          <p className={styles.label}>
            部活(所属しているものをすべて選択してください)
          </p>
          <div className={styles.checkboxGroup}>
            {availableClubs.map((club) => (
              <label key={club} className={styles.checkboxLabel}>
                <input
                  type='checkbox'
                  className={styles.checkbox}
                  checked={selectedClubs.includes(club)}
                  onChange={(e) => {
                    const isChecked = e.currentTarget.checked;
                    setSelectedClubs((prev) =>
                      isChecked
                        ? [...prev, club]
                        : prev.filter((c) => c !== club),
                    );
                  }}
                />
                {club}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.passwordSelection}>
          <p className={styles.label}>新しいパスワード (8文字以上)</p>
          <input
            type='password'
            className={styles.passwordInput}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            required
            minLength={8}
            autoComplete='new-password'
          />
          <p className={styles.label}>新しいパスワード (確認)</p>
          <input
            type='password'
            className={styles.passwordInput}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.currentTarget.value)}
            required
            minLength={8}
            autoComplete='new-password'
          />
        </div>

        {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
        <button
          className={styles.submitButton}
          type='submit'
          disabled={loading}
        >
          {loading ? '登録中...' : '登録する'}
        </button>
      </form>
      <section>
        <button onClick={handleLogout} className={styles.logoutBtn}>
          ログアウト
        </button>
      </section>
    </section>
  );
};

export default InitialRegistration;
