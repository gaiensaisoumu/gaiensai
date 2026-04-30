import { useEffect, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { supabase } from '../../../lib/supabase';
import { useTitle } from '../../../hooks/useTitle';
import type { Session } from '../../../types/types';

import styles from '../students/Login.module.css';
import subPageStyles from '../../../styles/sub-pages.module.css';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';

type UserLoginProps = {
  basePath: '/students' | '/junior';
  pageTitle: string;
};

const UserLogin = ({ basePath, pageTitle }: UserLoginProps) => {
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<Session>(null);

  const initialParams = new URLSearchParams(window.location.search);
  const hasTokenHash = initialParams.get('token_hash');

  const [verifying, setVerifying] = useState(!!hasTokenHash);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authSuccess, setAuthSuccess] = useState(false);

  useTitle(`ログイン - ${pageTitle}`);

  const { route } = useLocation();

  useEffect(() => {
    const currentParams = new URLSearchParams(window.location.search);
    setAuthError(currentParams.get('error') || null);

    const token_hash = currentParams.get('token_hash');

    if (token_hash) {
      supabase.auth
        .verifyOtp({
          token_hash,
          type: 'email',
        })
        .then(({ error }) => {
          if (error) {
            setAuthError(error.message);
          } else {
            setAuthSuccess(true);
            window.history.replaceState({}, document.title, basePath);
          }
          setVerifying(false);
        });
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.unsubscribe();
  }, [basePath]);

  useEffect(() => {
    if (session) {
      route(basePath);
    }
  }, [basePath, route, session]);

  const handleLogin = async (event: Event) => {
    event.preventDefault();

    setLoading(true);
    const loginEmail = `${email}@gaiensai.local`;

    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    if (error) {
      alert(`ログインに失敗しました: ${error.message}`);
    }
    setLoading(false);
  };

  if (verifying) {
    return (
      <div>
        <h1 className={subPageStyles.pageTitle}>認証</h1>
        <LoadingSpinner message='マジックリンクの確認中...' />
      </div>
    );
  }

  if (authError) {
    let message = authError;
    if (authError === 'invalid_state') {
      message = '途中でセッションが切断されました。再度ログインしてください。';
    }
    if (authError === 'Email link is invalid or has expired') {
      message =
        'メールのURLが無効です。メールの有効期限が切れている、あるいは最新のものではない可能性があります。再度ログインしてください。';
    }
    return (
      <section>
        <h1 className={subPageStyles.pageTitle}>認証エラー</h1>
        <p>認証に失敗しました</p>
        <p>エラーメッセージ: {message}</p>
        <button
          onClick={() => {
            setAuthError(null);
            window.history.replaceState({}, document.title, basePath);
          }}
        >
          ログインページに戻る
        </button>
      </section>
    );
  }

  if (authSuccess && !session) {
    return (
      <div>
        <h1 className={subPageStyles.pageTitle}>認証</h1>
        <p>認証に成功しました！</p>
        <LoadingSpinner message='アカウントを読み込み中...' />
      </div>
    );
  }

  if (session) {
    return null;
  }

  return (
    <>
      <h1 className={subPageStyles.pageTitle}>ようこそ</h1>
      <div className={styles.loginContainer}>
        <h2>ログイン</h2>
        <p>事前配布されたログインID・パスワードを使ってログインしてください。</p>
        <form onSubmit={handleLogin} className={styles.loginForm}>
          <label>ID</label>
          <input
            type='text'
            placeholder='Your ID'
            value={email}
            required={true}
            className={styles.loginInput}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <br />
          <label>パスワード</label>
          <input
            type='password'
            placeholder='Your Password'
            value={password}
            required={true}
            className={styles.loginInput}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />

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

export default UserLogin;
