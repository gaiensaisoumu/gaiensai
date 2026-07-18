import { useEffect, useState } from 'preact/hooks';
import { Route, Router, useLocation } from 'preact-iso';
import { supabase } from '../../../lib/supabase';

import type { Session, UserData } from '../../../types/types';

import JuniorMyPage from './JuniorMyPage';
import Issue from './Issue';
import IssueResult from './IssueResult';

import JuniorLayout from '../../../layout/JuniorLayout';
import {
  readCachedJuniorProfile,
  writeCachedJuniorProfile,
} from './offlineCache';

import styles from '../../../styles/sub-pages.module.css';
import NotFound from '../../../shared/NotFound';
import Login from './Login';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import { useTitle } from '../../../hooks/useTitle';
import InitialRegistration from './InitialRegistration';

type AuthState = Session | undefined;
const JUNIOR_AFFILIATION_THRESHOLD = 100000;
const STUDENT_ID_MIN = 10000;
const STUDENT_ID_MAX = 40000;

const isStudentAccountByEmail = (email?: string | null): boolean => {
  const localPart = email?.split('@')[0] ?? '';
  const idAsNumber = Number(localPart);
  return (
    Number.isInteger(idAsNumber) &&
    idAsNumber >= STUDENT_ID_MIN &&
    idAsNumber <= STUDENT_ID_MAX
  );
};

const Junior = () => {
  const { path, route } = useLocation();
  const [session, setSession] = useState<AuthState>(undefined);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useTitle('中学生用ページ');

  const formatErrorMessage = (error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  };

  const preserveQuery = (targetPath: string): string => {
    const search = window.location.search;
    if (!search || targetPath.includes('?')) {
      return targetPath;
    }
    return `${targetPath}${search}`;
  };

  const loadUserProfile = async (userId: string) => {
    const { data, error }: { data: UserData; error: unknown } = await supabase
      .from('users')
      .select('email, affiliation, junior_usage_type')
      .eq('id', userId)
      .maybeSingle();

    return { data, error };
  };

  // register_junior直後にusersの行が即時にselectで見えないタイミングがあるため
  const handleRegistered = async (commit = true): Promise<boolean> => {
    if (!session) {
      return false;
    }

    for (let i = 0; i < 3; i++) {
      const { data, error } = await loadUserProfile(session.user.id);

      if (!error && data) {
        if (commit) {
          setUserData(data);
          writeCachedJuniorProfile(session.user.id, data);
        }
        return true;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 200);
      });
    }

    return false;
  };

  useEffect(() => {
    const loadProfile = async (nextSession: Session) => {
      setSession(nextSession);
      setProfileError(null);
      setIsLoading(true);

      if (!nextSession) {
        setUserData(null);
        setIsLoading(false);
        route(preserveQuery('/junior/login'));
        return;
      }

      const { data, error } = await loadUserProfile(nextSession.user.id);

      if (error) {
        const cachedProfile = readCachedJuniorProfile(nextSession.user.id);
        if (cachedProfile) {
          setUserData(cachedProfile);
          setIsLoading(false);
          return;
        }

        setProfileError(formatErrorMessage(error));
        setIsLoading(false);
        return;
      }

      setUserData(data);
      if (data) {
        writeCachedJuniorProfile(nextSession.user.id, data);
      }
      setIsLoading(false);
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      void loadProfile(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      void loadProfile(nextSession);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session === undefined || userData === undefined) {
      return;
    }

    if (!session) {
      return;
    }

    if (profileError) {
      return;
    }

    const isStudentAccount = isStudentAccountByEmail(session.user.email);

    if (userData && userData.affiliation < JUNIOR_AFFILIATION_THRESHOLD) {
      route(preserveQuery('/students'));
      return;
    }

    if (!userData && isStudentAccount) {
      route(preserveQuery('/students'));
      return;
    }

    if (
      userData &&
      (path === '/junior' || path === '/junior/login' || path === '/junior/')
    ) {
      route(preserveQuery('/junior/mypage'));
    }
  }, [path, profileError, route, session, userData]);

  const retryLoadProfile = async () => {
    if (!session) {
      return;
    }

    setProfileError(null);
    setIsLoading(true);
    const { data, error } = await loadUserProfile(session.user.id);

    if (error) {
      const cachedProfile = readCachedJuniorProfile(session.user.id);
      if (cachedProfile) {
        setUserData(cachedProfile);
        setIsLoading(false);
        return;
      }

      setProfileError(formatErrorMessage(error));
      setIsLoading(false);
      return;
    }

    setUserData(data);
    if (data) {
      writeCachedJuniorProfile(session.user.id, data);
    }
    setIsLoading(false);
  };

  if (isLoading) {
    return (
      <section>
        <h1 className={styles.pageTitle}>中学生用ページ</h1>
        <LoadingSpinner />
        <p>
          しばらく待ってもページが遷移しない場合は、
          <a href={preserveQuery('/junior/login')}>ログインページ</a>または
          <a href={preserveQuery('/junior/mypage')}>マイページ</a>
          のいずれかに直接アクセスしてみてください。
        </p>
        <p>不明点がありましたら、お気軽に外苑祭総務へお問い合わせください。</p>
      </section>
    );
  }

  if (!session) {
    return (
      <JuniorLayout>
        <Login />
      </JuniorLayout>
    );
  }

  if (profileError && userData === null) {
    return (
      <section>
        <h1 className={styles.pageTitle}>中学生用ページ</h1>
        <h2>プロフィールを読み込めませんでした</h2>
        <p>オフライン状態、または通信エラーの可能性があります。</p>
        <p>通信状態を確認して、再読み込みをお試しください。</p>
        <button type='button' onClick={() => void retryLoadProfile()}>
          再試行
        </button>
        <p>詳細: {profileError}</p>
      </section>
    );
  }

  if (userData === null) {
    return (
      <JuniorLayout>
        <InitialRegistration onRegistered={handleRegistered} />
      </JuniorLayout>
    );
  }

  const registeredUserData = userData;

  return (
    <JuniorLayout>
      <Router>
        <Route path='/issue/result' component={IssueResult} />
        <Route path='/issue' component={Issue} />
        <Route
          path='/mypage'
          component={() => <JuniorMyPage userData={registeredUserData} />}
        />
        <Route
          path='/'
          component={() => <JuniorMyPage userData={registeredUserData} />}
        />
        <Route default component={NotFound} />
      </Router>
    </JuniorLayout>
  );
};

export default Junior;
