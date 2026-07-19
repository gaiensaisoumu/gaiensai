import { useCallback, useEffect, useState } from 'preact/hooks';
import { IoMdAdd } from 'react-icons/io';
import performancesSnapshot from '../../../generated/performances-static.json';
import {
  decodeTicketCodeWithEnv,
  toTicketDecodedDisplaySeed,
} from '../../../features/tickets/ticketCodeDecode';
import type { UserData } from '../../../types/types';
import type { TicketCardItem } from '../../../features/tickets/IssuedTicketCardList';
import { useTitle } from '../../../hooks/useTitle';
import subPageStyles from '../../../styles/sub-pages.module.css';
import sharedStyles from '../../../styles/shared.module.css';
import dashboardStyles from '../students/Dashboard.module.css';
import registrationStyles from '../students/InitialRegistration.module.css';
import TicketListContent from '../../../features/tickets/TicketListContent';
import type { TicketListSortMode } from '../../../features/tickets/IssuedTicketCardList';
import NormalSection from '../../../components/ui/NormalSection';
import PerformancesTable from '../../../features/performances/PerformancesTable';
import GymPerformancesTable from '../../../features/performances/GymPerformancesTable';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import { supabase } from '../../../lib/supabase';
import { formatTicketTypeLabel } from '../../../features/tickets/formatTicketTypeLabel';
import { resolveJuniorRelationshipName } from '../../../features/tickets/juniorRelationship';
import {
  parseJuniorApplicationDaySelection,
  resolveJuniorApplicationDays,
  serializeJuniorApplicationDaySelection,
} from './applicationDay';
import { createClient } from '@supabase/supabase-js';

type TicketSnapshot = {
  performances?: Array<{
    id: number;
    class_name: string;
    title?: string | null;
  }>;
  schedules?: Array<{ id: number; round_name: string }>;
  ticketTypes?: Array<{ id: number; name: string; type?: string | null }>;
  relationships?: Array<{ id: number; name: string }>;
};

const ticketSnapshot = performancesSnapshot as TicketSnapshot;

const JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID = 7;
const SELF_RELATIONSHIP_ID = 1;
const ISSUE_POLL_MAX_RETRIES = 20;
const ISSUE_POLL_INTERVAL_MS = 300;

type AccountSplitState = {
  showConfirmation: boolean;
  showParentForm: boolean;
};

type JuniorMyPageProps = {
  userData: Exclude<UserData, null>;
};

const JuniorMyPage = ({ userData }: JuniorMyPageProps) => {
  useTitle('マイページ - 中学生用ページ');
  const [ticketCards, setTicketCards] = useState<
    (TicketCardItem & { relationshipId: number })[]
  >([]);
  const [ticketLoading, setTicketLoading] = useState(true);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isTicketIssuingEnabled, setIsTicketIssuingEnabled] = useState(true);
  const [hasAnyActiveInviteTicketType, setHasAnyActiveInviteTicketType] =
    useState(true);
  const [myTicketSortMode, setMyTicketSortMode] =
    useState<TicketListSortMode>('recent');
  const [hasReachedJuniorIssueLimit, setHasReachedJuniorIssueLimit] =
    useState(false);
  const [classApplicationDays, setClassApplicationDays] = useState<Array<
    'day1' | 'day2'
  > | null>(null);
  const [gymApplicationDays, setGymApplicationDays] = useState<Array<
    'day1' | 'day2'
  > | null>(null);
  const [accountSplit, setAccountSplit] = useState<AccountSplitState>({
    showConfirmation: false,
    showParentForm: false,
  });
  const [parentGuardianId, setParentGuardianId] = useState('');
  const [birthdayYear, setBirthdayYear] = useState('');
  const [birthdayMonth, setBirthdayMonth] = useState('');
  const [birthdayDay, setBirthdayDay] = useState('');
  const [splitLoading, setSplitLoading] = useState(false);
  const [splitErrorMessage, setSplitErrorMessage] = useState<string | null>(
    null,
  );

  const handleLogout = async () => {
    window.localStorage.removeItem('junior_application_day');
    await supabase.auth.signOut();
  };

  const handleSplitConfirmationYes = async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const email = session?.user?.email;

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
    setParentGuardianId('');
    setBirthdayYear('');
    setBirthdayMonth('');
    setBirthdayDay('');
    setSplitErrorMessage(null);
    setAccountSplit((prev) => ({
      ...prev,
      showParentForm: false,
      showConfirmation: false,
    }));
  };

  const handleParentFormSubmit = async (event: Event) => {
    event.preventDefault();

    if (!parentGuardianId.trim()) {
      setSplitErrorMessage('保護者のIDを入力してください。');
      return;
    }

    if (!birthdayYear.trim() || !birthdayMonth.trim() || !birthdayDay.trim()) {
      setSplitErrorMessage('保護者の誕生日を入力してください。');
      return;
    }

    const normalizedBirthday =
      birthdayYear.trim().padStart(4, '0') +
      birthdayMonth.trim().padStart(2, '0') +
      birthdayDay.trim().padStart(2, '0');

    if (!/^\d{8}$/.test(normalizedBirthday)) {
      setSplitErrorMessage('誕生日は8桁（例: 20100401）で入力してください。');
      return;
    }

    setSplitLoading(true);
    setSplitErrorMessage(null);

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      if (!userId) {
        setSplitErrorMessage('認証情報の取得に失敗しました。');
        setSplitLoading(false);
        return;
      }

      const parentEmail = `${parentGuardianId.trim()}-${normalizedBirthday}@gaiensai.local`;
      const parentPassword = normalizedBirthday;

      const tempClient = createClient(
        import.meta.env.VITE_SUPABASE_URL,
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY,
        { auth: { persistSession: false } },
      );

      const { data: authData, error: authError } = await tempClient.auth.signUp(
        {
          email: parentEmail,
          password: parentPassword,
        },
      );

      if (authError || !authData.user) {
        setSplitErrorMessage(
          authError?.message === 'User already registered'
            ? 'このID・パスワードの組み合わせは既に登録されています。'
            : '保護者アカウントの作成に失敗しました。',
        );
        setSplitLoading(false);
        return;
      }

      const { error: rpcError } = await supabase.rpc(
        'split_existing_junior_account',
        {
          p_parent_auth_id: authData.user.id,
          p_parent_email: parentEmail,
        },
      );

      if (rpcError) {
        setSplitErrorMessage('アカウント分割に失敗しました。');
        setSplitLoading(false);
        return;
      }

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
        setSplitErrorMessage('中学生用入場専用券の発券に失敗しました。');
        setSplitLoading(false);
        return;
      }

      try {
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
        // 保護者用チケット発券失敗は中学生側の登録プロセスを中断させない
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

        await new Promise((resolve) =>
          setTimeout(resolve, ISSUE_POLL_INTERVAL_MS),
        );
      }

      if (!issued) {
        setSplitErrorMessage('入場専用券の反映確認に失敗しました。');
        setSplitLoading(false);
        return;
      }

      window.location.reload();
    } catch (error) {
      setSplitErrorMessage('予期しないエラーが発生しました。');
      setSplitLoading(false);
    }
  };

  const handleAccountSplit = async () => {
    setAccountSplit((prev) => ({
      ...prev,
      showConfirmation: true,
    }));
  };

  const classScheduleFilter = useCallback(
    (scheduleId: number, roundName: string) => {
      const day1Schedules = [1, 2, 3, 4];
      const day2Schedules = [5, 6, 7, 8];
      const allowedScheduleIds = [
        ...(classApplicationDays?.includes('day1') ? day1Schedules : []),
        ...(classApplicationDays?.includes('day2') ? day2Schedules : []),
      ];
      if (!allowedScheduleIds.includes(scheduleId)) {
        return false;
      }
      if (
        classApplicationDays?.includes('day1') &&
        classApplicationDays?.includes('day2')
      ) {
        return true;
      }
      if (classApplicationDays?.includes('day1')) {
        return !roundName.includes('2日目');
      }
      return roundName.includes('2日目');
    },
    [classApplicationDays],
  );

  const gymScheduleFilter = useCallback(
    (_scheduleId: number, roundName: string) => {
      if (
        gymApplicationDays?.includes('day1') &&
        gymApplicationDays?.includes('day2')
      ) {
        return true;
      }
      if (gymApplicationDays?.includes('day1')) {
        return !roundName.includes('2日目');
      }
      return roundName.includes('2日目');
    },
    [gymApplicationDays],
  );

  const localPart = userData.email.replace('@gaiensai.local', '');
  const loginId = localPart.match(/^(.*)-\d{8}$/)?.[1] ?? localPart;
  const usageType = userData.junior_usage_type;
  const isIssueReceptionStopped =
    !isTicketIssuingEnabled ||
    !hasAnyActiveInviteTicketType ||
    hasReachedJuniorIssueLimit;

  useEffect(() => {
    const loadApplicationDay = async () => {
      const { classDay, gymDay } = resolveJuniorApplicationDays(
        window.location.search,
      );
      const resolvedClassDays = classDay;
      const resolvedGymDays = gymDay;

      if (resolvedClassDays && resolvedClassDays.length > 0) {
        setClassApplicationDays(resolvedClassDays);
      }

      if (resolvedGymDays && resolvedGymDays.length > 0) {
        setGymApplicationDays(resolvedGymDays);
      }

      if (resolvedClassDays || resolvedGymDays) {
        const serializedValue = serializeJuniorApplicationDaySelection(
          resolvedClassDays,
          resolvedGymDays,
        );
        if (serializedValue) {
          window.localStorage.setItem(
            'junior_application_day',
            serializedValue,
          );
        }
      }

      if (resolvedClassDays || resolvedGymDays) {
        return;
      }

      const storedSelection = parseJuniorApplicationDaySelection(
        window.localStorage.getItem('junior_application_day'),
      );
      const storedApplicationDays =
        storedSelection.classDay ?? storedSelection.gymDay;
      if (storedApplicationDays && storedApplicationDays.length > 0) {
        setClassApplicationDays(storedSelection.classDay);
        setGymApplicationDays(storedSelection.gymDay);
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .select('application_day')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        return;
      }

      const databaseSelection = parseJuniorApplicationDaySelection(
        data?.application_day,
      );
      const databaseApplicationDays =
        databaseSelection.classDay ?? databaseSelection.gymDay;
      if (databaseApplicationDays && databaseApplicationDays.length > 0) {
        setClassApplicationDays(databaseSelection.classDay);
        setGymApplicationDays(databaseSelection.gymDay);
        const serializedValue = serializeJuniorApplicationDaySelection(
          databaseSelection.classDay,
          databaseSelection.gymDay,
        );
        if (serializedValue) {
          window.localStorage.setItem(
            'junior_application_day',
            serializedValue,
          );
        }
      }
    };

    void loadApplicationDay();
  }, []);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    const loadIssuingState = async () => {
      const { data } = await supabase
        .from('configs')
        .select('is_active')
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (typeof data?.is_active === 'boolean') {
        setIsTicketIssuingEnabled(data.is_active);
      }
    };

    void loadIssuingState();
  }, []);

  useEffect(() => {
    const loadInviteTicketTypeState = async () => {
      const { data, error } = await supabase
        .from('ticket_issue_controls')
        .select(
          'class_invite_mode, rehearsal_invite_mode, gym_invite_mode, entry_only_mode',
        )
        .eq('id', 1)
        .maybeSingle();

      if (error) {
        return;
      }

      const hasActive =
        data &&
        (data.class_invite_mode !== 'off' ||
          data.rehearsal_invite_mode !== 'off' ||
          data.gym_invite_mode !== 'off' ||
          data.entry_only_mode !== 'off');

      setHasAnyActiveInviteTicketType(!!hasActive);
    };

    void loadInviteTicketTypeState();
  }, []);

  useEffect(() => {
    const loadJuniorIssueCapacity = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        return;
      }

      const [
        { data: configData, error: configError },
        { count, error: countError },
        { count: entryOnlyCount, error: entryOnlyCountError },
      ] = await Promise.all([
        supabase
          .from('configs')
          .select('max_tickets_per_junior_user')
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'valid')
          .neq('ticket_type', 7), // 入場専用券を除外
        supabase
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'valid')
          .eq('ticket_type', 7), // 入場専用券のみ
      ]);

      if (configError || countError || entryOnlyCountError) {
        return;
      }

      const maxTicketsPerJuniorUser = Number(
        configData?.max_tickets_per_junior_user ?? -1,
      );
      if (
        !Number.isInteger(maxTicketsPerJuniorUser) ||
        maxTicketsPerJuniorUser < 0
      ) {
        return;
      }

      const maxIssueCapacity =
        usageType === 1 ? maxTicketsPerJuniorUser * 2 : maxTicketsPerJuniorUser;
      const existingIssueCapacity = Number(count ?? 0);
      const hasReachedLimit =
        existingIssueCapacity >= maxIssueCapacity && entryOnlyCount !== 0;

      setHasReachedJuniorIssueLimit(hasReachedLimit);
    };

    void loadJuniorIssueCapacity();
  }, [usageType]);

  useEffect(() => {
    const loadTickets = async () => {
      setTicketLoading(true);
      setTicketError(null);

      const {
        data: { session },
        error: sessionError,
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (sessionError || !user) {
        setTicketError('ログイン情報の取得に失敗しました。');
        setTicketLoading(false);
        return;
      }

      const { data: ticketsData, error: ticketsError } = await supabase
        .from('tickets')
        .select('code, signature, relationship')
        .eq('user_id', user.id)
        .eq('status', 'valid')
        .order('created_at', { ascending: false });

      if (ticketsError) {
        setTicketError('チケット情報の取得に失敗しました。');
        setTicketLoading(false);
        return;
      }

      setIsOnline(true);
      const tickets = (ticketsData ?? []) as Array<{
        code: string;
        signature: string;
        relationship: number;
      }>;

      if (tickets.length === 0) {
        setTicketCards([]);
        setTicketLoading(false);
        return;
      }

      const decodedTickets = await Promise.all(
        tickets.map(async (ticket) => {
          const decodedRaw = await decodeTicketCodeWithEnv(ticket.code);
          return {
            ticket,
            decoded: toTicketDecodedDisplaySeed(decodedRaw),
          };
        }),
      );

      const classPerformanceIds = [
        ...new Set(
          decodedTickets
            .filter(
              (item) =>
                (item.decoded?.performanceId ?? 0) > 0 &&
                (item.decoded?.scheduleId ?? 0) > 0,
            )
            .map((item) => item.decoded?.performanceId ?? 0)
            .filter((id) => id > 0),
        ),
      ];
      const gymPerformanceIds = [
        ...new Set(
          decodedTickets
            .filter(
              (item) =>
                (item.decoded?.performanceId ?? 0) > 0 &&
                (item.decoded?.scheduleId ?? 0) === 0,
            )
            .map((item) => item.decoded?.performanceId ?? 0)
            .filter((id) => id > 0),
        ),
      ];

      const [{ data: classPerformanceData }, { data: gymPerformanceData }] =
        await Promise.all([
          classPerformanceIds.length > 0
            ? supabase
                .from('class_performances')
                .select('id, class_name, title')
                .in('id', classPerformanceIds)
            : { data: [] },
          gymPerformanceIds.length > 0
            ? supabase
                .from('gym_performances')
                .select('id, group_name, round_name')
                .in('id', gymPerformanceIds)
            : { data: [] },
        ]);

      const classPerformanceMap = new Map(
        (
          (classPerformanceData ?? []) as Array<{
            id: number;
            class_name: string;
            title: string | null;
          }>
        ).map((performance) => [performance.id, performance]),
      );
      const gymPerformanceMap = new Map(
        (
          (gymPerformanceData ?? []) as Array<{
            id: number;
            group_name: string;
            round_name: string;
          }>
        ).map((performance) => [performance.id, performance]),
      );
      const scheduleMap = new Map(
        (
          (ticketSnapshot.schedules ?? []) as Array<{
            id: number;
            round_name: string;
          }>
        ).map((schedule) => [schedule.id, schedule]),
      );
      const ticketTypeMap = new Map(
        (
          (ticketSnapshot.ticketTypes ?? []) as Array<{
            id: number;
            name: string;
            type?: string | null;
          }>
        ).map((ticketType) => [
          ticketType.id,
          formatTicketTypeLabel({
            type: ticketType.type,
            name: ticketType.name,
            fallback: `券種${ticketType.id}`,
          }),
        ]),
      );
      const relationshipMap = new Map(
        (
          (ticketSnapshot.relationships ?? []) as Array<{
            id: number;
            name: string;
          }>
        ).map((relationship) => [relationship.id, relationship.name]),
      );
      const snapshotPerformanceMap = new Map(
        (
          (ticketSnapshot.performances ?? []) as Array<{
            id: number;
            class_name: string;
            title?: string | null;
          }>
        ).map((performance) => [performance.id, performance]),
      );

      const cards = decodedTickets.map(({ ticket, decoded }) => {
        const relationshipId = decoded?.relationshipId ?? ticket.relationship;
        const juniorRelationshipName = decoded
          ? resolveJuniorRelationshipName(
              decoded.ticketTypeId,
              decoded.relationshipId,
            )
          : null;
        const isGymPerformance =
          (decoded?.performanceId ?? 0) > 0 && (decoded?.scheduleId ?? 0) === 0;
        const classPerformance = decoded
          ? (classPerformanceMap.get(decoded.performanceId) ??
            snapshotPerformanceMap.get(decoded.performanceId))
          : undefined;
        const gymPerformance = decoded
          ? gymPerformanceMap.get(decoded.performanceId)
          : undefined;
        const schedule =
          !isGymPerformance && decoded
            ? scheduleMap.get(decoded.scheduleId)
            : undefined;
        const isAdmissionOnly =
          decoded?.performanceId === 0 && decoded?.scheduleId === 0;

        return {
          code: ticket.code,
          signature: ticket.signature,
          serial: decoded?.serial,
          performanceName: isAdmissionOnly
            ? '入場専用券'
            : isGymPerformance
              ? (gymPerformance?.group_name ?? '-')
              : (classPerformance?.class_name ?? '-'),
          performanceTitle: isGymPerformance
            ? null
            : (classPerformance?.title ?? null),
          scheduleName: isAdmissionOnly
            ? ''
            : isGymPerformance
              ? (gymPerformance?.round_name ?? '-')
              : (schedule?.round_name ?? '-'),
          ticketTypeLabel: decoded
            ? (ticketTypeMap.get(decoded.ticketTypeId) ??
              `券種${decoded.ticketTypeId}`)
            : '-',
          relationshipName: decoded
            ? (juniorRelationshipName ??
              relationshipMap.get(decoded.relationshipId) ??
              `間柄${decoded.relationshipId}`)
            : '-',
          status: 'valid' as const,
          relationshipId,
        };
      });

      setTicketCards(cards);
      setTicketLoading(false);
    };

    void loadTickets();
  }, []);

  return (
    <>
      <section>
        <h1 className={subPageStyles.pageTitle}>中学生用マイページ</h1>
        <h2 className={sharedStyles.normalH2}>
          ID: {loginId}{' '}
          {usageType === 0
            ? '中学生と保護者(共通のチケット使用)'
            : usageType === 1
              ? '中学生と保護者(別々のチケット使用)'
              : usageType === 2
                ? '中学生のみ'
                : usageType === 3
                  ? '保護者のみ'
                  : '不明'}
        </h2>
        <a
          href='/junior/issue'
          className={`${dashboardStyles.buttonLink} ${!isOnline || isIssueReceptionStopped ? dashboardStyles.buttonLinkDisabled : ''}`}
          aria-disabled={!isOnline || isIssueReceptionStopped}
          tabIndex={!isOnline || isIssueReceptionStopped ? -1 : 0}
          onClick={(event) => {
            if (!isOnline || isIssueReceptionStopped) {
              event.preventDefault();
            }
          }}
        >
          <IoMdAdd />
          新規チケット発行
        </a>
        {!isOnline && (
          <p className={dashboardStyles.issueOfflineNote}>
            オフライン中は新規チケットを発行できません。
          </p>
        )}
        {isTicketIssuingEnabled &&
          hasAnyActiveInviteTicketType &&
          hasReachedJuniorIssueLimit && (
            <p className={dashboardStyles.issueOfflineNote}>
              最大発行可能枚数に達しているため、追加発券はできません。
            </p>
          )}
        {isTicketIssuingEnabled && !hasAnyActiveInviteTicketType && (
          <p className={dashboardStyles.issueOfflineNote}>
            現在チケット発券は受付停止中です。
          </p>
        )}
        {!isTicketIssuingEnabled && (
          <p className={dashboardStyles.issueOfflineNote}>
            現在チケット発券は受付停止中です。
          </p>
        )}
      </section>
      <NormalSection>
        <h2>自分が使うチケット</h2>
        <TicketListContent
          loading={ticketLoading}
          error={ticketError}
          tickets={ticketCards}
          showSortControl
          sortMode={myTicketSortMode}
          onSortModeChange={setMyTicketSortMode}
          emptyMessage='自分が使うチケットはまだありません。'
        />
      </NormalSection>
      <NormalSection>
        <h2>公演空き状況</h2>
        <a href='/performances' className={dashboardStyles.smallButtonLink}>
          公演の詳細はこちら
        </a>
        <a href='/timetable' className={dashboardStyles.smallButtonLink}>
          タイムテーブルはこちら
        </a>
        {ticketLoading ? <LoadingSpinner /> : null}
        {(() => {
          const showClassPerformances =
            !gymApplicationDays ||
            gymApplicationDays.length === 0 ||
            (classApplicationDays && classApplicationDays.length > 0);
          const showGymPerformances =
            !classApplicationDays ||
            classApplicationDays.length === 0 ||
            (gymApplicationDays && gymApplicationDays.length > 0);

          return (
            <>
              {showClassPerformances ? (
                <>
                  <h3>クラス公演</h3>
                  <PerformancesTable
                    enableIssueJump={true}
                    issuePath='/junior/issue'
                    remainingMode='junior'
                    filterAccepting={true}
                    scheduleFilter={
                      classApplicationDays && classApplicationDays.length > 0
                        ? classScheduleFilter
                        : undefined
                    }
                  />
                </>
              ) : null}
              {showGymPerformances ? (
                <>
                  <h3>体育館公演</h3>
                  <GymPerformancesTable
                    enableIssueJump={true}
                    issuePath='/junior/issue'
                    filterAccepting={true}
                    scheduleFilter={
                      gymApplicationDays && gymApplicationDays.length > 0
                        ? gymScheduleFilter
                        : undefined
                    }
                  />
                </>
              ) : null}
            </>
          );
        })()}
      </NormalSection>

      {usageType === 0 && (
        <NormalSection>
          <h2>アカウント管理</h2>

          <p>
            見たい公演が1席しか残っていない場合は、アカウントを分割することで予約ができるようになります。
            ただし、発券中のチケットはすべてキャンセルされますのでご注意ください。
          </p>
          <button onClick={handleAccountSplit} disabled={splitLoading}>
            中学生と保護者でアカウントを分割
          </button>
        </NormalSection>
      )}

      <section>
        <button onClick={handleLogout} className={dashboardStyles.logoutBtn}>
          ログアウト
        </button>
      </section>

      {/* アカウント分割確認ダイアログ */}
      {accountSplit.showConfirmation && (
        <div
          className={registrationStyles.modal}
          role='dialog'
          aria-labelledby='split-dialog-title'
        >
          <div className={registrationStyles.modalContent}>
            <h2 id='split-dialog-title'>アカウント分割確認</h2>
            <p className={registrationStyles.modalText}>
              中学生と保護者でアカウントを分割しますか？
            </p>
            <p className={registrationStyles.modalDescription}>
              「はい」を選択すると、現在のアカウントを中学生アカウントとし、保護者用アカウントの情報を入力していただきます。
            </p>
            <p className={registrationStyles.modalDescription}>
              なお、分割する際は現在発券中のすべてのチケットがキャンセルされます。また、この操作は取り消せません。
            </p>
            <div className={registrationStyles.modalActions}>
              <button
                type='button'
                onClick={handleSplitConfirmationNo}
                className={registrationStyles.modalButtonSecondary}
              >
                いいえ
              </button>
              <button
                type='button'
                onClick={handleSplitConfirmationYes}
                className={registrationStyles.modalButtonPrimary}
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
          className={registrationStyles.modal}
          role='dialog'
          aria-labelledby='parent-form-title'
        >
          <div className={registrationStyles.modalContent}>
            <h2 id='parent-form-title'>保護者情報入力</h2>
            <p>
              ここで入力した情報を用いて、保護者のデバイスでログインをお願いします。
            </p>
            <form
              onSubmit={handleParentFormSubmit}
              className={registrationStyles.parentForm}
            >
              <div className={registrationStyles.formGroup}>
                <label htmlFor='parent-id' className={registrationStyles.label}>
                  保護者のID (そのままでも可)
                </label>
                <input
                  id='parent-id'
                  type='text'
                  className={registrationStyles.input}
                  value={parentGuardianId}
                  onChange={(e) => {
                    setParentGuardianId(e.currentTarget.value);
                  }}
                  placeholder='例: 12345'
                  required
                />
              </div>

              <div className={registrationStyles.formGroup}>
                <fieldset className={registrationStyles.birthdayFieldset}>
                  <legend className={registrationStyles.birthdayLegend}>
                    保護者の生年月日
                  </legend>
                  <label className={registrationStyles.birthdayLabel}>
                    <input
                      type='number'
                      className={registrationStyles.birthdayInput}
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
                  <label className={registrationStyles.birthdayLabel}>
                    <input
                      type='number'
                      className={registrationStyles.birthdayInput}
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
                  <label className={registrationStyles.birthdayLabel}>
                    <input
                      type='number'
                      className={registrationStyles.birthdayInput}
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

              {splitErrorMessage ? (
                <p className={registrationStyles.error}>{splitErrorMessage}</p>
              ) : null}

              <div className={registrationStyles.modalActions}>
                <button
                  type='button'
                  onClick={handleCloseSplit}
                  className={registrationStyles.modalButtonSecondary}
                  disabled={splitLoading}
                >
                  キャンセル
                </button>
                <button
                  type='submit'
                  className={registrationStyles.modalButtonPrimary}
                  disabled={splitLoading}
                >
                  {splitLoading ? '分割中...' : '分割を実行'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {splitLoading && !accountSplit.showParentForm && (
        <div
          className={registrationStyles.loadingOverlay}
          role='status'
          aria-live='polite'
        >
          <div className={registrationStyles.loadingOverlayContent}>
            <LoadingSpinner />
            <p className={registrationStyles.loadingOverlayText}>
              アカウント分割処理中です...
            </p>
          </div>
        </div>
      )}
    </>
  );
};

export default JuniorMyPage;
