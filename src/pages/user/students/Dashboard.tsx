import { useEffect, useMemo, useState } from 'preact/hooks';
import { supabase } from '../../../lib/supabase';
import performancesSnapshot from '../../../generated/performances-static.json';
import {
  decodeTicketCodeWithEnv,
  toTicketDecodedDisplaySeed,
} from '../../../features/tickets/ticketCodeDecode';
import {
  listTicketDisplayCache,
  subscribeTicketDisplayCacheUpdated,
} from '../../../features/tickets/ticketDisplayCache';
import { useEventConfig } from '../../../hooks/useEventConfig';

import type { UserData } from '../../../types/types';
import NormalSection from '../../../components/ui/NormalSection';
import {
  type TicketCardItem,
  type TicketListSortMode,
} from '../../../features/tickets/IssuedTicketCardList';
import TicketListContent from '../../../features/tickets/TicketListContent';
import type { CachedTicketDisplay } from '../../../types/types';

import subPageStyles from '../../../styles/sub-pages.module.css';
import sharedStyles from '../../../styles/shared.module.css';
import styles from './Dashboard.module.css';
import { IoMdAdd } from 'react-icons/io';
import PerformancesTable from '../../../features/performances/PerformancesTable';
import GymPerformancesTable from '../../../features/performances/GymPerformancesTable';
import { readCachedTicketCards, writeCachedTicketCards } from './offlineCache';
import Alert from '../../../components/ui/Alert';
import { formatDateText } from '../../../utils/formatDateText';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import { useTicketStorage } from '../../../features/tickets/useTicketStorage';
import { formatTicketTypeLabel } from '../../../features/tickets/formatTicketTypeLabel';
import { useTitle } from '../../../hooks/useTitle';

type DashboardProps = {
  userData: Exclude<UserData, null>;
};

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

const Dashboard = ({ userData }: DashboardProps) => {
  const { config } = useEventConfig();
  const { saveTicketToCache } = useTicketStorage();
  const [ticketCards, setTicketCards] = useState<
    (TicketCardItem & { relationshipId: number })[]
  >([]);
  const [ticketLoading, setTicketLoading] = useState(true);
  const [ticketError, setTicketError] = useState<string | null>(null);
  const [ticketNotice, setTicketNotice] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(true);
  const [isTicketIssuingEnabled, setIsTicketIssuingEnabled] = useState(true);
  const [hasAnyActiveInviteTicketType, setHasAnyActiveInviteTicketType] =
    useState(true);
  const [myTicketSortMode, setMyTicketSortMode] = useState<TicketListSortMode>(
    () => {
      try {
        return (
          (localStorage.getItem(
            'ticketListSortMode.myTicket',
          ) as TicketListSortMode) || 'recent'
        );
      } catch {
        return 'recent';
      }
    },
  );
  const [guestTicketSortMode, setGuestTicketSortMode] =
    useState<TicketListSortMode>(() => {
      try {
        return (
          (localStorage.getItem(
            'ticketListSortMode.guestTicket',
          ) as TicketListSortMode) || 'recent'
        );
      } catch {
        return 'recent';
      }
    });
  const [ticketDisplayCacheVersion, setTicketDisplayCacheVersion] = useState(0);
  const [classInviteMode, setClassInviteMode] = useState<
    'open' | 'only-own' | 'off'
  >('open');
  const [gymInviteMode, setGymInviteMode] = useState<
    'open' | 'only-own' | 'off'
  >('open');
  const [ownClassName, setOwnClassName] = useState<string | null>(null);
  const [hasReachedIssueLimit, setHasReachedIssueLimit] = useState(false);

  useTitle('ダッシュボード - 生徒用ページ');

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
    try {
      localStorage.setItem('ticketListSortMode.myTicket', myTicketSortMode);
    } catch {
      // Ignore errors
    }
  }, [myTicketSortMode]);

  useEffect(() => {
    try {
      localStorage.setItem(
        'ticketListSortMode.guestTicket',
        guestTicketSortMode,
      );
    } catch {
      // Ignore errors
    }
  }, [guestTicketSortMode]);

  useEffect(() => {
    const refresh = () =>
      setTicketDisplayCacheVersion((previous) => previous + 1);
    const unsubscribe = subscribeTicketDisplayCacheUpdated(() => {
      refresh();
    });
    window.addEventListener('storage', refresh);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', refresh);
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

      if (data) {
        setGymInviteMode(data.gym_invite_mode);
        setClassInviteMode(data.class_invite_mode);
      }
      setHasAnyActiveInviteTicketType(!!hasActive);
    };

    void loadInviteTicketTypeState();
  }, []);

  useEffect(() => {
    const loadOwnClassName = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        return;
      }

      const { data, error } = await supabase
        .from('users')
        .select('affiliation')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        return;
      }

      const affiliation = Number(
        (data as { affiliation?: number | null } | null)?.affiliation ?? -1,
      );
      if (!Number.isInteger(affiliation) || affiliation < 10000) {
        return;
      }

      const grade = Math.floor(affiliation / 10000);
      const classNo = Math.floor((affiliation % 10000) / 100);
      if (
        grade >= 1 &&
        grade <= config.grade_number &&
        classNo >= 1 &&
        classNo <= config.class_number
      ) {
        setOwnClassName(`${grade}-${classNo}`);
      }
    };

    void loadOwnClassName();
  }, []);

  useEffect(() => {
    const loadClassInviteMode = async () => {
      try {
        const { data, error } = await supabase
          .from('ticket_issue_controls')
          .select('class_invite_mode')
          .eq('id', 1)
          .maybeSingle();

        if (error) {
          return;
        }

        const mode = (data as { class_invite_mode?: unknown } | null)
          ?.class_invite_mode;

        if (mode === 'open' || mode === 'only-own' || mode === 'off') {
          setClassInviteMode(mode);
        }
      } catch (err) {
        // 特にエラーは表示しない
      }
    };

    void loadClassInviteMode();
  }, []);

  useEffect(() => {
    const loadIssueCapacity = async () => {
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
      ] = await Promise.all([
        supabase
          .from('configs')
          .select('max_tickets_per_user')
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'valid')
          .neq('ticket_type', 4), // 入場専用券を除外
      ]);

      if (configError || countError) {
        return;
      }

      const maxTicketsPerUser = Number(configData?.max_tickets_per_user ?? -1);
      if (!Number.isInteger(maxTicketsPerUser) || maxTicketsPerUser < 0) {
        return;
      }

      const existingTicketCount = Number(count ?? 0);
      const hasReachedLimit = existingTicketCount >= maxTicketsPerUser;

      setHasReachedIssueLimit(hasReachedLimit);
    };

    void loadIssueCapacity();
  }, []);

  const isIssueReceptionStopped =
    !isTicketIssuingEnabled ||
    !hasAnyActiveInviteTicketType;

  useEffect(() => {
    const loadTickets = async () => {
      setTicketLoading(true);
      setTicketError(null);
      setTicketNotice(null);

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

      const fallbackToCachedTickets = () => {
        const cachedTickets = readCachedTicketCards(user.id);
        if (cachedTickets) {
          setTicketCards(cachedTickets);
          setTicketNotice(
            'チケット情報の取得に失敗したため、前回読み込んだ発券済みチケットを表示しています。',
          );
          setTicketError(null);
          setTicketLoading(false);
          setIsOnline(false);
          return true;
        }
        return false;
      };

      const [{ data: ticketsData, error: ticketsError }] = await Promise.all([
        supabase
          .from('tickets')
          .select('code, signature, relationship, created_at')
          .eq('user_id', user.id)
          .eq('status', 'valid')
          .order('created_at', { ascending: false }),
      ]);

      if (ticketsError) {
        if (fallbackToCachedTickets()) {
          return;
        }
        setTicketError('チケット情報の取得に失敗しました。');
        setTicketLoading(false);
        return;
      }
      setIsOnline(true);

      const tickets = (ticketsData ?? []) as Array<{
        code: string;
        signature: string;
        relationship: number;
        created_at: string;
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

      const scheduleIds = [
        ...new Set(
          decodedTickets
            .map((item) => item.decoded?.scheduleId ?? 0)
            .filter((id) => id > 0),
        ),
      ];

      const [
        { data: classPerformanceData },
        { data: gymPerformanceData },
        { data: scheduleData },
        { data: configData },
      ] = await Promise.all([
        classPerformanceIds.length > 0
          ? supabase
              .from('class_performances')
              .select('id, class_name, title')
              .in('id', classPerformanceIds)
          : { data: [] },
        gymPerformanceIds.length > 0
          ? supabase
              .from('gym_performances')
              .select('id, group_name, round_name, start_at')
              .in('id', gymPerformanceIds)
          : { data: [] },
        scheduleIds.length > 0
          ? supabase
              .from('performances_schedule')
              .select('id, start_at')
              .in('id', scheduleIds)
          : { data: [] },
        supabase
          .from('configs')
          .select('show_length')
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle(),
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
            start_at: string | null;
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

      const scheduleTimesMap = new Map(
        (
          (scheduleData ?? []) as Array<{
            id: number;
            start_at: string | null;
          }>
        ).map((schedule) => {
          const startAt = schedule.start_at
            ? new Date(schedule.start_at)
            : null;
          const showLengthMinutes = Number(configData?.show_length ?? 0);
          const endAt =
            startAt && Number.isFinite(showLengthMinutes)
              ? new Date(startAt.getTime() + showLengthMinutes * 60 * 1000)
              : null;

          return [
            schedule.id,
            {
              scheduleDate: startAt
                ? startAt.toLocaleDateString('ja-JP', {
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  })
                : '-',
              scheduleTime: startAt
                ? startAt.toLocaleTimeString('ja-JP', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '',
              scheduleEndTime: endAt
                ? endAt.toLocaleTimeString('ja-JP', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '',
            },
          ];
        }),
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
            ? (relationshipMap.get(decoded.relationshipId) ??
              `間柄${decoded.relationshipId}`)
            : '-',
          status: 'valid' as const,
          relationshipId,
        };
      });

      setTicketCards(cards);
      writeCachedTicketCards(user.id, cards);

      // Cache individual tickets to ticketDisplayCache
      void Promise.all(
        decodedTickets.map(({ ticket, decoded }) => {
          const isGymPerformance =
            (decoded?.performanceId ?? 0) > 0 &&
            (decoded?.scheduleId ?? 0) === 0;
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
          const scheduleTimes =
            !isGymPerformance && decoded
              ? scheduleTimesMap.get(decoded.scheduleId)
              : undefined;
          const isAdmissionOnly =
            decoded?.performanceId === 0 && decoded?.scheduleId === 0;

          let scheduleDate = scheduleTimes?.scheduleDate ?? '-';
          let scheduleTime = scheduleTimes?.scheduleTime ?? '';
          let scheduleEndTime = scheduleTimes?.scheduleEndTime ?? '';

          if (isAdmissionOnly) {
            const eventDates = (config.date ?? []).filter(
              (date) => typeof date === 'string' && date.length > 0,
            );
            scheduleDate = formatDateText(eventDates) || '-';
            scheduleTime = '';
            scheduleEndTime = '';
          } else if (isGymPerformance) {
            const startAt = gymPerformance?.start_at
              ? new Date(gymPerformance.start_at)
              : null;
            const showLengthMinutes = Number(configData?.show_length ?? 0);
            const endAt =
              startAt && Number.isFinite(showLengthMinutes)
                ? new Date(startAt.getTime() + showLengthMinutes * 60 * 1000)
                : null;

            scheduleDate = startAt
              ? startAt.toLocaleDateString('ja-JP', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                })
              : '-';
            scheduleTime = startAt
              ? startAt.toLocaleTimeString('ja-JP', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '';
            scheduleEndTime = endAt
              ? endAt.toLocaleTimeString('ja-JP', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '';
          }

          return saveTicketToCache(
            ticket.code,
            ticket.signature,
            {
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
              scheduleDate,
              scheduleTime,
              scheduleEndTime,
              ticketTypeLabel: decoded
                ? (ticketTypeMap.get(decoded.ticketTypeId) ??
                  `券種${decoded.ticketTypeId}`)
                : '-',
              relationshipName: decoded
                ? (relationshipMap.get(decoded.relationshipId) ??
                  `間柄${decoded.relationshipId}`)
                : '-',
              relationshipId: decoded?.relationshipId ?? ticket.relationship,
            },
            'valid',
          );
        }),
      );

      setTicketLoading(false);
    };

    void loadTickets();
  }, []);

  const ticketCardsWithLastOpenedAt = useMemo(() => {
    const lastOpenedAtByCode = new Map(
      listTicketDisplayCache<CachedTicketDisplay>().map((ticket) => [
        ticket.code,
        typeof ticket.lastOpenedAt === 'number' ? ticket.lastOpenedAt : 0,
      ]),
    );

    return ticketCards.map((ticket) => ({
      ...ticket,
      lastOpenedAt: lastOpenedAtByCode.get(ticket.code) ?? 0,
    }));
  }, [ticketCards, ticketDisplayCacheVersion]);

  const ownUseTickets = useMemo(
    () =>
      ticketCardsWithLastOpenedAt.filter(
        (ticket) => ticket.relationshipId === 1,
      ),
    [ticketCardsWithLastOpenedAt],
  );

  const guestTickets = useMemo(
    () =>
      ticketCardsWithLastOpenedAt.filter(
        (ticket) => ticket.relationshipId !== 1,
      ),
    [ticketCardsWithLastOpenedAt],
  );

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const restrictedClassName = useMemo(() => {
    const result =
      classInviteMode === 'only-own' ? (ownClassName ?? null) : null;
    return result;
  }, [classInviteMode, ownClassName]);

  const restrictedGroupNames = useMemo(() => {
    const clubs = (userData as { clubs?: string[] | null }).clubs;
    return gymInviteMode === 'only-own' ? (clubs ?? []) : null;
  }, [gymInviteMode, userData]);

  return (
    <>
      <h1 className={subPageStyles.pageTitle}>ダッシュボード</h1>
      <section>
        <h2 className={sharedStyles.normalH2}>
          {Math.floor(userData.affiliation / 10000)}-
          {Math.floor((userData.affiliation % 10000) / 100)}
          {' ' + (userData.affiliation % 100) + '番 '}
        </h2>
        <a
          href='/students/issue'
          className={`${styles.buttonLink} ${!isOnline || isIssueReceptionStopped ? styles.buttonLinkDisabled : ''}`}
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
          <p className={styles.issueOfflineNote}>
            オフライン中は新規チケットを発行できません。
          </p>
        )}
        {isOnline &&
          isTicketIssuingEnabled &&
          hasAnyActiveInviteTicketType &&
          hasReachedIssueLimit && (
            <p className={styles.issueOfflineNote}>
              最大発行可能枚数に達しているため、入場専用券のみ発券できます。
            </p>
          )}
        {isOnline &&
          (!isTicketIssuingEnabled || !hasAnyActiveInviteTicketType) && (
            <p className={styles.issueOfflineNote}>
              現在チケット発券は受付停止中です。
            </p>
          )}
      </section>
      {ticketNotice && (
        <Alert type='info'>
          <p>{ticketNotice}</p>
        </Alert>
      )}
      <NormalSection>
        <h2>発券状況</h2>
        {ticketLoading ? (
          <LoadingSpinner />
        ) : ticketError ? (
          <p>{ticketError}</p>
        ) : ticketCards.length > 0 ? (
          <div className={styles.ticketSummary}>
            <div className={styles.ticketSummaryItem}>
              <p className={styles.ticketSummaryNumber}>{ticketCards.length}</p>
              <p className={styles.ticketSummaryLabel}>合計発券枚数</p>
            </div>
            <div className={styles.ticketSummaryItem}>
              <p className={styles.ticketSummaryNumber}>
                {ownUseTickets.length}
              </p>
              <p className={styles.ticketSummaryLabel}>自分用</p>
            </div>
            <div className={styles.ticketSummaryItem}>
              <p className={styles.ticketSummaryNumber}>
                {guestTickets.length}
              </p>
              <p className={styles.ticketSummaryLabel}>招待者用</p>
            </div>
          </div>
        ) : (
          <p>まだチケットは発券されていません。</p>
        )}
      </NormalSection>
      <NormalSection>
        <h2>自分が使うチケット</h2>
        <TicketListContent
          loading={ticketLoading}
          error={ticketError}
          tickets={ownUseTickets}
          showSortControl
          sortMode={myTicketSortMode}
          onSortModeChange={setMyTicketSortMode}
          emptyMessage='自分が使うチケットはまだありません。'
        />
      </NormalSection>
      <NormalSection>
        <h2>招待者用のチケット</h2>
        <TicketListContent
          loading={ticketLoading}
          error={ticketError}
          tickets={guestTickets}
          showSortControl
          sortMode={guestTicketSortMode}
          onSortModeChange={setGuestTicketSortMode}
          emptyMessage='招待者用のチケットはまだありません。'
        />
      </NormalSection>
      <NormalSection>
        <h2>公演空き状況</h2>
        <a href='/performances' className={styles.smallButtonLink}>
          公演の詳細はこちら
        </a>
        <a href='/timetable' className={styles.smallButtonLink}>
          タイムテーブルはこちら
        </a>
        <h3>クラス公演</h3>
        <PerformancesTable
          enableIssueJump={true}
          restrictedClassName={restrictedClassName}
          filterAccepting={true}
        />
        <h3>体育館公演</h3>
        <GymPerformancesTable
          enableIssueJump={true}
          restrictedGroupNames={restrictedGroupNames}
          filterAccepting={true}
        />
      </NormalSection>
      <section>
        <button onClick={handleLogout} className={styles.logoutBtn}>
          ログアウト
        </button>
      </section>
    </>
  );
};

export default Dashboard;
