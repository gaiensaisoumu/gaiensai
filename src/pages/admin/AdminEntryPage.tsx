import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import baseStyles from '../../styles/sub-pages.module.css';
import styles from './Register.module.css';
import scanStyles from './Scan.module.css';
import QrScanner from 'qr-scanner';
import {
  decodeAndVerifyTicket,
  decodeTicketCodeWithEnv,
  toTicketDecodedDisplaySeed,
  type TicketDecodedDisplaySeed,
} from '../../features/tickets/ticketCodeDecode';
import Alert from '../../components/ui/Alert';
import {
  preloadScanTicketMaster,
  resolveScanTicketDisplay,
  type ResolvedScanTicketDisplay,
  type ScanTicketMaster,
} from '../../features/tickets/scanTicketMaster';
import {
  FaCircleCheck,
  FaCircleXmark,
  FaKeyboard,
  FaMinus,
  FaPlus,
} from 'react-icons/fa6';
import { TiDelete } from 'react-icons/ti';
import { MdCameraswitch } from 'react-icons/md';
import { ServerUrlModal } from '../../components/admin/ServerUrlModal';
import {
  SCAN_SERVER_URL_STORAGE_KEY,
  isScanServerUnavailableError,
  clampCount,
  deleteScanRecordOnServer,
  fetchEntryCountFromServer,
  fetchTicketSyncSummaryFromServer,
  fetchScanRecordsFromServer,
  logTicketToServer as postTicketLogToServer,
  syncSupabaseTicketsToServer,
  getTicketOnServer,
  updateRecordCountOnServer,
  updateReentryCountOnServer,
  type SupabaseTicketStatusRow,
  type ScanRecord,
} from '../../features/admin/scanSync';
import {
  appendScanRecordToCache,
  clearCachedScanRecords,
  clearPendingSyncOperations,
  clearPendingOperationsForLog,
  dropPendingOperation,
  enqueuePendingCountUpdate,
  enqueuePendingDeleteLog,
  enqueuePendingScanLog,
  estimateEntryCountFromRecords,
  inferOfflineTicketStatus,
  getPendingOperationCount,
  readCachedScanRecords,
  readPendingSyncOperations,
  removeCachedRecord,
  replaceCachedRecordId,
  replaceCachedRecordsWithServerRecords,
  updateCachedRecordCount,
  updatePendingScanLogCount,
} from '../../features/admin/offlineScanCache';
import { YEAR_BITS } from '../../../supabase/functions/_shared/ticketDataType';
import celebrationSound from '../../assets/sounds/celebration.mp3';
import cautionSound from '../../assets/sounds/caution.mp3';
import notificationSound from '../../assets/sounds/notification.mp3';
import proceedVoice1 from '../../assets/sounds/お進みください1.mp3';
import proceedVoice2 from '../../assets/sounds/お進みください2.mp3';
import proceedVoice3 from '../../assets/sounds/お進みください3.mp3';
import reentryVoice1 from '../../assets/sounds/再入場です1.mp3';
import reentryVoice2 from '../../assets/sounds/再入場です2.mp3';
import reentryVoice3 from '../../assets/sounds/再入場です3.mp3';
import invalidVoice1 from '../../assets/sounds/無効なQR1.mp3';
import invalidVoice2 from '../../assets/sounds/無効なQR2.mp3';
import invalidVoice3 from '../../assets/sounds/無効なQR3.mp3';
import { IoMdSettings } from 'react-icons/io';
import Switch from '../../components/ui/Switch';
import { supabase } from '../../lib/supabase';
import { IoWarning } from 'react-icons/io5';
import { useEventConfig } from '../../hooks/useEventConfig';
import { isJuniorTicketTypeId } from '../../features/tickets/juniorRelationship';

const RESULT_CLEAR_DELAY_MS = 4000;
const RESULT_EXIT_DURATION_MS = 1000;
const AUDIO_SETTINGS_STORAGE_KEY = 'admin_register_audio_settings:v1';
const ADMIN_TICKETS_CACHE_STORAGE_KEY = 'admin_ticket_status_cache:v1';
const ADMIN_TICKETS_WARNING_DISMISSED_KEY =
  'admin_ticket_status_cache_warning_dismissed:v1';
const TIMEOUT_RESCAN = 4000;

type VoiceVariant = '1' | '2' | '3' | 'sfxOnly';

type AudioSettings = {
  enabled: boolean;
  voiceVariant: VoiceVariant;
};

type TicketStatusCachePayload = {
  syncedAt: string;
  tickets: SupabaseTicketStatusRow[];
};

const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  enabled: true,
  voiceVariant: '1',
};

type DuplicateInfo = {
  ticketUsedAt: string;
  lastUsedAt: Date | null;
  isRecent: boolean;
};

type DecodeError = {
  title: string;
  message: string;
};

type PendingUnknownTicket = {
  decoded: TicketDecodedDisplaySeed;
  code: string;
};

type EntryMode = 'register' | 'scan';

const AdminEntryPage = ({ mode }: { mode: EntryMode }) => {
  const { config } = useEventConfig();
  const [scannedValue, setScannedValue] = useState<string>();
  const [decodedTicket, setDecodedTicket] =
    useState<TicketDecodedDisplaySeed | null>(null);
  const [resolvedTicket, setResolvedTicket] =
    useState<ResolvedScanTicketDisplay | null>(null);
  const [decodeError, setDecodeError] = useState<DecodeError | undefined>();
  const [ticketMaster, setTicketMaster] = useState<ScanTicketMaster | null>(
    null,
  );

  const [showReentryModal, setShowReentryModal] = useState(false);
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(
    null,
  );
  const [isReentryResult, setIsReentryResult] = useState(false);

  const [shouldRenderResultCard, setShouldRenderResultCard] = useState(false);
  const [isResultCardExiting, setIsResultCardExiting] = useState(false);
  const [autoHideRequested, setAutoHideRequested] = useState(false);

  const [localServerUrl, setLocalServerUrl] = useState<string>();
  const [showServerModal, setShowServerModal] = useState(false);
  const [showMissingSignatureModal, setShowMissingSignatureModal] =
    useState(false);
  const [showDeleteLogModal, setShowDeleteLogModal] = useState(false);
  const [pendingDeleteLogId, setPendingDeleteLogId] = useState<number | null>(
    null,
  );
  const [showUnknownStatusModal, setShowUnknownStatusModal] = useState(false);
  const [pendingUnknownTicket, setPendingUnknownTicket] =
    useState<PendingUnknownTicket | null>(null);

  const [pendingFullCode, setPendingFullCode] = useState<string>('');

  const [entryCount, setEntryCount] = useState<number>(0);
  const [entryCountValue, setEntryCountValue] = useState<number>(1);
  const [currentLogId, setCurrentLogId] = useState<number | null>(null);
  const [currentTicketCode, setCurrentTicketCode] = useState<string>('');
  const [scanRecords, setScanRecords] = useState<ScanRecord[]>([]);
  const [isServerOffline, setIsServerOffline] = useState(false);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(
    DEFAULT_AUDIO_SETTINGS,
  );
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showAudioPermissionModal, setShowAudioPermissionModal] =
    useState(false);
  const [isTicketSyncing, setIsTicketSyncing] = useState(false);
  const [ticketSyncMessage, setTicketSyncMessage] = useState<string | null>(
    null,
  );
  const [ticketSyncWarning, setTicketSyncWarning] = useState<string | null>(
    null,
  );
  const [ticketCacheSyncedAt, setTicketCacheSyncedAt] = useState<string | null>(
    null,
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoWrapperRef = useRef<HTMLDivElement | null>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const isProcessingRef = useRef(false);
  const pendingDecodedRef = useRef<TicketDecodedDisplaySeed | null>(null);
  const isOfflineRef = useRef(false);
  const audioSettingsRef = useRef<AudioSettings>(DEFAULT_AUDIO_SETTINGS);
  const audioQueueRef = useRef<Promise<void>>(Promise.resolve());
  const processScannedValueRef = useRef<
    (nextScannedValue: string) => Promise<unknown>
  >(async () => null);
  const rescanTimeoutRef = useRef<number | null>(null);
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [scanFrameSize, setScanFrameSize] = useState(0);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>(
    'environment',
  );
  const [cameraRestartNonce, setCameraRestartNonce] = useState(0);

  const [isManualInputOverride, setIsManualInputOverride] = useState(false);
  const effectiveMode = isManualInputOverride ? 'register' : mode;

  const hasResultContent =
    Boolean(decodedTicket || decodeError) && !autoHideRequested;

  const formatIssuerDisplay = (ticket: TicketDecodedDisplaySeed): string => {
    if (ticket.affiliation === '1600') {
      return '当日券ゲスト';
    }

    const affiliationNumber = Number(ticket.affiliation);
    if (isJuniorTicketTypeId(ticket.ticketTypeId) && affiliationNumber > 100000) {
      return `中学生 ${ticket.affiliation}`;
    }

    return (
      Math.floor(affiliationNumber / 10000) +
      '-' +
      Math.floor((affiliationNumber % 10000) / 100) +
      ' ' +
      (affiliationNumber % 100) +
      '番'
    );
  };

  const getDefaultEntryCount = (ticket: TicketDecodedDisplaySeed): number => {
    if (
      isJuniorTicketTypeId(ticket.ticketTypeId) &&
      ticket.relationshipId === 2
    ) {
      return 2;
    }
    return 1;
  };

  const readTicketStatusCache =
    useCallback((): TicketStatusCachePayload | null => {
      try {
        const raw = localStorage.getItem(ADMIN_TICKETS_CACHE_STORAGE_KEY);
        if (!raw) {
          return null;
        }
        const parsed = JSON.parse(raw) as {
          syncedAt?: unknown;
          tickets?: unknown;
        };
        if (
          typeof parsed.syncedAt !== 'string' ||
          !Array.isArray(parsed.tickets)
        ) {
          return null;
        }
        const tickets = parsed.tickets
          .map((item) => {
            if (!item || typeof item !== 'object') {
              return null;
            }
            const code = 'code' in item ? item.code : null;
            const status = 'status' in item ? item.status : null;
            if (typeof code !== 'string' || typeof status !== 'string') {
              return null;
            }
            return { code, status };
          })
          .filter((item): item is SupabaseTicketStatusRow => item !== null);

        return {
          syncedAt: parsed.syncedAt,
          tickets,
        };
      } catch {
        return null;
      }
    }, []);

  const focus = useCallback(() => {
    if (effectiveMode !== 'register') {
      return;
    }
    if (showServerModal) {
      inputRef.current?.blur();
    } else {
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 10);
    }
  }, [effectiveMode, showServerModal]);

  const dismissTicketSyncWarning = useCallback(() => {
    localStorage.setItem(ADMIN_TICKETS_WARNING_DISMISSED_KEY, '1');
    setTicketSyncWarning(null);
    setTimeout(() => focus(), 10);
  }, [focus]);

  const getProceedVoice = useCallback((variant: VoiceVariant) => {
    if (variant === 'sfxOnly') {
      return null;
    }
    if (variant === '2') {
      return proceedVoice2;
    }
    if (variant === '3') {
      return proceedVoice3;
    }
    return proceedVoice1;
  }, []);

  const getReentryVoice = useCallback((variant: VoiceVariant) => {
    if (variant === 'sfxOnly') {
      return null;
    }
    if (variant === '2') {
      return reentryVoice2;
    }
    if (variant === '3') {
      return reentryVoice3;
    }
    return reentryVoice1;
  }, []);

  const getInvalidQrVoice = useCallback((variant: VoiceVariant) => {
    if (variant === 'sfxOnly') {
      return null;
    }
    if (variant === '2') {
      return invalidVoice2;
    }
    if (variant === '3') {
      return invalidVoice3;
    }
    return invalidVoice1;
  }, []);

  const playAudio = useCallback(async (src: string) => {
    const audio = new Audio(src);
    await new Promise<void>((resolve) => {
      const cleanup = () => {
        audio.removeEventListener('ended', handleEnd);
        audio.removeEventListener('error', handleError);
      };
      const handleEnd = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        resolve();
      };
      audio.addEventListener('ended', handleEnd);
      audio.addEventListener('error', handleError);
      void audio.play().catch(() => {
        cleanup();
        resolve();
      });
    });
  }, []);

  const queueAudio = useCallback(
    (sources: string[]) => {
      if (!audioSettingsRef.current.enabled || sources.length === 0) {
        return;
      }

      audioQueueRef.current = audioQueueRef.current
        .catch(() => {
          // noop
        })
        .then(async () => {
          for (const src of sources) {
            await playAudio(src);
          }
        });
    },
    [playAudio],
  );

  const setDecodeErrorWithSound = useCallback(
    (nextError: DecodeError) => {
      setDecodeError(nextError);
      queueAudio(
        [
          cautionSound,
          getInvalidQrVoice(audioSettingsRef.current.voiceVariant),
        ].filter((src): src is string => Boolean(src)),
      );
    },
    [getInvalidQrVoice, queueAudio],
  );

  const refreshFromLocalCache = useCallback(() => {
    const allCachedRecords = readCachedScanRecords();
    setScanRecords(allCachedRecords.slice(0, 5));
    setEntryCount(estimateEntryCountFromRecords(allCachedRecords));
    setPendingSyncCount(getPendingOperationCount());
  }, []);

  const markServerOffline = useCallback(() => {
    isOfflineRef.current = true;
    setIsServerOffline(true);
    refreshFromLocalCache();
  }, [refreshFromLocalCache]);

  const markServerOnline = useCallback(() => {
    isOfflineRef.current = false;
    setIsServerOffline(false);
  }, []);

  useEffect(() => {
    if (effectiveMode !== 'register') {
      return () => {
        // noop
      };
    }

    focus();
    const handleClick = (event: MouseEvent) => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.closest('button') ||
          event.target.closest('a') ||
          event.target.closest('input') ||
          event.target.closest('select'))
      ) {
        setTimeout(() => focus(), 10);
        return;
      }
      focus();
    };

    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, [focus, effectiveMode]);

  // ローカルストレージから URL を読み込み、初回設定をチェック
  useEffect(() => {
    const savedUrl = localStorage.getItem(SCAN_SERVER_URL_STORAGE_KEY);
    if (savedUrl !== null) {
      setLocalServerUrl(savedUrl);
      if (savedUrl.trim() === '') {
        markServerOffline();
      }
    } else {
      // URL が未設定の場合、モーダルを表示
      setShowServerModal(true);
    }
    refreshFromLocalCache();
  }, [markServerOffline, refreshFromLocalCache]);

  useEffect(() => {
    const dismissed =
      localStorage.getItem(ADMIN_TICKETS_WARNING_DISMISSED_KEY) === '1';
    const cached = readTicketStatusCache();
    if (!cached || cached.tickets.length === 0) {
      setTicketCacheSyncedAt(null);
      if (!dismissed) {
        setTicketSyncWarning(
          'チケット状態キャッシュがありません。同期しない場合は、チケットがキャンセル済みかどうかを判定できません。',
        );
      }
      return;
    }

    setTicketCacheSyncedAt(cached.syncedAt);
  }, [readTicketStatusCache]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUDIO_SETTINGS_STORAGE_KEY);
      if (!raw) {
        setShowAudioPermissionModal(true);
        return;
      }
      const parsed = JSON.parse(raw) as
        | Partial<AudioSettings>
        | {
            proceedVariant?: VoiceVariant;
            reentryVariant?: VoiceVariant;
            invalidQrVariant?: VoiceVariant;
          };

      const parsedEnabled =
        'enabled' in parsed && typeof parsed.enabled === 'boolean'
          ? parsed.enabled
          : undefined;

      setShowAudioPermissionModal(parsedEnabled ?? false);
      const legacyVariant =
        'proceedVariant' in parsed &&
        (parsed.proceedVariant === '1' ||
          parsed.proceedVariant === '2' ||
          parsed.proceedVariant === '3' ||
          parsed.proceedVariant === 'sfxOnly')
          ? parsed.proceedVariant
          : undefined;
      setAudioSettings((current) => ({
        ...current,
        ...parsed,
        voiceVariant:
          ('voiceVariant' in parsed &&
          (parsed.voiceVariant === '1' ||
            parsed.voiceVariant === '2' ||
            parsed.voiceVariant === '3' ||
            parsed.voiceVariant === 'sfxOnly')
            ? parsed.voiceVariant
            : undefined) ??
          legacyVariant ??
          current.voiceVariant,
      }));
    } catch {
      // noop
    }
  }, []);

  useEffect(() => {
    audioSettingsRef.current = audioSettings;
    localStorage.setItem(
      AUDIO_SETTINGS_STORAGE_KEY,
      JSON.stringify(audioSettings),
    );
  }, [audioSettings]);

  const syncPendingOperations = useCallback(async () => {
    if (!localServerUrl) {
      return;
    }

    const operations = readPendingSyncOperations();
    if (operations.length === 0) {
      setPendingSyncCount(0);
      return;
    }

    for (const operation of operations) {
      try {
        if (operation.type === 'scanLog') {
          if (
            operation.result === 'success' ||
            operation.result === 'reentry'
          ) {
            await getTicketOnServer(
              localServerUrl,
              operation.ticketId,
              operation.count,
            );
          }

          const serverLogId = await postTicketLogToServer(
            localServerUrl,
            operation.ticketCode,
            operation.result,
            operation.count,
          );

          if (operation.result === 'reentry') {
            await updateReentryCountOnServer(
              localServerUrl,
              operation.ticketId,
              operation.count,
            );
          }

          if (serverLogId !== null && operation.localRecordId < 0) {
            replaceCachedRecordId(operation.localRecordId, serverLogId);
          }
        } else if (operation.type === 'countUpdate') {
          await updateRecordCountOnServer(
            localServerUrl,
            operation.logId,
            operation.code,
            operation.count,
          );
        } else if (operation.type === 'deleteLog') {
          await deleteScanRecordOnServer(localServerUrl, operation.logId);
        }

        dropPendingOperation(operation.opId);
      } catch (error) {
        if (isScanServerUnavailableError(error)) {
          markServerOffline();
          break;
        }
        break;
      }
    }

    setPendingSyncCount(getPendingOperationCount());
  }, [localServerUrl, markServerOffline]);

  const refreshFromServer = useCallback(async () => {
    if (!localServerUrl) {
      return;
    }

    try {
      await syncPendingOperations();
      const [records, count, ticketSyncSummary] = await Promise.all([
        fetchScanRecordsFromServer(localServerUrl, { all: true }),
        fetchEntryCountFromServer(localServerUrl),
        fetchTicketSyncSummaryFromServer(localServerUrl),
      ]);
      const merged = replaceCachedRecordsWithServerRecords(records);
      setScanRecords(merged.slice(0, 5));
      setEntryCount(count);
      setPendingSyncCount(getPendingOperationCount());
      markServerOnline();
      if (ticketSyncSummary.total > 0) {
        setTicketCacheSyncedAt(ticketSyncSummary.lastSyncedAt);
      } else if (
        localStorage.getItem(ADMIN_TICKETS_WARNING_DISMISSED_KEY) !== '1'
      ) {
        setTicketSyncWarning(
          'SQLiteにチケット状態キャッシュがありません。設定からSupabase同期を実行してください。',
        );
      }
    } catch (error) {
      if (isScanServerUnavailableError(error)) {
        markServerOffline();
        return;
      }
      refreshFromLocalCache();
    }
  }, [
    localServerUrl,
    markServerOffline,
    markServerOnline,
    refreshFromLocalCache,
    syncPendingOperations,
  ]);

  useEffect(() => {
    if (!localServerUrl) {
      return () => {
        // noop
      };
    }

    void refreshFromServer();
    const intervalId = window.setInterval(() => {
      void refreshFromServer();
    }, 5000);

    const handleOnline = () => {
      void refreshFromServer();
    };
    window.addEventListener('online', handleOnline);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('online', handleOnline);
    };
  }, [localServerUrl, refreshFromServer]);

  useEffect(() => {
    let timeoutId: number | null = null;

    if (hasResultContent) {
      setShouldRenderResultCard(true);
      setIsResultCardExiting(false);
      return () => {
        // noop
      };
    }

    if (!shouldRenderResultCard) {
      return () => {
        // noop
      };
    }

    setIsResultCardExiting(true);
    timeoutId = window.setTimeout(() => {
      setShouldRenderResultCard(false);
      setIsResultCardExiting(false);
    }, 1000);

    return () => {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [hasResultContent, shouldRenderResultCard]);

  useEffect(() => {
    if (!hasResultContent) {
      return () => {
        // noop
      };
    }

    // Modalが表示されている場合はタイマーを開始しない
    if (
      showReentryModal ||
      showMissingSignatureModal ||
      showServerModal ||
      showUnknownStatusModal ||
      Boolean(ticketSyncWarning)
    ) {
      return () => {
        // noop
      };
    }

    const timeoutId = window.setTimeout(
      () => setAutoHideRequested(true),
      RESULT_CLEAR_DELAY_MS,
    );

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    hasResultContent,
    showReentryModal,
    showMissingSignatureModal,
    showServerModal,
    showUnknownStatusModal,
    ticketSyncWarning,
  ]);

  useEffect(() => {
    if (!autoHideRequested) {
      return () => {
        // noop
      };
    }

    const timeoutId = window.setTimeout(() => {
      setDecodedTicket(null);
      setResolvedTicket(null);
      setDecodeError(undefined);
      setScannedValue('');
      setEntryCountValue(1);
      setCurrentLogId(null);
      setCurrentTicketCode('');
      setAutoHideRequested(false);
    }, RESULT_EXIT_DURATION_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [autoHideRequested]);

  const handleResolvedTicket = async (
    decoded: TicketDecodedDisplaySeed,
    options?: { reentry?: boolean },
  ) => {
    setIsReentryResult(Boolean(options?.reentry));
    setDecodeError(undefined);
    setDecodedTicket(decoded);
    let master = ticketMaster;
    if (!master) {
      try {
        master = await preloadScanTicketMaster();
        setTicketMaster(master);
      } catch {
        master = null;
      }
    }

    if (master) {
      setResolvedTicket(resolveScanTicketDisplay(decoded, master));
    }
  };

  const checkIsTicketThisYear = (ticketYear: number) : boolean => {
    const currentYear = config.year;
    if (typeof currentYear !== 'number') {
      throw new Error('Invalid event configuration: year is not a number');
    }
    if (typeof ticketYear !== 'number') {
      return false;
    }
    return ticketYear === currentYear % 2 ** Number(YEAR_BITS);
  };

  const processScannedValue = async (nextScannedValue: string) => {
    setAutoHideRequested(false);
    if (!nextScannedValue) {
      return null;
    }
    setScannedValue(nextScannedValue);
    setCurrentLogId(null);
    setCurrentTicketCode('');
    setEntryCountValue(1);

    try {
      const [code, signature] = nextScannedValue.split('.');
      if (!code) {
        await saveScanResult(nextScannedValue, 'failed', 1);
        setDecodeErrorWithSound({
          title: '読み取りエラー',
          message: 'データがありません',
        });
        return;
      }

      if (!signature) {
        setPendingFullCode(nextScannedValue);
        queueAudio([notificationSound]);
        setShowMissingSignatureModal(true);
        return;
      }

      const { decoded, signatureIsValid } =
        await decodeAndVerifyTicket(code, signature);

      if (!decoded) {
        await saveScanResult(nextScannedValue, 'failed', 1);
        setDecodeErrorWithSound({
          title: 'デコードエラー',
          message:
            'デコードに失敗しました。チケットコードが正しいか確認してください。',
        });
        return;
      }

      if (!checkIsTicketThisYear(Number(decoded.year))) {
        await saveScanResult(nextScannedValue, 'wrongYear', 1);
        setDecodeErrorWithSound({
          title: '年度エラー',
          message:
            '今年度のものではないチケットが読まれました。別のチケットをスキャンしてください。',
        });
        return;
      }

      if (!signatureIsValid) {
        await saveScanResult(nextScannedValue, 'unverified', 1);
        setDecodeErrorWithSound({
          title: '署名エラー',
          message:
            'チケットコードの署名が無効です。正規のコードをスキャンしてください。',
        });
        return;
      }

      const defaultEntryCount = getDefaultEntryCount(decoded);
      const { ticketStatus, ticketUsedAt, lastUsedAt, masterStatus } =
        await fetchTicketStatus(code, { count: defaultEntryCount });

      await processTicketStatus(
        decoded,
        ticketStatus,
        ticketUsedAt,
        lastUsedAt,
        masterStatus,
        nextScannedValue,
      );
    } catch (e) {
      await saveScanResult(nextScannedValue, 'failed', 1);
      setDecodeErrorWithSound({
        title: '検証エラー',
        message: 'チケットコードの検証時に何らかのエラーが発生しました。' + e,
      });
    }
  };

  const handleRegister = async (event: Event) => {
    event.preventDefault();
    if (!scannedValue) {
      return;
    }
    await processScannedValue(scannedValue);
  };

  useEffect(() => {
    processScannedValueRef.current = processScannedValue;
  });

  const processTicketStatus = async (
    decoded: TicketDecodedDisplaySeed,
    ticketStatus: string | null,
    ticketUsedAt: string | null,
    lastUsedAt: Date | null,
    masterStatus: string | null,
    code: string,
  ) => {
    const defaultEntryCount = getDefaultEntryCount(decoded);

    if (ticketStatus === 'success') {
      pendingDecodedRef.current = null;
      setDuplicateInfo(null);
      await handleResolvedTicket(decoded);
      setEntryCountValue(defaultEntryCount);
      setCurrentTicketCode(code.split('.')[0]);
      const logId = await saveScanResult(code, 'success', defaultEntryCount);
      setCurrentLogId(logId);
      queueAudio(
        [
          celebrationSound,
          getProceedVoice(audioSettingsRef.current.voiceVariant),
        ].filter((src): src is string => Boolean(src)),
      );
      return;
    }

    if (ticketStatus === 'duplicate') {
      const now = new Date();
      const startOfToday = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
      );
      const wasBeforeToday = Boolean(lastUsedAt && lastUsedAt < startOfToday);

      if (wasBeforeToday) {
        pendingDecodedRef.current = null;
        setDuplicateInfo(null);
        setEntryCountValue(defaultEntryCount);
        setCurrentTicketCode(code.split('.')[0]);
        const logId = await saveScanResult(code, 'reentry', defaultEntryCount);
        setCurrentLogId(logId);
        await handleResolvedTicket(decoded, { reentry: true });
        queueAudio(
          [
            celebrationSound,
            getReentryVoice(audioSettingsRef.current.voiceVariant),
          ].filter((src): src is string => Boolean(src)),
        );
        return;
      }

      pendingDecodedRef.current = decoded;
      const isRecent =
        lastUsedAt !== null &&
        now.getTime() - lastUsedAt.getTime() <= 5 * 60 * 1000;

      setDuplicateInfo({
        ticketUsedAt: ticketUsedAt ?? '不明',
        lastUsedAt,
        isRecent,
      });
      queueAudio([notificationSound]);
      setShowReentryModal(true);
      return;
    }

    if (ticketStatus === 'invalid') {
      await saveScanResult(code, 'failed', 1);
      if (masterStatus === 'cancelled') {
        setDecodeErrorWithSound({
          title: 'キャンセル済みチケット',
          message: `このチケットはすでにキャンセルされています。`,
        });
        return;
      }
      setDecodeErrorWithSound({
        title: '無効チケット',
        message: `このチケットは利用できません。(status: ${masterStatus ?? 'unknown'})`,
      });
      return;
    }

    if (ticketStatus === 'unknown') {
      setPendingUnknownTicket({ decoded, code });
      queueAudio([notificationSound]);
      setShowUnknownStatusModal(true);
      return;
    }

    setDecodeErrorWithSound({
      title: '検証エラー',
      message: '使用済みかどうかを確認する際にエラーが発生しました。',
    });
    await saveScanResult(code, 'failed', 1);
  };

  const handleReentryConfirm = async () => {
    setShowReentryModal(false);
    setDuplicateInfo(null);
    setTimeout(() => focus(), 10);
    const decoded = pendingDecodedRef.current;
    pendingDecodedRef.current = null;
    if (!decoded) {
      return;
    }
    const defaultEntryCount = getDefaultEntryCount(decoded);
    const code = scannedValue?.split('.')[0];
    if (code) {
      setEntryCountValue(defaultEntryCount);
      setCurrentTicketCode(code);
      const logId = await saveScanResult(
        scannedValue,
        'reentry',
        defaultEntryCount,
      );
      setCurrentLogId(logId);
    }
    await handleResolvedTicket(decoded, { reentry: true });
    queueAudio(
      [
        celebrationSound,
        getReentryVoice(audioSettingsRef.current.voiceVariant),
      ].filter((src): src is string => Boolean(src)),
    );
  };

  const handleReentryCancel = async () => {
    setShowReentryModal(false);
    pendingDecodedRef.current = null;
    setDuplicateInfo(null);
    setTimeout(() => focus(), 10);
    setDecodeError({
      title: '再入場キャンセル',
      message: '再入場は正常にキャンセルされました。',
    });
    if (scannedValue) {
      await saveScanResult(scannedValue, 'duplicate', 1);
    }
  };

  const handleMissingSignatureContinue = async () => {
    setShowMissingSignatureModal(false);
    setTimeout(() => focus(), 10);
    if (!pendingFullCode) {
      return;
    }

    setAutoHideRequested(false);

    try {
      const pendingSignatureCode = pendingFullCode
        .split('.')[0]
        .replace('-', '');
      const decodedRaw = await decodeTicketCodeWithEnv(pendingSignatureCode);
      const decoded = toTicketDecodedDisplaySeed(decodedRaw);

      if (!decoded) {
        await saveScanResult(pendingFullCode, 'failed', 1);
        setDecodeErrorWithSound({
          title: 'デコードエラー',
          message:
            'デコードに失敗しました。チケットコードが正しいか確認してください。',
        });
        return;
      }

      if (!checkIsTicketThisYear(Number(decoded.year))) {
        await saveScanResult(pendingFullCode, 'wrongYear', 1);
        setDecodeErrorWithSound({
          title: '年度エラー',
          message:
            '今年度のもでないチケットが読まれました。別のチケットをスキャンしてください。',
        });
        return;
      }

      const defaultEntryCount = getDefaultEntryCount(decoded);
      const { ticketStatus, ticketUsedAt, lastUsedAt, masterStatus } =
        await fetchTicketStatus(pendingSignatureCode, { count: defaultEntryCount });

      await processTicketStatus(
        decoded,
        ticketStatus,
        ticketUsedAt,
        lastUsedAt,
        masterStatus,
        pendingSignatureCode,
      );
    } catch {
      await saveScanResult(pendingFullCode, 'failed', 1);
      setDecodeErrorWithSound({
        title: '検証エラー',
        message: 'チケットコードの検証時に何らかのエラーが発生しました。',
      });
    } finally {
      setPendingFullCode('');
    }
  };

  const handleMissingSignatureCancel = () => {
    setShowMissingSignatureModal(false);
    setTimeout(() => focus(), 10);
    setPendingFullCode('');
    setDecodeErrorWithSound({
      title: '署名エラー',
      message:
        'チケットコードの署名が無効です。正規のコードをスキャンしてください。',
    });
  };

  const handleSaveServerUrl = (url: string) => {
    const trimmedUrl = url.trim();
    if (trimmedUrl) {
      localStorage.setItem(SCAN_SERVER_URL_STORAGE_KEY, trimmedUrl);
      setLocalServerUrl(trimmedUrl);
      setShowServerModal(false);
      markServerOnline();
    }
  };

  const handleContinueWithoutServer = () => {
    localStorage.setItem(SCAN_SERVER_URL_STORAGE_KEY, '');
    setLocalServerUrl('');
    setShowServerModal(false);
    markServerOffline();
  };

  const handleOpenServerModal = () => {
    setShowSettingsModal(false);
    setShowServerModal(true);
  };

  const handleOpenAudioSettingsModal = () => {
    setShowSettingsModal(true);
  };

  const handleCloseAudioSettingsModal = () => {
    setShowSettingsModal(false);
  };

  const handleSyncTicketsFromSupabase = useCallback(async () => {
    setIsTicketSyncing(true);
    setTicketSyncMessage(null);

    try {
      const { data, error } = await supabase
        .from('tickets')
        .select('code, status');

      if (error) {
        throw error;
      }

      const tickets = (data ?? [])
        .map((item) => ({
          code: String(item.code ?? ''),
          status: String(item.status ?? ''),
        }))
        .filter((row) => row.code && row.status);

      const syncedAt = new Date().toISOString();
      localStorage.setItem(
        ADMIN_TICKETS_CACHE_STORAGE_KEY,
        JSON.stringify({
          syncedAt,
          tickets,
        } satisfies TicketStatusCachePayload),
      );

      setTicketCacheSyncedAt(syncedAt);
      localStorage.removeItem(ADMIN_TICKETS_WARNING_DISMISSED_KEY);
      setTicketSyncWarning(null);

      if (localServerUrl && localServerUrl.trim()) {
        const result = await syncSupabaseTicketsToServer(
          localServerUrl,
          tickets,
        );
        setTicketSyncMessage(
          `同期完了: ${result.imported}件をSQLiteへ保存しました。`,
        );
      } else {
        setTicketSyncMessage(
          'ローカルキャッシュに保存しました。同期サーバーURL設定後に再実行するとSQLiteにも反映されます。',
        );
      }
    } catch {
      setTicketSyncMessage(
        'Supabaseからの同期に失敗しました。ネットワークと認証設定を確認してください。',
      );
    } finally {
      setIsTicketSyncing(false);
    }
  }, [localServerUrl]);

  const handleAudioPermissionEnable = async () => {
    setAudioSettings((current) => ({ ...current, enabled: true }));
    setShowAudioPermissionModal(false);
    setTimeout(() => focus(), 10);
  };

  const handleAudioPermissionDisable = () => {
    setAudioSettings((current) => ({ ...current, enabled: false }));
    setShowAudioPermissionModal(false);
    setTimeout(() => focus(), 10);
  };

  async function fetchTicketStatus(
    ticketId: string,
    options?: { allowUnknown?: boolean; count?: number },
  ) {
    if (localServerUrl === undefined) {
      setDecodeErrorWithSound({
        title: '設定エラー',
        message: 'ローカルサーバーのURLを入力してください。',
      });
      return {
        ticketStatus: null,
        ticketUsedAt: null,
        lastUsedAt: null,
        masterStatus: null,
      };
    }
    if (localServerUrl.trim() === '') {
      return {
        ...(inferOfflineTicketStatus(ticketId) as {
          ticketStatus: string | null;
          ticketUsedAt: string | null;
          lastUsedAt: Date | null;
        }),
        masterStatus: null,
      };
    }
    try {
      const result = await getTicketOnServer(
        localServerUrl,
        ticketId,
        options?.count ?? 1,
        {
        allowUnknown: options?.allowUnknown === true,
      });
      markServerOnline();
      return result;
    } catch (error) {
      if (!isScanServerUnavailableError(error)) {
        throw error;
      }
      markServerOffline();
      return {
        ...(inferOfflineTicketStatus(ticketId) as {
          ticketStatus: string | null;
          ticketUsedAt: string | null;
          lastUsedAt: Date | null;
        }),
        masterStatus: null,
      };
    }
  }

  async function saveScanResult(code: string, result: string, count: number) {
    const scannedAt = new Date().toISOString();
    const normalizedCode = code.replace(/-/g, '');
    const ticketId = normalizedCode.split('.')[0];
    let logId: number | null = null;
    let shouldQueue = true;

    if (localServerUrl && !isOfflineRef.current) {
      try {
        logId = await postTicketLogToServer(
          localServerUrl,
          code,
          result,
          count,
        );
        if (result === 'reentry') {
          await updateReentryCountOnServer(localServerUrl, ticketId, count);
        }
        shouldQueue = false;
        markServerOnline();
      } catch (error) {
        if (isScanServerUnavailableError(error)) {
          markServerOffline();
        }
      }
    }

    const saved = appendScanRecordToCache({
      id: logId ?? undefined,
      ticket_code: normalizedCode,
      scanned_at: scannedAt,
      result,
      count,
    });

    if (shouldQueue) {
      enqueuePendingScanLog({
        localRecordId: saved.id,
        ticketCode: normalizedCode,
        result,
        count,
        scannedAt,
      });
    }

    refreshFromLocalCache();
    return saved.id;
  }

  const reloadFromServerAfterLocalReset = useCallback(async () => {
    if (!localServerUrl || isOfflineRef.current) {
      return;
    }

    await syncPendingOperations();
    if (getPendingOperationCount() > 0) {
      return;
    }

    clearCachedScanRecords();
    clearPendingSyncOperations();

    try {
      const [records, count] = await Promise.all([
        fetchScanRecordsFromServer(localServerUrl, { all: true }),
        fetchEntryCountFromServer(localServerUrl),
      ]);
      const merged = replaceCachedRecordsWithServerRecords(records);
      setScanRecords(merged.slice(0, 5));
      setEntryCount(count);
      setPendingSyncCount(getPendingOperationCount());
      markServerOnline();
    } catch (error) {
      if (isScanServerUnavailableError(error)) {
        markServerOffline();
        return;
      }
      refreshFromLocalCache();
    }
  }, [
    localServerUrl,
    markServerOffline,
    markServerOnline,
    refreshFromLocalCache,
    syncPendingOperations,
  ]);

  async function updateCountOnServer(
    logId: number | null,
    code: string,
    count: number,
  ) {
    if (logId === null) {
      return;
    }
    updateCachedRecordCount(logId, count);
    if (logId < 0) {
      updatePendingScanLogCount(logId, count);
      refreshFromLocalCache();
      return;
    }

    if (!localServerUrl || isOfflineRef.current) {
      enqueuePendingCountUpdate(logId, code, count);
      refreshFromLocalCache();
      return;
    }

    try {
      await updateRecordCountOnServer(localServerUrl, logId, code, count);
      markServerOnline();
      await reloadFromServerAfterLocalReset();
      return;
    } catch (error) {
      enqueuePendingCountUpdate(logId, code, count);
      if (isScanServerUnavailableError(error)) {
        markServerOffline();
      }
    }
    refreshFromLocalCache();
  }

  const handleEntryCountChange = async (delta: number) => {
    const next = clampCount(entryCountValue + delta);
    setEntryCountValue(next);
    if (!currentTicketCode) {
      return;
    }

    let targetLogId = currentLogId;
    if (targetLogId === null) {
      const matched = scanRecords.find(
        (record) => record.ticket_code.split('.')[0] === currentTicketCode,
      );
      if (matched) {
        targetLogId = matched.id;
        setCurrentLogId(matched.id);
      }
    }

    if (targetLogId !== null) {
      await updateCountOnServer(targetLogId, currentTicketCode, next);
      setScanRecords((prev) =>
        prev.map((record) =>
          record.id === targetLogId ? { ...record, count: next } : record,
        ),
      );
      refreshFromLocalCache();
    }
  };

  const handleRecordCountChange = async (
    logId: number,
    code: string,
    delta: number,
  ) => {
    let next = 1;
    setScanRecords((prev) =>
      prev.map((record) => {
        if (record.id !== logId) {
          return record;
        }
        next = clampCount((record.count ?? 1) + delta);
        return { ...record, count: next };
      }),
    );
    await updateCountOnServer(logId, code, next);
    refreshFromLocalCache();
  };

  const handleDeleteLog = async (logId: number) => {
    if (!logId) {
      return;
    }
    removeCachedRecord(logId);
    clearPendingOperationsForLog(logId);

    if (logId < 0) {
      refreshFromLocalCache();
      return;
    }

    if (!localServerUrl || isOfflineRef.current) {
      enqueuePendingDeleteLog(logId);
      refreshFromLocalCache();
      return;
    }

    try {
      await deleteScanRecordOnServer(localServerUrl, logId);
      markServerOnline();
      await reloadFromServerAfterLocalReset();
      return;
    } catch (error) {
      enqueuePendingDeleteLog(logId);
      if (isScanServerUnavailableError(error)) {
        markServerOffline();
      }
    }
    refreshFromLocalCache();
  };

  const requestDeleteLog = (logId: number) => {
    setPendingDeleteLogId(logId);
    setShowDeleteLogModal(true);
  };

  const handleDeleteLogConfirm = async () => {
    if (pendingDeleteLogId === null) {
      return;
    }
    await handleDeleteLog(pendingDeleteLogId);
    setPendingDeleteLogId(null);
    setShowDeleteLogModal(false);
    setTimeout(() => focus(), 10);
  };

  const handleDeleteLogCancel = () => {
    setPendingDeleteLogId(null);
    setShowDeleteLogModal(false);
    setTimeout(() => focus(), 10);
  };

  const handleUnknownStatusContinue = async () => {
    const pending = pendingUnknownTicket;
    setShowUnknownStatusModal(false);
    setPendingUnknownTicket(null);
    setTimeout(() => focus(), 10);
    if (!pending) {
      return;
    }

    const retried = await fetchTicketStatus(pending.code, {
      allowUnknown: true,
      count: getDefaultEntryCount(pending.decoded),
    });
    if (retried.ticketStatus === 'unknown') {
      await saveScanResult(pending.code, 'failed', 1);
      setDecodeErrorWithSound({
        title: '検証エラー',
        message:
          'チケット状態を確認できませんでした。Supabase同期を更新して再度お試しください。',
      });
      return;
    }
    await processTicketStatus(
      pending.decoded,
      retried.ticketStatus,
      retried.ticketUsedAt,
      retried.lastUsedAt,
      retried.masterStatus,
      pending.code,
    );
  };

  const handleUnknownStatusCancel = async () => {
    const pending = pendingUnknownTicket;
    setShowUnknownStatusModal(false);
    setPendingUnknownTicket(null);
    setTimeout(() => focus(), 10);
    if (!pending) {
      return;
    }
    await saveScanResult(pending.code, 'failed', 1);
    setDecodeErrorWithSound({
      title: '使用キャンセル',
      message: 'チケット状態が不明だったため、登録を中止しました。',
    });
  };

  const calculateScanSize = useCallback(
    (width: number, height: number): number => Math.min(width, height) * 0.88,
    [],
  );

  const handleToggleCameraFacing = useCallback(async () => {
    if (effectiveMode !== 'scan') {
      return;
    }
    const scanner = scannerRef.current;
    if (!scanner) {
      return;
    }

    const cameras = await QrScanner.listCameras(true);
    if (cameras.length < 2) {
      return;
    }

    // スキャナーを破棄する
    await scanner.destroy();
    scannerRef.current = null;

    // カメラモードを切り替える
    const newFacingMode = facingMode === 'environment' ? 'user' : 'environment';
    setTimeout(() => {
      // 確実に起動できるよう時間をおく
      setFacingMode(newFacingMode);
    }, 1500);
  }, [facingMode, effectiveMode]);

  const handleReScan = useCallback(async () => {
    if (effectiveMode !== 'scan') {
      return;
    }
    const scanner = scannerRef.current;
    if (!scanner) {
      return;
    }
    try {
      await scanner.start();
      setIsCameraReady(true);
      setCameraError(null);
    } catch {
      setIsCameraReady(false);
      setCameraError(
        'カメラを起動できませんでした。権限設定をご確認ください。',
      );
    }
  }, [effectiveMode]);

  const handleDecode = useCallback(
    async (result: QrScanner.ScanResult) => {
      if (effectiveMode !== 'scan') {
        return;
      }
      if (isProcessingRef.current) {
        return;
      }

      isProcessingRef.current = true;
      const scanned = result.data.trim();
      setCameraError(null);

      const scanner = scannerRef.current;
      if (scanner) {
        await scanner.pause();
      }

      try {
        await processScannedValueRef.current(scanned);
      } finally {
        isProcessingRef.current = false;
        if (rescanTimeoutRef.current !== null) {
          window.clearTimeout(rescanTimeoutRef.current);
        }
        rescanTimeoutRef.current = window.setTimeout(() => {
          void handleReScan();
        }, TIMEOUT_RESCAN);
      }
    },
    [handleReScan, effectiveMode],
  );

  useEffect(() => {
    if (effectiveMode !== 'scan') {
      return () => {
        // noop
      };
    }
    const wrapper = videoWrapperRef.current;
    if (!wrapper) {
      return;
    }

    const update = () => {
      setScanFrameSize(
        calculateScanSize(wrapper.clientWidth, wrapper.clientHeight),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(wrapper);
    return () => {
      observer.disconnect();
    };
  }, [calculateScanSize, effectiveMode]);

  useEffect(() => {
    if (effectiveMode !== 'scan') {
      return () => {
        // noop
      };
    }
    const video = videoRef.current;
    if (!video) {
      return;
    }

    // 初期化開始時に状態をリセット
    setIsCameraReady(false);
    setCameraError(null);

    const scanner = new QrScanner(
      video,
      (result) => {
        void handleDecode(result);
      },
      {
        onDecodeError: (error) => {
          const message = typeof error === 'string' ? error : error.message;
          if (
            message === 'No QR code found' ||
            message === 'Scanner error: No QR code found'
          ) {
            return;
          }
          // eslint-disable-next-line no-console
          console.error(error);
        },
        highlightScanRegion: false,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
        preferredCamera: facingMode,
      },
    );

    scannerRef.current = scanner;
    scanner.$canvas.getContext('2d', {
      alpha: false,
      willReadFrequently: true,
    });

    void scanner
      .start()
      .then(() => {
        setIsCameraReady(true);
        setCameraError(null);
      })
      .catch(() => {
        setIsCameraReady(false);
        setCameraError(
          'カメラを起動できませんでした。権限設定をご確認ください。',
        );
      });

    return () => {
      if (rescanTimeoutRef.current !== null) {
        window.clearTimeout(rescanTimeoutRef.current);
        rescanTimeoutRef.current = null;
      }
      scanner.destroy();
      scannerRef.current = null;
    };
  }, [handleDecode, effectiveMode, facingMode, cameraRestartNonce]);

  return (
    <>
      {mode === 'scan' && (
        <>
          <div ref={videoWrapperRef} className={scanStyles.videoWrapper}>
            <video
              ref={videoRef}
              className={scanStyles.video}
              playsInline
              muted
            />
            <div className={scanStyles.scanOverlay} aria-hidden='true'>
              <div
                className={scanStyles.scanFrame}
                style={{
                  width: `${scanFrameSize}px`,
                  height: `${scanFrameSize}px`,
                }}
              />
            </div>
          </div>
          {!isCameraReady && !cameraError && effectiveMode === 'scan' && (
            <Alert type='info' className={scanStyles.statusText}>
              カメラを初期化しています...
            </Alert>
          )}
          {cameraError && effectiveMode === 'scan' && (
            <Alert type='error' className={scanStyles.errorText}>
              {cameraError}
            </Alert>
          )}
        </>
      )}
      <div className={styles.pageShell}>
        {mode === 'register' && (
          <h1 className={baseStyles.pageTitle}>校内入場</h1>
        )}

        <button
          type='button'
          className={styles.iconButton}
          onClick={handleOpenAudioSettingsModal}
        >
          <IoMdSettings />
        </button>

        {mode === 'scan' && (
          <>
            <button
              type='button'
              onClick={() => setIsManualInputOverride(true)}
              className={scanStyles.manualInputButton}
            >
              <FaKeyboard size={18} />
              コードを手入力
            </button>
            <button
              type='button'
              className={scanStyles.cameraToggleButton}
              onClick={handleToggleCameraFacing}
              title='カメラを反転'
            >
              <MdCameraswitch />
            </button>
          </>
        )}

        {isServerOffline && mode === 'scan' && (
          <button
            type='button'
            className={scanStyles.warningButton}
            onClick={() => {
              window.scrollTo(0, window.innerHeight - 70);
            }}
          >
            <IoWarning />
          </button>
        )}

        {isServerOffline && (
          <section className={styles.offlineAlertSection}>
            <Alert type='warning'>
              同期サーバーに接続できないため、ローカルストレージの履歴を使って判定しています。再接続後に自動同期します。未同期:{' '}
              {pendingSyncCount}件
            </Alert>
          </section>
        )}
        {effectiveMode === 'register' && (
          <section>
            {mode === 'scan' ? (
              <div
                className={styles.modalOverlay}
                onClick={() => setIsManualInputOverride(false)}
              >
                <div
                  className={styles.modalContainer}
                  role='dialog'
                  aria-modal='true'
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className={styles.modalContent}>
                    <h2 className={styles.modalTitle}>コードを手入力</h2>
                    <form
                      onSubmit={async (event) => {
                        await handleRegister(event);
                        setIsManualInputOverride(false);
                      }}
                      className={styles.form}
                    >
                      <label className={styles.formLabel} htmlFor='ticket-code'>
                        チケットコード
                      </label>
                      <input
                        ref={inputRef}
                        autoFocus
                        id='ticket-code'
                        className={styles.textInput}
                        type='text'
                        value={scannedValue}
                        disabled={showServerModal}
                        onChange={(event) => {
                          setAutoHideRequested(false);
                          setScannedValue(event.currentTarget.value);
                        }}
                      />
                      <p className={styles.textInputRules}>
                        大文字・小文字は区別します。ハイフンはあっても無くても可。
                      </p>
                      <div className={styles.modalButtonGroup}>
                        <button
                          type='button'
                          className={styles.modalSecondaryButton}
                          onClick={() => setIsManualInputOverride(false)}
                        >
                          戻る
                        </button>
                        <button type='submit' className={styles.submitButton}>
                          登録
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleRegister} className={styles.form}>
                <label className={styles.formLabel} htmlFor='ticket-code'>
                  チケットコード
                </label>
                <input
                  ref={inputRef}
                  autoFocus
                  id='ticket-code'
                  className={styles.textInput}
                  type='text'
                  value={scannedValue}
                  disabled={showServerModal}
                  onChange={(event) => {
                    setAutoHideRequested(false);
                    setScannedValue(event.currentTarget.value);
                  }}
                />
                <p className={styles.textInputRules}>
                  大文字・小文字は区別します。ハイフンはあっても無くても可。
                </p>
                <button type='submit' className={styles.submitButton}>
                  登録
                </button>
              </form>
            )}
          </section>
        )}

        <section className={styles.statsSection}>
          <div className={styles.statCard}>
            <p className={styles.statLabel}>現在の入場者数</p>
            <p className={styles.statValue}>{entryCount}人</p>
          </div>
        </section>

        <section className={styles.recordsSection}>
          <div className={styles.recordsTitleRow}>
            <h2 className={styles.recordsTitle}>直近5件の読み取り履歴</h2>
            <a href='/admin/history'>すべての履歴</a>
          </div>
          {scanRecords.length > 0 ? (
            <div className={styles.recordsList}>
              {scanRecords.map((record) => (
                <div key={record.id} className={styles.recordItem}>
                  <div className={styles.recordId}>
                    <span className={styles.recordLabel}>ID:</span>
                    <span className={styles.recordValue}>{record.id}</span>
                  </div>
                  <div className={styles.recordCode}>
                    <span className={styles.recordLabel}>コード:</span>
                    <span className={styles.recordValue}>
                      {record.ticket_code}
                    </span>
                  </div>
                  {(record.result === 'success' ||
                    record.result === 'reentry') && (
                    <div className={styles.recordEntryCount}>
                      <span className={styles.recordLabel}>人数:</span>
                      <button
                        type='button'
                        className={styles.recordCountButton}
                        onClick={() =>
                          handleRecordCountChange(
                            record.id,
                            record.ticket_code,
                            -1,
                          )
                        }
                      >
                        <FaMinus />
                      </button>
                      <span className={styles.recordCountValue}>
                        {record.count ?? 1} 人
                      </span>
                      <button
                        type='button'
                        className={styles.recordCountButton}
                        onClick={() =>
                          handleRecordCountChange(
                            record.id,
                            record.ticket_code,
                            1,
                          )
                        }
                      >
                        <FaPlus />
                      </button>
                    </div>
                  )}
                  <div className={styles.recordDateTime}>
                    <span className={styles.recordLabel}>時刻:</span>
                    <span className={styles.recordValue}>
                      {new Date(record.scanned_at).toLocaleString()}
                    </span>
                  </div>
                  <div
                    className={`${styles.recordResult} ${
                      record.result === 'success'
                        ? styles.resultSuccess
                        : record.result === 'reentry'
                          ? styles.resultReentry
                          : styles.resultFailed
                    }`}
                  >
                    <span className={styles.recordLabel}>結果:</span>
                    <span className={styles.recordValue}>
                      {record.result === 'success'
                        ? '成功'
                        : record.result === 'duplicate'
                          ? '重複'
                          : record.result === 'reentry'
                            ? '再入場'
                            : record.result === 'failed'
                              ? 'エラー'
                              : record.result === 'unverified'
                                ? '署名検証エラー'
                                : record.result === 'wrongYear'
                                  ? '年度確認エラー'
                                  : record.result}
                    </span>
                  </div>
                  <div className={styles.deleteLog}>
                    <button
                      type='button'
                      className={styles.deleteButton}
                      onClick={() => requestDeleteLog(record.id)}
                    >
                      <TiDelete />
                      読み取り履歴を削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.noRecords}>読み取り履歴がまだありません</p>
          )}
        </section>

        {shouldRenderResultCard && decodedTicket && (
          <>
            <div
              className={`${styles.resultSuccessOverlay} ${
                isReentryResult ? styles.resultSuccessOverlayReentry : ''
              }`}
            ></div>
            <section
              className={`${styles.resultCard} ${
                isResultCardExiting
                  ? styles.resultCardExit
                  : styles.resultCardEnter
              } ${isReentryResult ? styles.resultCardReentry : ''}`}
            >
              <h2 className={styles.resultTitle}>
                <FaCircleCheck />
                読み取り成功{isReentryResult && ' (再入場)'}
              </h2>
              <div className={styles.resultBody}>
                <p className={styles.primaryPerformance}>
                  {resolvedTicket?.performanceName ?? '公演情報を解決中...'}
                  <span className={styles.scheduleName}>
                    {resolvedTicket?.scheduleName || ''}
                  </span>
                </p>
                <div className={styles.entryCountDisplay}>
                  <button
                    type='button'
                    className={styles.entryCountButton}
                    onClick={() => handleEntryCountChange(-1)}
                  >
                    <FaMinus />
                  </button>
                  <div className={styles.entryCountValue}>
                    {entryCountValue}
                    <span className={styles.entryCountUnit}>名</span>
                  </div>
                  <button
                    type='button'
                    className={styles.entryCountButton}
                    onClick={() => handleEntryCountChange(1)}
                  >
                    <FaPlus />
                  </button>
                </div>

                <div className={styles.secondaryRow}>
                  <span className={styles.secondaryItem}>
                    券種: {resolvedTicket?.ticketTypeLabel ?? '-'}
                  </span>
                  <span className={styles.secondaryItem}>
                    間柄: {resolvedTicket?.relationshipName ?? '-'}
                  </span>
                  <span className={styles.secondaryItem}>
                    発行者:{' '}
                    {formatIssuerDisplay(decodedTicket)}
                  </span>
                </div>

                <div className={styles.tertiaryBlock}>
                  {resolvedTicket?.performanceTitle && (
                    <p className={styles.tertiaryLine}>
                      演目: {resolvedTicket.performanceTitle}
                    </p>
                  )}
                  {resolvedTicket &&
                    (resolvedTicket.scheduleDate ||
                      resolvedTicket.scheduleTime ||
                      resolvedTicket.scheduleEndTime) && (
                      <p className={styles.tertiaryLine}>
                        日時: {resolvedTicket.scheduleDate}
                        {resolvedTicket.scheduleTime &&
                        resolvedTicket.scheduleEndTime
                          ? ` ${resolvedTicket.scheduleTime} - ${resolvedTicket.scheduleEndTime}`
                          : ''}
                      </p>
                    )}
                  {scannedValue && (
                    <>
                      <p className={styles.rawValue}>
                        チケットコード: {scannedValue.split('.')[0]}
                      </p>
                      <p className={styles.rawValue}>
                        読み取り時刻: {new Date().toLocaleString()}
                      </p>
                      <p className={styles.rawValue}>Raw: {scannedValue}</p>
                    </>
                  )}
                  <div className={styles.instructionBlock}>
                    <p>ようこそ!係員の指示に従ってご入場ください。</p>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {shouldRenderResultCard && decodeError && (
          <>
            <div className={styles.resultErrorOverlay}></div>
            <section
              className={`${styles.resultCard} ${isResultCardExiting ? styles.resultCardExit : styles.resultCardEnter} ${styles.resultCardError}`}
            >
              <h2 className={styles.resultTitle}>
                <FaCircleXmark />
                読み取り失敗
              </h2>
              <p
                className={`${styles.primaryPerformance} ${styles.resultFailed}`}
              >
                {decodeError.title}
              </p>
              <p>{decodeError.message}</p>
              <div className={styles.tertiaryBlock}>
                <p className={styles.rawValue}>Raw: {scannedValue}</p>
              </div>
            </section>
          </>
        )}

        <ServerUrlModal
          isOpen={showServerModal}
          currentUrl={localServerUrl}
          onSave={handleSaveServerUrl}
          onContinueWithoutServer={handleContinueWithoutServer}
        />
        {showSettingsModal && (
          <div className={styles.modalOverlay} onClick={() => undefined}>
            <div
              className={styles.modalContainer}
              role='dialog'
              aria-modal='true'
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.modalContent}>
                <h2 className={styles.modalTitle}>設定</h2>
                <div className={styles.serverUrlDisplay}>
                  <p className={styles.serverUrlLabel}>
                    同期サーバー:
                    <span className={styles.serverUrl}>
                      {localServerUrl === '' ? '未設定' : localServerUrl}
                    </span>
                  </p>
                  <button
                    type='button'
                    className={styles.changeButton}
                    onClick={handleOpenServerModal}
                  >
                    変更
                  </button>
                </div>
                <div className={styles.serverUrlDisplay}>
                  <p className={styles.serverUrlLabel}>
                    チケット状態キャッシュ:
                    <span className={styles.serverUrl}>
                      {ticketCacheSyncedAt
                        ? new Date(ticketCacheSyncedAt).toLocaleString()
                        : '未同期'}
                    </span>
                  </p>
                  <button
                    type='button'
                    className={styles.changeButton}
                    disabled={isTicketSyncing}
                    onClick={() => {
                      void handleSyncTicketsFromSupabase();
                    }}
                  >
                    {isTicketSyncing ? '同期中...' : 'Supabase同期'}
                  </button>
                </div>
                {ticketSyncMessage && (
                  <p className={styles.modalDescription}>{ticketSyncMessage}</p>
                )}
                {(mode === 'scan' || effectiveMode === 'scan') && (
                  <div className={styles.serverUrlDisplay}>
                    <p className={styles.serverUrlLabel}>
                      カメラ状態:
                      <span className={styles.serverUrl}>
                        {isCameraReady ? '動作中' : '停止中'}
                      </span>
                    </p>
                    <button
                      type='button'
                      className={styles.changeButton}
                      onClick={() => {
                        const scanner = scannerRef.current;
                        if (scanner) {
                          scanner.destroy();
                        }
                        setIsCameraReady(false);
                        setCameraError(null);
                        // 確実にクリーンアップを走らせるために微小な遅延を入れる
                        setTimeout(() => {
                          setCameraRestartNonce((n) => n + 1);
                        }, 1500);
                      }}
                    >
                      再起動
                    </button>
                  </div>
                )}
                <h2 className={styles.modalTitle}>音声設定</h2>
                <label className={styles.audioSettingRow}>
                  <span>音声案内</span>
                  <Switch
                    checked={audioSettings.enabled}
                    onChange={(checked: boolean) =>
                      setAudioSettings((current) => ({
                        ...current,
                        enabled: checked,
                      }))
                    }
                  />
                </label>
                <label className={styles.audioSettingRow}>
                  <span>音声タイプ</span>
                  <select
                    value={audioSettings.voiceVariant}
                    onChange={(event) =>
                      setAudioSettings((current) => ({
                        ...current,
                        voiceVariant: event.currentTarget.value as VoiceVariant,
                      }))
                    }
                  >
                    <option value='1'>音声1</option>
                    <option value='2'>音声2</option>
                    <option value='3'>音声3</option>
                    <option value='sfxOnly'>効果音のみ</option>
                  </select>
                </label>
                <p className={styles.credit}>
                  効果音: SND.dev、読み上げ音声: VOICEVOX Nemo
                </p>
                <div className={styles.modalButtonGroup}>
                  <button
                    type='button'
                    className={styles.submitButton}
                    onClick={handleCloseAudioSettingsModal}
                  >
                    閉じる
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {showAudioPermissionModal && (
          <div className={styles.modalOverlay} onClick={() => undefined}>
            <div
              className={styles.modalContainer}
              role='dialog'
              aria-modal='true'
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.modalContent}>
                <h2 className={styles.modalTitle}>音声再生の確認</h2>
                <p className={styles.modalDescription}>
                  音声案内を有効にしますか?
                  (ブラウザの仕様上、ユーザーの操作(ボタンなど)なしに音声を再生することができません。お手数ですが、毎回選択をお願いします。)
                </p>
                <div className={styles.modalButtonGroup}>
                  <button
                    type='button'
                    className={styles.modalSecondaryButton}
                    onClick={handleAudioPermissionDisable}
                  >
                    無効
                  </button>
                  <button
                    type='button'
                    className={styles.submitButton}
                    onClick={() => {
                      void handleAudioPermissionEnable();
                    }}
                  >
                    有効
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {showMissingSignatureModal && (
          <div className={styles.modalOverlay} onClick={() => undefined}>
            <div
              className={styles.modalContainer}
              role='dialog'
              aria-modal='true'
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.modalContent}>
                <h2 className={styles.modalTitle}>署名がありません</h2>
                <p className={styles.modalDescription}>
                  QRコードの署名が入力されていません。QRコード下のコードを手入力した場合は問題ありません。通常通りQRコードをスキャナで読み取った場合は、このチケットが不正な可能性があります。続行しますか?
                </p>
                <div className={styles.modalButtonGroup}>
                  <button
                    type='button'
                    className={styles.modalSecondaryButton}
                    onClick={handleMissingSignatureCancel}
                  >
                    キャンセル
                  </button>
                  <button
                    type='button'
                    className={styles.submitButton}
                    onClick={handleMissingSignatureContinue}
                  >
                    続行
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {showDeleteLogModal && (
          <div className={styles.modalOverlay} onClick={() => undefined}>
            <div
              className={styles.modalContainer}
              role='dialog'
              aria-modal='true'
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.modalContent}>
                <h2 className={styles.modalTitle}>読み取り履歴を削除</h2>
                <p className={styles.modalDescription}>
                  この履歴を削除しますか?一度削除した履歴は戻せません。ただし、操作履歴はすべてログに記録されています。
                </p>
                <div className={styles.modalButtonGroup}>
                  <button
                    type='button'
                    className={styles.modalSecondaryButton}
                    onClick={handleDeleteLogCancel}
                  >
                    キャンセル
                  </button>
                  <button
                    type='button'
                    className={styles.submitButton}
                    onClick={handleDeleteLogConfirm}
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {showUnknownStatusModal && (
          <div className={styles.modalOverlay} onClick={() => undefined}>
            <div
              className={styles.modalContainer}
              role='dialog'
              aria-modal='true'
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.modalContent}>
                <h2 className={styles.modalTitle}>チケット登録がありません</h2>
                <p className={styles.modalDescription}>
                  このチケットは、データベースに登録がありません。このチケットは当日に発行されたものか、あるいは不正に発行されたチケットである可能性があります。続行しますか?
                </p>
                <div className={styles.modalButtonGroup}>
                  <button
                    type='button'
                    className={styles.modalSecondaryButton}
                    onClick={() => {
                      void handleUnknownStatusCancel();
                    }}
                  >
                    キャンセル
                  </button>
                  <button
                    type='button'
                    className={styles.submitButton}
                    onClick={() => {
                      void handleUnknownStatusContinue();
                    }}
                  >
                    続行
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {ticketSyncWarning && (
          <div className={styles.modalOverlay} onClick={() => undefined}>
            <div
              className={styles.modalContainer}
              role='dialog'
              aria-modal='true'
              onClick={(event) => event.stopPropagation()}
            >
              <div className={styles.modalContent}>
                <h2 className={styles.modalTitle}>
                  チケットの状態が未同期です
                </h2>
                <p className={styles.modalDescription}>{ticketSyncWarning}</p>
                <div className={styles.modalButtonGroup}>
                  <button
                    type='button'
                    className={styles.modalSecondaryButton}
                    onClick={dismissTicketSyncWarning}
                  >
                    無視
                  </button>
                  <button
                    type='button'
                    className={styles.submitButton}
                    onClick={() => void handleSyncTicketsFromSupabase()}
                  >
                    {isTicketSyncing ? '同期中...' : '同期'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {showReentryModal &&
          duplicateInfo &&
          (() => {
            let timeAgo = '';
            if (duplicateInfo.lastUsedAt) {
              const diffMinutes = Math.floor(
                (new Date().getTime() - duplicateInfo.lastUsedAt.getTime()) /
                  (1000 * 60),
              );
              if (diffMinutes >= 60) {
                const diffHours = Math.floor(diffMinutes / 60);
                timeAgo = `${diffHours}時間${diffMinutes % 60}分前`;
              } else if (diffMinutes >= 1) {
                timeAgo = `${diffMinutes}分前`;
              } else if (diffMinutes < 1) {
                timeAgo = '1分未満前';
              } else {
                timeAgo = `${diffMinutes}分前`;
              }
            }
            return (
              <div className={styles.modalOverlay} onClick={() => undefined}>
                <div
                  className={styles.modalContainer}
                  role='dialog'
                  aria-modal='true'
                  onClick={(event) => event.stopPropagation()}
                >
                  <div className={styles.modalContent}>
                    <h2 className={styles.modalTitle}>
                      このチケットは使用済みです
                    </h2>
                    <p className={styles.modalDescription}>
                      このチケットは使用済みです。再入場として処理しますか?
                    </p>
                    <p className={styles.modalDescription}>
                      前回の使用時間: {duplicateInfo.ticketUsedAt}
                      {timeAgo && ` (${timeAgo})`}
                    </p>
                    {duplicateInfo.isRecent && (
                      <Alert type='warning'>
                        このチケットは直近に使用されたばかりです。
                      </Alert>
                    )}
                    <div className={styles.modalButtonGroup}>
                      <button
                        type='button'
                        className={styles.modalSecondaryButton}
                        onClick={handleReentryCancel}
                      >
                        キャンセル
                      </button>
                      <button
                        type='button'
                        className={styles.submitButton}
                        onClick={handleReentryConfirm}
                      >
                        再入場
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
      </div>
    </>
  );
};

export default AdminEntryPage;
