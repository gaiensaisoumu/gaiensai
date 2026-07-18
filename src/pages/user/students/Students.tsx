import { useEffect, useState } from 'preact/hooks';
import { Route, Router, useLocation } from 'preact-iso';
import { supabase } from '../../../lib/supabase';

import type { Session, UserData } from '../../../types/types';

import Dashboard from './Dashboard';
import InitialRegistration from './InitialRegistration';
import Issue from './Issue';
import IssueResult from './IssueResult';

import StudentLayout from '../../../layout/StudentLayout';

import {
  readCachedStudentProfile,
  writeCachedStudentProfile,
} from './offlineCache';

import styles from '../../../styles/sub-pages.module.css';
import NotFound from '../../../shared/NotFound';
import Login from './Login';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import { useTitle } from '../../../hooks/useTitle';

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

const Students = () => {
  const { path, route } = useLocation();
  const [session, setSession] = useState<AuthState>(undefined);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useTitle('生徒用ページ');

  const formatErrorMessage = (error: unknown) => {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  };

  const loadUserProfile = async (userId: string) => {
    const { data, error }: { data: UserData; error: unknown } = await supabase
      .from('users')
      .select('email, affiliation, clubs')
      .eq('id', userId)
      .maybeSingle();

    return { data, error };
  };

  useEffect(() => {
    const loadProfile = async (nextSession: Session) => {
      setSession(nextSession);
      setProfileError(null);
      setIsLoading(true);

      if (!nextSession) {
        setUserData(null);
        setIsLoading(false);
        route('/students/login');
        return;
      }

      const { data, error } = await loadUserProfile(nextSession.user.id);

      if (error) {
        const cachedProfile = readCachedStudentProfile(nextSession.user.id);
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
        writeCachedStudentProfile(nextSession.user.id, data);
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

  // register_student直後にusersの行が即時にselectで見えないタイミングがあるため
  const handleRegistered = async (): Promise<boolean> => {
    if (!session) {
      return false;
    }

    for (let i = 0; i < 3; i++) {
      const { data, error } = await loadUserProfile(session.user.id);

      if (!error && data) {
        setUserData(data);
        writeCachedStudentProfile(session.user.id, data);
        return true;
      }

      await new Promise((resolve) => {
        window.setTimeout(resolve, 200);
      });
    }

    return false;
  };

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

    if (userData && userData.affiliation >= JUNIOR_AFFILIATION_THRESHOLD) {
      route('/junior');
      return;
    }

    if (!userData && !isStudentAccount) {
      route('/junior');
      return;
    }

    if (!userData && path !== '/students/initial-registration') {
      route('/students/initial-registration');
      return;
    }

    if (
      userData &&
      (path === '/students' ||
        path === '/students/login' ||
        path === '/students/initial-registration' ||
        path === '/students/')
    ) {
      route('/students/dashboard');
    }
  }, [location, profileError, session, userData]);

  const retryLoadProfile = async () => {
    if (!session) {
      return;
    }

    setProfileError(null);
    setIsLoading(true);
    const { data, error } = await loadUserProfile(session.user.id);

    if (error) {
      const cachedProfile = readCachedStudentProfile(session.user.id);
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
      writeCachedStudentProfile(session.user.id, data);
    }
    setIsLoading(false);
  };

  if (isLoading) {
    return (
      <section>
        <h1 className={styles.pageTitle}>生徒用ページ</h1>
        <LoadingSpinner />
        <p>
          しばらく待ってもページが遷移しない場合は、
          <a href='/students/login'>ログインページ</a>または
          <a href='/students/dashboard'>ダッシュボード</a>
          のいずれかに直接アクセスしてみてください。
        </p>
        <p>不明点がありましたら、お気軽に外苑祭総務へお問い合わせください。</p>
      </section>
    );
  }

  if (!session) {
    return (
      <StudentLayout>
        <Login />
      </StudentLayout>
    );
  }

  if (profileError && userData === null) {
    return (
      <section>
        <h1 className={styles.pageTitle}>生徒用ページ</h1>
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
      <StudentLayout>
        <InitialRegistration onRegistered={handleRegistered} />
      </StudentLayout>
    );
  }

  const registeredUserData = userData;

  return (
    <StudentLayout>
      <Router>
        <Route path='/issue/result' component={IssueResult} />
        <Route path='/issue' component={Issue} />
        <Route
          path='/dashboard'
          component={() => <Dashboard userData={registeredUserData} />}
        />
        <Route
          path='/'
          component={() => <Dashboard userData={registeredUserData} />}
        />
        <Route default component={NotFound} />
      </Router>
    </StudentLayout>
  );
};

export default Students;
