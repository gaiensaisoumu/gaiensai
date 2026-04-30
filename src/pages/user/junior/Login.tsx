import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { supabase } from '../../../lib/supabase';
import { useTitle } from '../../../hooks/useTitle';
import type { Session } from '../../../types/types';

import styles from '../students/Login.module.css';
import subPageStyles from '../../../styles/sub-pages.module.css';

const JuniorLogin = () => {
  const [loading, setLoading] = useState(false);
  const [loginId, setLoginId] = useState('');
  const [birthdayYear, setBirthdayYear] = useState('');
  const [birthdayMonth, setBirthdayMonth] = useState('');
  const [birthdayDay, setBirthdayDay] = useState('');
  const [session, setSession] = useState<Session>(null);

  useTitle('ログイン - 中学生用ページ');

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
    if (session) {
      route('/junior');
    }
  }, [route, session]);

  const handleLogin = async (event: Event) => {
    event.preventDefault();
    const normalizedId = loginId.trim();
    const normalizedBirthday =
      birthdayYear.trim().padStart(4, '0') +
      birthdayMonth.trim().padStart(2, '0') +
      birthdayDay.trim().padStart(2, '0');

    if (!/^\d{8}$/.test(normalizedBirthday)) {
      alert('誕生日は8桁（例: 20100401）で入力してください。');
      return;
    }

    setLoading(true);
    const compositeId = `${normalizedId}-${normalizedBirthday}`;

    const { error } = await supabase.auth.signInWithPassword({
      email: `${compositeId}@gaiensai.local`,
      password: normalizedBirthday,
    });
    if (error) {
      alert('ログインに失敗しました。IDまたは誕生日を確認してください。');
    }
    setLoading(false);
  };

  if (session) {
    return null;
  }

  return (
    <>
      <h1 className={subPageStyles.pageTitle}>ようこそ</h1>
      <div className={styles.loginContainer}>
        <h2>中学生ログイン</h2>
        <p>配布されたログインIDと誕生日を入力してください。</p>
        <form onSubmit={handleLogin} className={styles.loginForm}>
          <label>ID</label>
          <input
            type='text'
            placeholder='Your ID'
            value={loginId}
            required={true}
            className={styles.loginInput}
            onChange={(e) => setLoginId(e.currentTarget.value)}
          />
          <br />
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

          <button
            className={styles.loginButton}
            disabled={loading}
          >
            {loading ? <span>読み込み中</span> : <span>ログイン</span>}
          </button>
        </form>
      </div>
    </>
  );
};

export default JuniorLogin;
