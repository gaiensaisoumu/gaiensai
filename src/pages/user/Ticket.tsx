import { useEffect, useMemo, useState } from 'preact/hooks';
import { useLocation, type RoutePropsForPath } from 'preact-iso';

import Alert from '../../components/ui/Alert.tsx';
import QRCode from '../../components/ui/QRCode.tsx';
import { useEventConfig } from '../../hooks/useEventConfig.ts';
import { supabase } from '../../lib/supabase.ts';
import performancesSnapshot from '../../generated/performances-static.json';
import {
  listTicketDisplayCache,
  readTicketDisplayCache,
  subscribeTicketDisplayCacheUpdated,
  touchTicketDisplayCacheOpenedAt,
  writeTicketDisplayCache,
} from '../../features/tickets/ticketDisplayCache.ts';
import { type TicketDecodedDisplaySeed } from '../../features/tickets/ticketCodeDecode.ts';
import { formatTicketTypeLabel } from '../../features/tickets/formatTicketTypeLabel.ts';
import { resolveJuniorRelationshipName } from '../../features/tickets/juniorRelationship.ts';

import pageStyles from '../../styles/sub-pages.module.css';
import styles from './Ticket.module.css';
import { MdClose } from 'react-icons/md';
import TicketListContent from '../../features/tickets/TicketListContent.tsx';
import type { CachedTicketDisplay } from '../../types/types.ts';
import { useDecodedSerialTickets } from '../../features/tickets/useDecodedSerialTickets.ts';
import type {
  TicketCardItem,
  TicketCardStatus,
  TicketListSortMode,
} from '../../features/tickets/IssuedTicketCardList.tsx';
import { useTurnstile } from '../../hooks/useTurnstile.ts';
import { YEAR_BITS } from '../../../supabase/functions/_shared/ticketDataType.ts';
import iconUrl from '../../assets/icon.webp';
import { formatDateText } from '../../utils/formatDateText.ts';
import { useTicketStorage } from '../../features/tickets/useTicketStorage.ts';
import LoadingSpinner from '../../components/ui/LoadingSpinner.tsx';
import { useTitle } from '../../hooks/useTitle.ts';

type TicketDisplay = TicketDecodedDisplaySeed & {
  code: string;
  signature: string;
  performanceName: string;
  performanceTitle: string | null;
  scheduleName: string;
  scheduleDate: string;
  scheduleTime: string;
  scheduleEndTime: string;
  ticketTypeLabel: string;
  relationshipName: string;
  status: TicketStatus;
};

type TicketStatus = TicketCardStatus;

type TicketValidityCheckResult = {
  status: TicketStatus;
  errorMessage: string | null;
};

type SnapshotPerformance = {
  id: number;
  class_name: string;
};

type SnapshotSchedule = {
  id: number;
  round_name: string;
  start_at?: string | null;
};

type SnapshotNamedMaster = {
  id: number;
  name: string;
};

type SnapshotTicketType = SnapshotNamedMaster & {
  type?: string | null;
};

type RelationshipOption = {
  id: number;
  name: string;
};

type TicketSnapshot = {
  generatedAt: string | null;
  performances: SnapshotPerformance[];
  schedules: SnapshotSchedule[];
  ticketTypes?: SnapshotTicketType[];
  relationships?: SnapshotNamedMaster[];
  showLengthMinutes?: number | null;
};

const ticketSnapshot = performancesSnapshot as TicketSnapshot;
const ticketTypeSnapshotById = new Map(
  (ticketSnapshot.ticketTypes ?? []).map((ticketType) => [
    ticketType.id,
    ticketType,
  ]),
);

const resolveTicketTypeLabel = (params: {
  ticketTypeId: number;
  name?: string | null;
}): string => {
  const snapshotTicketType = ticketTypeSnapshotById.get(params.ticketTypeId);
  return formatTicketTypeLabel({
    type: snapshotTicketType?.type,
    name: params.name ?? snapshotTicketType?.name,
  });
};

const isCurrentTicketYear = (year: unknown, currentYear: unknown): boolean => {
  const ticketYear = Number(year);
  const eventYear = Number(currentYear);
  if (!Number.isInteger(ticketYear) || !Number.isInteger(eventYear)) {
    return false;
  }

  const currentYearModulo = eventYear % 2 ** Number(YEAR_BITS);
  return ticketYear === currentYearModulo;
};

const checkTicketValidity = async (
  code: string,
): Promise<TicketValidityCheckResult> => {
  const cachedStatus = readTicketDisplayCache<{ status: TicketStatus }>(
    code,
  )?.status;
  if (cachedStatus === 'cancelled') {
    return {
      status: 'cancelled',
      errorMessage: 'このチケットはキャンセルされています。',
    };
  }

  const { data, error } = await supabase
    .from('tickets')
    .select('status')
    .eq('code', code)
    .maybeSingle();

  if (error) {
    return {
      status: 'unknown',
      errorMessage: `チケットの有効性確認に失敗しました。デバイスがオフラインの場合、または障害が発生している場合は、このエラーが発生する可能性があります。
    これが正規で未使用のQRコードであれば、そのままご入場いただけます。不明点がありましたら、お気軽に外苑祭総務にお問い合わせください。`,
    };
  }

  const status = (data as { status?: string } | null)?.status;

  if (status === 'used') {
    return {
      status: 'used',
      errorMessage: 'このチケットはすでに使用されています。',
    };
  }
  if (status === 'cancelled') {
    const existing = readTicketDisplayCache<Record<string, unknown>>(code);
    if (existing) {
      existing.status = 'cancelled';
      writeTicketDisplayCache(code, existing);
    }
    return {
      status: 'cancelled',
      errorMessage: 'このチケットはキャンセルされています。',
    };
  }
  if (!status) {
    return {
      status: 'missing',
      errorMessage: 'このチケットは存在しないか、無効です。',
    };
  }
  if (status !== 'valid') {
    return {
      status: 'unknown',
      errorMessage: 'このチケットは無効です。',
    };
  }

  return {
    status: 'valid',
    errorMessage: null,
  };
};

const readFunctionErrorMessage = async (error: unknown): Promise<string> => {
  const fallback =
    error instanceof Error ? error.message : '不明なエラーが発生しました。';

  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const context = (error as { context?: unknown }).context;
  if (!context) {
    return fallback;
  }

  try {
    const response =
      context instanceof Response
        ? context.clone()
        : (context as {
            json?: () => Promise<unknown>;
            text?: () => Promise<string>;
          });

    if (typeof response.json === 'function') {
      const payload = await response.json();
      if (payload && typeof payload === 'object') {
        const maybeMessage =
          (payload as { error?: unknown; message?: unknown; msg?: unknown })
            .error ??
          (payload as { message?: unknown }).message ??
          (payload as { msg?: unknown }).msg;

        if (typeof maybeMessage === 'string' && maybeMessage.length > 0) {
          return maybeMessage;
        }
      }
    }

    if (typeof response.text === 'function') {
      const text = await response.text();
      if (text.length > 0) {
        return text;
      }
    }
  } catch {
    return fallback;
  }

  return fallback;
};

const Ticket = (props: RoutePropsForPath<'/t/:id'>) => {
  const { config } = useEventConfig();
  const { saveTicketToCache } = useTicketStorage();
  const [showCopySucceed, setShowCopySucceed] = useState(false);
  const [isShortUrlModalOpen, setIsShortUrlModalOpen] = useState(false);
  const [issuedShortUrl, setIssuedShortUrl] = useState('');
  const [isIssuingShortUrl, setIsIssuingShortUrl] = useState(false);
  const [showShortUrlCopySucceed, setShowShortUrlCopySucceed] = useState(false);
  const [isRelationshipModalOpen, setIsRelationshipModalOpen] = useState(false);
  const [relationships, setRelationships] = useState<RelationshipOption[]>([]);
  const [relationshipLoading, setRelationshipLoading] = useState(false);
  const [relationshipError, setRelationshipError] = useState<string | null>(
    null,
  );
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<
    number | null
  >(null);
  const [isChangingRelationship, setIsChangingRelationship] = useState(false);
  const [ticket, setTicket] = useState<TicketDisplay>({
    code: '',
    signature: '',
    affiliation: '-',
    ticketTypeId: 0,
    relationshipId: 0,
    performanceId: 0,
    scheduleId: 0,
    year: '',
    serial: 0,
    performanceName: '-',
    performanceTitle: null,
    scheduleName: '-',
    scheduleDate: '-',
    scheduleTime: '',
    scheduleEndTime: '',
    ticketTypeLabel: '-',
    relationshipName: '-',
    status: 'unknown',
  });
  const [loading, setLoading] = useState(true);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  const [warningMessages, setWarningMessages] = useState<string[]>([]);
  const [ticketStatus, setTicketStatus] = useState<TicketStatus>('unknown');
  const [cacheVersion, setCacheVersion] = useState(0);

  // 中学生チケットかどうかを判定（affiliationが10000超なら中学生）
  const isJuniorTicket = useMemo(() => {
    const affiliationNum = Number(ticket.affiliation);
    return !isNaN(affiliationNum) && affiliationNum > 10000;
  }, [ticket.affiliation]);

  const [sortMode, setSortMode] = useState<TicketListSortMode>(() => {
    try {
      const saved = localStorage.getItem('ticketListSortMode');
      return (saved as TicketListSortMode) || 'recent';
    } catch {
      return 'recent';
    }
  });

  useTitle('チケット');

  useEffect(() => {
    try {
      localStorage.setItem('ticketListSortMode', sortMode);
    } catch {
      // Ignore errors in saving to localStorage
    }
  }, [sortMode]);

  const turnstileContainerId = 'issue-turnstile-widget';
  const {
    token: turnstileToken,
    hasSiteKey: hasTurnstileSiteKey,
    getToken: getTurnstileToken,
    reset: resetTurnstile,
  } = useTurnstile({ containerId: turnstileContainerId });

  const token = props.id;

  const { route } = useLocation();

  if (!token) {
    route('/');
    return null;
  }

  const [code, signature] = token.split('.');

  useEffect(() => {
    const loadTicket = async () => {
      if (!code || !signature) {
        setErrorMessages(['チケットURLの形式が正しくありません。']);
        setTicketStatus('unknown');
        setLoading(false);
        return;
      }

      setLoading(true);
      setErrorMessages([]);
      setWarningMessages([]);
      const nonBlockingErrors: string[] = [];

      // ステップ1: 復号化のみを実行（署名検証はバックグラウンド）
      let decoded: TicketDecodedDisplaySeed | null = null;
      try {
        const { decodeTicketCodeWithEnv, toTicketDecodedDisplaySeed } =
          await import('../../features/tickets/ticketCodeDecode.ts');
        const decodedRaw = await decodeTicketCodeWithEnv(code);
        decoded = toTicketDecodedDisplaySeed(decodedRaw);
        if (!decoded) {
          setErrorMessages(['チケット情報の復元に失敗しました。']);
          setTicketStatus('unknown');
          setLoading(false);
          return;
        }
      } catch {
        setErrorMessages(['チケット情報の復元に失敗しました。']);
        setTicketStatus('unknown');
        setLoading(false);
        return;
      }

      touchTicketDisplayCacheOpenedAt(code);

      const cached = readTicketDisplayCache<TicketDisplay>(code);
      if (cached) {
        // キャッシュがある場合：キャッシュですぐに表示
        const resolvedCachedTicket: TicketDisplay = {
          ...cached,
          signature,
          serial:
            typeof cached.serial === 'number' ? cached.serial : decoded.serial,
        };

        if (!isCurrentTicketYear(decoded.year, config.year)) {
          setWarningMessages(['今年度のチケットではありません。']);
        }

        setTicket(resolvedCachedTicket);
        setTicketStatus(cached.status);
        setErrorMessages(nonBlockingErrors);
        setLoading(false);

        // バックグラウンドで署名検証とステータス確認を実行
        void (async () => {
          const { verifyTicketSignature } =
            await import('../../features/tickets/ticketCodeDecode.ts');
          const [signatureIsValid, validityResult] = await Promise.all([
            verifyTicketSignature(code, signature),
            checkTicketValidity(code),
          ]);

          let hasUpdates = false;
          const updatedTicket = { ...resolvedCachedTicket };

          if (!signatureIsValid) {
            setErrorMessages((prev) => [
              ...prev,
              'チケット署名の検証に失敗しました。不正なチケットの可能性があります。',
            ]);
          }

          if (validityResult.status !== cached.status) {
            updatedTicket.status = validityResult.status;
            hasUpdates = true;
          }

          if (hasUpdates) {
            setTicket(updatedTicket);
            setTicketStatus(validityResult.status);
            writeTicketDisplayCache(code, updatedTicket);
          }

          if (validityResult.errorMessage) {
            setErrorMessages((prev) =>
              prev.includes(validityResult.errorMessage!)
                ? prev
                : [...prev, validityResult.errorMessage!],
            );
          }
        })();
        return;
      }

      const isAdmissionOnly =
        decoded.performanceId === 0 && decoded.scheduleId === 0;
      const isGymPerformance =
        decoded.performanceId > 0 && decoded.scheduleId === 0;

      const snapshotPerformance = ticketSnapshot.performances.find(
        (performance) => performance.id === decoded.performanceId,
      );
      const snapshotSchedule = ticketSnapshot.schedules.find(
        (schedule) => schedule.id === decoded.scheduleId,
      );
      const snapshotTicketType = (ticketSnapshot.ticketTypes ?? []).find(
        (ticketType) => ticketType.id === decoded.ticketTypeId,
      );
      const snapshotRelationship = (ticketSnapshot.relationships ?? []).find(
        (relationship) => relationship.id === decoded.relationshipId,
      );

      // スナップショットから初期データを準備
      let performanceName = '-';
      const performanceTitle: string | null = null;
      let scheduleName = '-';
      let scheduleDate = '-';
      let scheduleTime = '';
      let scheduleEndTime = '';
      const ticketTypeLabel = resolveTicketTypeLabel({
        ticketTypeId: decoded.ticketTypeId,
        name: snapshotTicketType?.name,
      });
      const relationshipName =
        resolveJuniorRelationshipName(
          decoded.ticketTypeId,
          decoded.relationshipId,
        ) ??
        snapshotRelationship?.name ??
        '-';

      if (isAdmissionOnly) {
        performanceName = '入場専用券';
        scheduleName = '';
        const eventDates = (config.date ?? []).filter(
          (date) => typeof date === 'string' && date.length > 0,
        );
        scheduleDate = formatDateText(eventDates);
        scheduleTime = '';
        scheduleEndTime = '';
      } else if (isGymPerformance) {
        performanceName = '体育館公演';
        scheduleName = '-';
        scheduleDate = '-';
        scheduleTime = '-';
        scheduleEndTime = '-';
      } else {
        const startAt = snapshotSchedule?.start_at
          ? new Date(snapshotSchedule.start_at)
          : null;
        const showLengthMinutes = Number(ticketSnapshot.showLengthMinutes ?? 0);
        const endAt =
          startAt && Number.isFinite(showLengthMinutes)
            ? new Date(startAt.getTime() + showLengthMinutes * 60 * 1000)
            : null;

        performanceName = snapshotPerformance?.class_name ?? '-';
        scheduleName = snapshotSchedule?.round_name ?? '-';
        scheduleTime = startAt
          ? startAt.toLocaleTimeString('ja-JP', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '-';
        scheduleEndTime = endAt
          ? endAt.toLocaleTimeString('ja-JP', {
              hour: '2-digit',
              minute: '2-digit',
            })
          : '-';
        scheduleDate = startAt
          ? startAt.toLocaleDateString('ja-JP', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
            })
          : '-';
      }

      // スナップショットデータで初期表示
      const snapshotTicket: TicketDisplay = {
        ...decoded,
        code,
        signature,
        performanceName,
        performanceTitle,
        scheduleName,
        scheduleDate,
        scheduleTime,
        scheduleEndTime,
        ticketTypeLabel,
        relationshipName,
        status: 'unknown',
      };
      setTicket(snapshotTicket);
      setTicketStatus('unknown');
      setErrorMessages(nonBlockingErrors);
      if (!isCurrentTicketYear(decoded.year, config.year)) {
        setWarningMessages(['今年度のチケットではありません。']);
      }
      setLoading(false);

      // バックグラウンドで署名検証、有効性確認を実行
      void (async () => {
        // 署名検証と有効性確認を並列実行
        const { verifyTicketSignature } =
          await import('../../features/tickets/ticketCodeDecode.ts');
        const [signatureIsValid, validityResult] = await Promise.all([
          verifyTicketSignature(code, signature),
          checkTicketValidity(code),
        ]);

        if (!signatureIsValid) {
          setErrorMessages((prev) =>
            prev.includes('チケット署名の検証に失敗しました')
              ? prev
              : [
                  ...prev,
                  'チケット署名の検証に失敗しました。不正なチケットの可能性があります。',
                ],
          );
        }

        setTicketStatus(validityResult.status);

        try {
          if (isAdmissionOnly) {
            const juniorRelationshipName = resolveJuniorRelationshipName(
              decoded.ticketTypeId,
              decoded.relationshipId,
            );
            const [ticketTypeRes, relationshipRes] = await Promise.all([
              supabase
                .from('ticket_types')
                .select('name')
                .eq('id', decoded.ticketTypeId)
                .maybeSingle(),
              juniorRelationshipName !== null
                ? Promise.resolve({
                    data: { name: juniorRelationshipName },
                    error: null,
                  })
                : supabase
                    .from('relationships')
                    .select('name')
                    .eq('id', decoded.relationshipId)
                    .maybeSingle(),
            ]);

            if (
              ticketTypeRes.error ||
              relationshipRes.error ||
              !ticketTypeRes.data ||
              !relationshipRes.data
            ) {
              return;
            }

            const updatedTicket: TicketDisplay = {
              ...snapshotTicket,
              ticketTypeLabel: resolveTicketTypeLabel({
                ticketTypeId: decoded.ticketTypeId,
                name: ticketTypeRes.data.name,
              }),
              relationshipName: relationshipRes.data.name ?? '-',
              status: validityResult.status,
            };
            setTicket(updatedTicket);
            void saveTicketToCache(
              code,
              signature,
              {
                performanceName: updatedTicket.performanceName,
                performanceTitle: updatedTicket.performanceTitle,
                scheduleName: updatedTicket.scheduleName,
                scheduleDate: updatedTicket.scheduleDate,
                scheduleTime: updatedTicket.scheduleTime,
                scheduleEndTime: updatedTicket.scheduleEndTime,
                ticketTypeLabel: updatedTicket.ticketTypeLabel,
                relationshipName: updatedTicket.relationshipName,
                relationshipId: updatedTicket.relationshipId,
              },
              validityResult.status,
            );
          } else {
            const [
              ticketTypeRes,
              relationshipRes,
              classPerformanceRes,
              scheduleRes,
              gymPerformanceRes,
              configRes,
            ] = await Promise.all([
              supabase
                .from('ticket_types')
                .select('name')
                .eq('id', decoded.ticketTypeId)
                .maybeSingle(),
              (() => {
                const juniorRelationshipName = resolveJuniorRelationshipName(
                  decoded.ticketTypeId,
                  decoded.relationshipId,
                );
                if (juniorRelationshipName !== null) {
                  return Promise.resolve({
                    data: { name: juniorRelationshipName },
                    error: null,
                  });
                }
                return supabase
                  .from('relationships')
                  .select('name')
                  .eq('id', decoded.relationshipId)
                  .maybeSingle();
              })(),
              supabase
                .from('class_performances')
                .select('class_name, title')
                .eq('id', decoded.performanceId)
                .maybeSingle(),
              supabase
                .from('performances_schedule')
                .select('round_name, start_at')
                .eq('id', decoded.scheduleId)
                .maybeSingle(),
              isGymPerformance
                ? supabase
                    .from('gym_performances')
                    .select('group_name, round_name, start_at')
                    .eq('id', decoded.performanceId)
                    .maybeSingle()
                : { data: null, error: null },
              supabase
                .from('configs')
                .select('show_length')
                .order('id', { ascending: true })
                .limit(1)
                .maybeSingle(),
            ]);

            if (
              ticketTypeRes.error ||
              relationshipRes.error ||
              classPerformanceRes.error ||
              (isGymPerformance
                ? gymPerformanceRes.error
                : scheduleRes.error) ||
              configRes.error ||
              !ticketTypeRes.data ||
              !relationshipRes.data ||
              (!isGymPerformance &&
                (!classPerformanceRes.data || !scheduleRes.data)) ||
              (isGymPerformance && !gymPerformanceRes.data)
            ) {
              return;
            }

            // Supabaseから取得した詳細情報を処理
            const updatedPerformanceName = isGymPerformance
              ? (gymPerformanceRes.data?.group_name ?? '-')
              : (classPerformanceRes.data?.class_name ?? '-');
            const updatedPerformanceTitle = isGymPerformance
              ? null
              : (classPerformanceRes.data?.title ?? null);
            const updatedScheduleName = isGymPerformance
              ? (gymPerformanceRes.data?.round_name ?? '-')
              : (scheduleRes.data?.round_name ?? '-');
            let updatedScheduleDate = '-';
            let updatedScheduleTime = '';
            let updatedScheduleEndTime = '';

            const sourceStartAt = isGymPerformance
              ? gymPerformanceRes.data?.start_at
              : scheduleRes.data?.start_at;
            const startAt = sourceStartAt ? new Date(sourceStartAt) : null;
            const showLengthMinutes = Number(configRes.data?.show_length ?? 0);
            const endAt =
              startAt && Number.isFinite(showLengthMinutes)
                ? new Date(startAt.getTime() + showLengthMinutes * 60 * 1000)
                : null;

            updatedScheduleTime = startAt
              ? startAt.toLocaleTimeString('ja-JP', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '-';
            updatedScheduleEndTime = endAt
              ? endAt.toLocaleTimeString('ja-JP', {
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '-';
            updatedScheduleDate = startAt
              ? startAt.toLocaleDateString('ja-JP', {
                  year: 'numeric',
                  month: '2-digit',
                  day: '2-digit',
                })
              : '-';

            const updatedTicket: TicketDisplay = {
              ...snapshotTicket,
              performanceName: updatedPerformanceName,
              performanceTitle: updatedPerformanceTitle,
              scheduleName: updatedScheduleName,
              scheduleDate: updatedScheduleDate,
              scheduleTime: updatedScheduleTime,
              scheduleEndTime: updatedScheduleEndTime,
              ticketTypeLabel: resolveTicketTypeLabel({
                ticketTypeId: decoded.ticketTypeId,
                name: ticketTypeRes.data.name,
              }),
              relationshipName: relationshipRes.data.name ?? '-',
              status: validityResult.status,
            };
            setTicket(updatedTicket);
            void saveTicketToCache(
              code,
              signature,
              {
                performanceName: updatedTicket.performanceName,
                performanceTitle: updatedTicket.performanceTitle,
                scheduleName: updatedTicket.scheduleName,
                scheduleDate: updatedTicket.scheduleDate,
                scheduleTime: updatedTicket.scheduleTime,
                scheduleEndTime: updatedTicket.scheduleEndTime,
                ticketTypeLabel: updatedTicket.ticketTypeLabel,
                relationshipName: updatedTicket.relationshipName,
                relationshipId: updatedTicket.relationshipId,
              },
              validityResult.status,
            );
          }

          if (validityResult.errorMessage) {
            setErrorMessages((prev) =>
              prev.includes(validityResult.errorMessage!)
                ? prev
                : [...prev, validityResult.errorMessage!],
            );
          }
        } catch {
          // バックグラウンド更新に失敗してもユーザーに影響を与えない
        }
      })();
    };

    void loadTicket();
  }, [code, signature, config.date, token]);

  useEffect(() => {
    if (!isRelationshipModalOpen) {
      return;
    }

    const loadRelationships = async () => {
      setRelationshipLoading(true);
      setRelationshipError(null);

      const { data, error } = await supabase
        .from('relationships')
        .select('id, name')
        .eq('is_accepting', true)
        .order('id', { ascending: true });

      if (error) {
        setRelationshipError('間柄の取得に失敗しました。');
        setRelationshipLoading(false);
        return;
      }

      let options = (data ?? []) as RelationshipOption[];
      // 中学生チケットの場合、選択可能な間柄を特定の3つに制限する
      if (isJuniorTicket) {
        options = [
          { id: 0, name: '中学生' },
          { id: 1, name: '保護者' },
          { id: 2, name: '中学生と保護者' },
        ];
      }
      setRelationships(options);
      setSelectedRelationshipId(
        (previous) => previous ?? ticket.relationshipId,
      );
      setRelationshipLoading(false);
    };

    void loadRelationships();
  }, [isRelationshipModalOpen, ticket.relationshipId, isJuniorTicket]);

  const ticketUrl = `https://${config.site_url}/t/${token}`;
  const canCancelTicket =
    !loading && !cancelLoading && ticketStatus === 'valid';
  const isDayTicket = ticket.ticketTypeId === 8 || ticket.ticketTypeId === 9;
  const qrColor =
    ticket.performanceId > 0 && ticket.scheduleId === 0 ? '#d61322' : undefined;
  const canChangeRelationship =
    (!isDayTicket || isJuniorTicket) &&
    !loading &&
    !cancelLoading &&
    !isChangingRelationship &&
    ticketStatus === 'valid';
  const shortenerApiKey = import.meta.env.VITE_SHORTEN_URL_API_KEY;

  const syncTicketCancelledStateToCache = async () => {
    try {
      const { writeTicketDisplayCache, readTicketDisplayCache } =
        await import('../../features/tickets/ticketDisplayCache.ts');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = readTicketDisplayCache<Record<string, any>>(code);
      if (existing) {
        existing.status = 'cancelled';
        writeTicketDisplayCache(code, existing);
      }
    } catch {
      // ignore cache update failures
    }

    try {
      const { markCachedTicketCardCancelled } =
        await import('./students/offlineCache.ts');
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user?.id) {
        markCachedTicketCardCancelled(user.id, code);
      }
    } catch {
      // ignore absence of offline cache or auth issues
    }
  };

  const applyTicketCancelledState = async () => {
    setTicketStatus('cancelled');
    await syncTicketCancelledStateToCache();
    setErrorMessages((previous) => {
      const kept = previous.filter(
        (message) => message !== 'このチケットはキャンセルされています。',
      );
      return [...kept, 'このチケットはキャンセルされています。'];
    });
  };

  const cancelTicketInBackend = async (): Promise<string | null> => {
    const { error } = await supabase.rpc('cancel_own_ticket_by_code', {
      p_code: code,
    });
    return error ? error.message : null;
  };

  const handleIssueShortUrl = async () => {
    if (!shortenerApiKey) {
      setErrorMessages((previous) => [
        ...previous,
        '短縮URL発行APIキーが設定されていません。',
      ]);
      return;
    }

    setIsIssuingShortUrl(true);
    try {
      const params = new URLSearchParams({
        url: ticketUrl,
        analytics: 'false',
        key: shortenerApiKey,
      });
      const response = await fetch(`https://xgd.io/V1/shorten?${params}`);
      const rawBody = (await response.text()).trim();

      if (!response.ok) {
        throw new Error(rawBody || '短縮URLの発行に失敗しました。');
      }

      let resolvedShortUrl = rawBody;
      if (rawBody.startsWith('{')) {
        try {
          const payload = JSON.parse(rawBody) as {
            shorturl?: string;
            short_url?: string;
            url?: string;
            link?: string;
          };
          resolvedShortUrl =
            payload.shorturl ??
            payload.short_url ??
            payload.url ??
            payload.link ??
            '';
        } catch {
          // ignore json parse failure and keep raw response
        }
      }

      if (!resolvedShortUrl.startsWith('http')) {
        throw new Error('短縮URLの形式が正しくありません。');
      }

      setIssuedShortUrl(resolvedShortUrl);
      setIsShortUrlModalOpen(true);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : '短縮URLの発行に失敗しました。';
      setErrorMessages((previous) => [
        ...previous,
        `短縮URLの発行に失敗しました: ${message}`,
      ]);
    } finally {
      setIsIssuingShortUrl(false);
    }
  };

  const handleCancelTicket = async () => {
    if (!canCancelTicket) {
      return;
    }

    const shouldCancel = window.confirm(
      'このチケットをキャンセルしますか？この操作は取り消せません。',
    );
    if (!shouldCancel) {
      return;
    }

    setCancelLoading(true);
    const cancelErrorMessage = await cancelTicketInBackend();
    if (cancelErrorMessage) {
      setErrorMessages((previous) => [
        ...previous,
        `キャンセルに失敗しました: ${cancelErrorMessage}`,
      ]);
      setCancelLoading(false);
      return;
    }

    await applyTicketCancelledState();
    setCancelLoading(false);
  };

  const handleChangeRelationship = async () => {
    if (!canChangeRelationship || selectedRelationshipId === null) {
      return;
    }

    if (selectedRelationshipId === ticket.relationshipId) {
      setRelationshipError(
        '現在の間柄と同じです。別の間柄を選択してください。',
      );
      return;
    }

    const tokenToVerify = getTurnstileToken();

    if (!tokenToVerify) {
      alert('Turnstile認証を完了してから変更してください。');
      return;
    }

    setRelationshipError(null);
    setIsChangingRelationship(true);
    try {
      const { data, error } = await supabase.functions.invoke('issue-tickets', {
        body: {
          ticketTypeId: ticket.ticketTypeId,
          relationshipId: 1, // 変更前の間柄IDはバックエンドで取得するため、ここではダミー値を送る
          targetRelationshipId: selectedRelationshipId,
          performanceId: ticket.performanceId,
          scheduleId: ticket.scheduleId,
          issueCount: 1,
          turnstileToken: tokenToVerify,
          cancelCode: code,
        },
      });

      if (error) {
        const message = await readFunctionErrorMessage(error);
        setRelationshipError(`再発行に失敗しました: ${message}`);
        resetTurnstile();
        return;
      }

      const issuedTicket = (
        data as {
          issuedTickets?: Array<{ code: string; signature: string }>;
        } | null
      )?.issuedTickets?.[0];

      if (!issuedTicket?.code || !issuedTicket.signature) {
        setRelationshipError('再発行結果を取得できませんでした。');
        resetTurnstile();
        return;
      }

      // Cache the newly issued ticket to ticketDisplayCache
      const selectedRelationship = relationships.find(
        (r) => r.id === selectedRelationshipId,
      );
      void saveTicketToCache(
        issuedTicket.code,
        issuedTicket.signature,
        {
          performanceName: ticket.performanceName,
          performanceTitle: ticket.performanceTitle,
          scheduleName: ticket.scheduleName,
          scheduleDate: ticket.scheduleDate,
          scheduleTime: ticket.scheduleTime,
          scheduleEndTime: ticket.scheduleEndTime,
          ticketTypeLabel: ticket.ticketTypeLabel,
          relationshipName: selectedRelationship?.name ?? '-',
          relationshipId: selectedRelationshipId,
        },
        'valid',
      );

      // Backend guarantees: either (cancel old + issue new) succeeds, or neither is applied.
      // Mirror that state locally only after success.
      await applyTicketCancelledState();
      setIsRelationshipModalOpen(false);
      route(`/t/${issuedTicket.code}.${issuedTicket.signature}`);
    } finally {
      setIsChangingRelationship(false);
      resetTurnstile();
    }
  };

  useEffect(() => {
    const refresh = () => setCacheVersion((previous) => previous + 1);
    const unsubscribe = subscribeTicketDisplayCacheUpdated(() => {
      refresh();
    });
    window.addEventListener('storage', refresh);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', refresh);
    };
  }, []);

  const cachedTickets = useMemo(
    () => listTicketDisplayCache<CachedTicketDisplay>(),
    [cacheVersion],
  );
  const tickets = useDecodedSerialTickets<TicketCardItem>(cachedTickets)
    .filter((t) => t.code !== code)
    .filter((t) => t.status === 'valid');

  const eventLabel = `${config.name}${config.year}`;

  return (
    <div className={styles.printRoot}>
      <div className={styles.printHeader}>
        <img src={iconUrl} alt='校章' />
        <span>{eventLabel}</span>
      </div>
      <h1 className={pageStyles.pageTitle}>入場チケット</h1>
      <Alert type='warning' className={styles.noPrint}>
        <ul>
          <li>
            必ず<strong>スクリーンショット</strong>で保存してください。
          </li>
          <li>
            このQRコードは<strong>校内入場</strong>にも使用可能です。
          </li>
        </ul>
      </Alert>
      <p className={styles.printNotice}>
        このQRコードは校内入場にも使用可能です。
      </p>
      {warningMessages.length > 0 && (
        <Alert type='error' className={styles.noPrint}>
          {warningMessages.length === 1 ? (
            <p>{warningMessages[0]}</p>
          ) : (
            <ul>
              {warningMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {loading && <LoadingSpinner />}
      <div className={styles.ticketContainer}>
        <span className={styles.serialBadge}>#{ticket.serial}</span>
        <h2 className={styles.ticketHeader}>
          <span className={styles.performanceName}>
            {ticket.performanceName}
          </span>
          {ticket.scheduleName && (
            <span className={styles.performanceRound}>
              {ticket.scheduleName}
            </span>
          )}
        </h2>
        {ticket.performanceTitle && (
          <p className={styles.performanceTitle}>
            「{ticket.performanceTitle}」
          </p>
        )}
        {errorMessages.length > 0 && (
          <Alert type='error' className={styles.noPrint}>
            {errorMessages.length === 1 ? (
              <p>{errorMessages[0]}</p>
            ) : (
              <ul>
                {errorMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            )}
          </Alert>
        )}

        {ticketStatus !== 'cancelled' && (
          <div className={styles.qrSection}>
            <QRCode
              value={token}
              size={Math.min(window.innerWidth * 0.8, 350)}
              color={qrColor}
              className={
                ticket.relationshipId !== 4 &&
                ticket.performanceId > 0 &&
                ticket.scheduleId === 0
                  ? styles.gymTicketQr
                  : undefined
              }
            />
            <p className={styles.ticketCode}>
              {code.replace(/.{4}/g, '$&-').replace(/-$/, '')}
            </p>
          </div>
        )}

        {ticketStatus !== 'cancelled' && (
          <p className={styles.printUrlContainer}>
            <a href={`/t/${token}`}>{ticketUrl}</a>
          </p>
        )}

        <div className={styles.detailsWrapper}>
          <div className={styles.ticketDetails}>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>日時</span>
              <span className={styles.detailValue}>
                {ticket.scheduleDate}
                {ticket.scheduleTime && ticket.scheduleEndTime && (
                  <>
                    <br />
                    {ticket.scheduleTime} - {ticket.scheduleEndTime}
                  </>
                )}
              </span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>券種</span>
              <span className={styles.detailValue}>
                {ticket.ticketTypeLabel}
              </span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>発行者</span>
              <span className={styles.detailValue}>
                {ticket.affiliation === '1600'
                  ? '当日券ゲスト'
                  : Number(ticket.affiliation) > 10000
                    ? '中学生 ' + ticket.affiliation
                    : Math.floor(Number(ticket.affiliation) / 10000) +
                      '-' +
                      Math.floor((Number(ticket.affiliation) % 10000) / 100) +
                      ' ' +
                      (Number(ticket.affiliation) % 100)}
              </span>
            </div>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>間柄</span>
              <span className={styles.detailValue}>
                {ticket.relationshipName}
              </span>
            </div>
          </div>
          <div className={styles.ticketPageQrSection}>
            <p className={styles.ticketPageQrCaption}>チケットページはこちら</p>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <QRCode value={ticketUrl} size={120} />
            </div>
          </div>
        </div>

        {ticketStatus !== 'cancelled' && (
          <div className={styles.actionSection}>
            <p className={` ${styles.urlContainer} ${styles.noPrint}`}>
              <a href={`/t/${token}`}>{ticketUrl}</a>
            </p>
            <div className={`${styles.actionButtons} ${styles.noPrint}`}>
              <button
                className={styles.copyButton}
                onClick={async () => {
                  await navigator.clipboard.writeText(ticketUrl);
                  setShowCopySucceed(true);
                  setTimeout(() => {
                    setShowCopySucceed(false);
                  }, 2000);
                }}
              >
                チケットURLをコピー
              </button>
              <button
                className={styles.shortenButton}
                onClick={handleIssueShortUrl}
                disabled={isIssuingShortUrl}
              >
                {isIssuingShortUrl ? '短縮URLを発行中...' : '短縮URLを発行'}
              </button>
            </div>
            <p
              className={`${styles.copySucceed} ${styles.noPrint}`}
              style={{
                opacity: showCopySucceed ? 1 : 0,
                display: showCopySucceed ? 'block' : 'none',
              }}
            >
              コピーしました
            </p>
            <button
              className={`${styles.cancelButton} ${styles.noPrint}`}
              disabled={!canCancelTicket}
              onClick={handleCancelTicket}
            >
              <MdClose />
              {cancelLoading ? 'キャンセル中...' : 'チケットをキャンセル'}
            </button>
            <div className={styles.noPrint}>
              <button
                type='button'
                className={styles.printButton}
                onClick={() => window.print()}
              >
                このチケットを印刷
              </button>
            </div>
          </div>
        )}
      </div>

      {isShortUrlModalOpen && (
        <div
          className={`${styles.shortUrlModalOverlay} ${styles.noPrint}`}
          role='presentation'
          onClick={() => setIsShortUrlModalOpen(false)}
        >
          <div
            className={styles.shortUrlModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='short-url-modal-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id='short-url-modal-title'
              className={styles.shortUrlModalTitle}
            >
              短縮URLを発行しました
            </h2>
            <Alert className={styles.shortUrlWarn}>
              短縮URLは手入力が必要な場面以外で使わないでください。
            </Alert>
            <p className={styles.shortUrlModalDescription}>
              短縮URLはオフライン時に使用不能になります。URLを共有する場合は、短縮URLよりもQRコードのスクリーンショットを共有することをおすすめします。
            </p>
            <p className={styles.shortUrlValue}>{issuedShortUrl}</p>
            <div className={styles.shortUrlModalActions}>
              <button
                type='button'
                className={styles.copyButton}
                onClick={async () => {
                  await navigator.clipboard.writeText(issuedShortUrl);
                  setShowShortUrlCopySucceed(true);
                  setTimeout(() => setShowShortUrlCopySucceed(false), 2000);
                }}
              >
                短縮URLをコピー
              </button>
              <button
                type='button'
                className={styles.modalCloseButton}
                onClick={() => setIsShortUrlModalOpen(false)}
              >
                閉じる
              </button>
            </div>
            <p
              className={styles.copySucceed}
              style={{ opacity: showShortUrlCopySucceed ? 1 : 0 }}
            >
              コピーしました
            </p>
          </div>
        </div>
      )}

      <section className={styles.noPrint}>
        <h3>注意事項</h3>
        <ul className={styles.notes}>
          <li>
            このQRコードをスクリーンショットで保存し、当日読み取り端末にかざしてご入場ください。
          </li>
          <li>
            他の人に共有する場合は、QRコードのスクリーンショットまたはURLを送信してください。
          </li>
          <li>この券で、校内入場や展示部活を見ることも可能です。</li>
          <li>
            このQRコード1枚につき、一人まで入場可能です。ただし、他の座席を使用しない場合は乳児と同伴可能です。
          </li>
          <li>
            このQRコードは<strong>1度のみ</strong>
            使用可能です。再入場はできません。
          </li>
          <li>
            このページで発券されたチケットは、外苑祭当日、入場時に必要となります。忘れずに持参してください。
          </li>
          <li>
            <strong>
              URLやこの画面は、絶対に不特定多数に共有してはいけません。
            </strong>
          </li>
        </ul>
      </section>

      {(!isDayTicket || isJuniorTicket) && (
        <section className={styles.noPrint}>
          <h3>間柄の変更</h3>
          <div className={styles.relationshipChangeSection}>
            <button
              type='button'
              disabled={!canChangeRelationship}
              onClick={() => {
                setRelationshipError(null);
                setSelectedRelationshipId(ticket.relationshipId);
                setIsRelationshipModalOpen(true);
              }}
            >
              間柄を変更する
            </button>
          </div>
        </section>
      )}

      {(!isDayTicket || isJuniorTicket) && isRelationshipModalOpen && (
        <div
          className={`${styles.relationshipModalOverlay} ${styles.noPrint}`}
          role='presentation'
          onClick={() => {
            if (!isChangingRelationship) {
              setIsRelationshipModalOpen(false);
            }
          }}
        >
          <div
            className={styles.relationshipModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='relationship-change-modal-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h2
              id='relationship-change-modal-title'
              className={styles.relationshipModalTitle}
            >
              間柄を変更する
            </h2>
            <p className={styles.relationshipModalMessage}>
              間柄を変更して再発行します（再発行とキャンセルは一括で処理され、どちらか片方だけ成功することはありません）。続行しますか?
            </p>

            <label
              className={styles.relationshipField}
              htmlFor='relationship-select'
            >
              新しい間柄
              <select
                id='relationship-select'
                className={styles.relationshipSelect}
                value={selectedRelationshipId ?? ''}
                onChange={(event) =>
                  setSelectedRelationshipId(Number(event.currentTarget.value))
                }
                disabled={relationshipLoading || isChangingRelationship}
              >
                <option value='' disabled={true}>
                  選択してください
                </option>
                {relationships.map((relationship) => (
                  <option key={relationship.id} value={relationship.id}>
                    {relationship.name}
                  </option>
                ))}
              </select>
            </label>

            {relationshipLoading && (
              <LoadingSpinner message='間柄を読み込み中...' />
            )}
            {relationshipError && (
              <p className={styles.relationshipError}>{relationshipError}</p>
            )}

            <div className={styles.turnstileContainer}>
              <div id={turnstileContainerId} className='cf-turnstile'></div>
              {!hasTurnstileSiteKey ? (
                <p className={styles.turnstileNote}>
                  Turnstile site key が未設定です。
                </p>
              ) : !turnstileToken ? (
                <p className={styles.turnstileNote}>
                  発券前に Turnstile 認証を完了してください。
                </p>
              ) : (
                ''
              )}
            </div>

            <div className={styles.relationshipModalActions}>
              <button
                type='button'
                className={styles.modalCloseButton}
                onClick={() => setIsRelationshipModalOpen(false)}
                disabled={isChangingRelationship}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={styles.changeRelationshipConfirmButton}
                onClick={handleChangeRelationship}
                disabled={relationshipLoading || isChangingRelationship}
              >
                {isChangingRelationship ? '変更中...' : '続行する'}
              </button>
            </div>
          </div>
        </div>
      )}

      <section className={styles.noPrint}>
        <h3>他のチケット</h3>
        <TicketListContent
          embedded={false}
          tickets={tickets}
          showSortControl
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          emptyMessage='この端末で表示したことのあるチケットはまだありません。'
        />
      </section>
    </div>
  );
};

export default Ticket;
