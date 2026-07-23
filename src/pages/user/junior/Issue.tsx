import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';
import BackButton from '../../../components/ui/BackButton';
import Alert from '../../../components/ui/Alert';
import IssueStepPerformance from '../../../features/issue/IssueStepPerformance';
import IssueStepTicketType from '../../../features/issue/IssueStepTicketType';
import {
  JUNIOR_ISSUE_RESULT_STORAGE_KEY,
  type IssueResultPayload,
} from '../../../features/issue/issueResultStorage';
import { formatTicketTypeLabel } from '../../../features/tickets/formatTicketTypeLabel';
import { useEventConfig } from '../../../hooks/useEventConfig';
import { useTitle } from '../../../hooks/useTitle';
import { supabase } from '../../../lib/supabase';
import type {
  SelectedPerformance,
  Step,
  TicketTypeOption,
} from '../../../types/Issue.types';
import { formatDateText } from '../../../utils/formatDateText';
import styles from '../students/Issue.module.css';
import {
  getJuniorApplicationDayVisibility,
  type JuniorApplicationDays,
  parseJuniorApplicationDaySelection,
  resolveJuniorApplicationDays,
  serializeJuniorApplicationDaySelection,
} from './applicationDay';

const PANEL_ANIMATION_MS = 360;
const ADMISSION_ONLY_TICKET_NAME = '入場専用券';
const GYM_TICKET_KEYWORD = '体育館';
const SELF_RELATIONSHIP_ID = 1;
const SELF_RELATIONSHIP_NAME = '本人';
const JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID = 7;

type ClassTicketCounterRow = {
  issued_general: number | null;
  issued_junior: number | null;
  issued_other: number | null;
};

type GymTicketCounterRow = {
  issued_count: number | null;
};

const calculateClassJuniorRemaining = ({
  totalCapacity,
  juniorCapacity,
  issuedGeneral,
  issuedJunior,
  issuedOther,
  isJuniorReleased,
}: {
  totalCapacity: number;
  juniorCapacity: number;
  issuedGeneral: number;
  issuedJunior: number;
  issuedOther: number;
  isJuniorReleased: boolean;
}): number => {
  if (isJuniorReleased) {
    return Math.max(
      totalCapacity - issuedGeneral - issuedJunior - issuedOther,
      0,
    );
  }

  const generalRemainingRaw =
    totalCapacity - juniorCapacity - issuedGeneral - issuedOther;
  return Math.max(
    juniorCapacity - issuedJunior - Math.max(-generalRemainingRaw, 0),
    0,
  );
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

const Issue = () => {
  const [step, setStep] = useState<Step>(1);
  const [selectedTicketTypeId, setSelectedTicketTypeId] = useState<number>(5);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeOption[]>([]);
  const [issueControls, setIssueControls] = useState<{
    junior_class_mode: 'open' | 'only-own' | 'off';
    junior_gym_mode: 'open' | 'only-own' | 'off';
    junior_entry_only_mode: 'open' | 'only-own' | 'off';
  } | null>(null);
  const [selectedPerformance, setSelectedPerformance] =
    useState<SelectedPerformance>(null);
  const [isIssuing, setIsIssuing] = useState(false);
  const [isTicketIssuingEnabled, setIsTicketIssuingEnabled] = useState(true);
  const [hasIssuedJuniorEntryOnlyTicket, setHasIssuedJuniorEntryOnlyTicket] =
    useState(false);
  const [juniorIssueCost, setJuniorIssueCost] = useState(1);
  const [remainingJuniorIssueCapacity, setRemainingJuniorIssueCapacity] =
    useState<number | null>(null);
  const [classApplicationDays, setClassApplicationDays] =
    useState<JuniorApplicationDays | null>(null);
  const [gymApplicationDays, setGymApplicationDays] =
    useState<JuniorApplicationDays | null>(null);
  const [leavingStep, setLeavingStep] = useState<Step | null>(null);
  const [isForward, setIsForward] = useState(true);
  const animationTimerRef = useRef<number | null>(null);

  const { route } = useLocation();
  const { config } = useEventConfig();

  useTitle('チケット発券 - 中学生用ページ');

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
    const loadApplicationDay = async () => {
      const { classDay, gymDay } = resolveJuniorApplicationDays(
        window.location.search,
      );
      const resolvedClassDays = classDay ?? gymDay;
      const resolvedGymDays = gymDay ?? classDay;

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
        setClassApplicationDays(
          storedSelection.classDay
        );
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
        setClassApplicationDays(
          databaseSelection.classDay,
        );
        setGymApplicationDays(
          databaseSelection.gymDay,
        );
        const serializedValue = serializeJuniorApplicationDaySelection(
          databaseSelection.classDay ?? databaseApplicationDays,
          databaseSelection.gymDay ?? databaseApplicationDays,
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
    const loadIssueControls = async () => {
      const { data, error } = await supabase
        .from('ticket_issue_controls')
        .select('*')
        .eq('id', 1)
        .maybeSingle();

      if (error || !data) {
        return;
      }
      setIssueControls(data);
    };

    void loadIssueControls();
  }, []);

  useEffect(() => {
    const loadHasIssuedJuniorEntryOnlyTicket = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      if (!userId) {
        setHasIssuedJuniorEntryOnlyTicket(false);
        return;
      }

      const { count, error } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'valid')
        .eq('ticket_type', JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID);

      if (error) {
        return;
      }

      setHasIssuedJuniorEntryOnlyTicket(Number(count ?? 0) > 0);
    };

    void loadHasIssuedJuniorEntryOnlyTicket();
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
        { data: userData, error: userError },
        { count, error: countError },
      ] = await Promise.all([
        supabase
          .from('configs')
          .select('max_tickets_per_junior_user')
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('users')
          .select('junior_usage_type')
          .eq('id', userId)
          .maybeSingle(),
        supabase
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('status', 'valid')
          .neq('ticket_type', JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID),
      ]);

      if (configError || userError || countError) {
        return;
      }

      const maxTicketsPerJuniorUser = Number(
        configData?.max_tickets_per_junior_user ?? -1,
      );
      const juniorUsageType = Number(userData?.junior_usage_type ?? -1);
      if (
        !Number.isInteger(maxTicketsPerJuniorUser) ||
        maxTicketsPerJuniorUser < 0
      ) {
        return;
      }

      const issueCost = juniorUsageType === 0 || juniorUsageType === 1 ? 2 : 1;
      const maxIssueCapacity =
        juniorUsageType === 0 || juniorUsageType === 1
          ? maxTicketsPerJuniorUser * 2
          : maxTicketsPerJuniorUser;
      const existingIssueCapacity = Number(count ?? 0);

      setJuniorIssueCost(issueCost);
      setRemainingJuniorIssueCapacity(
        Math.max(0, maxIssueCapacity - existingIssueCapacity),
      );
    };

    void loadJuniorIssueCapacity();
  }, []);

  useEffect(() => {
    const loadTicketTypes = async () => {
      const { data, error } = await supabase
        .from('ticket_types')
        .select('id, name, type')
        .eq('type', '中学生券')
        .order('id', { ascending: true });

      if (error) {
        alert('チケット種別の読み込みに失敗しました。');
        return;
      }

      setTicketTypes((data ?? []) as TicketTypeOption[]);
    };

    void loadTicketTypes();
  }, []);

  const applicationDayVisibility = useMemo(
    () =>
      getJuniorApplicationDayVisibility({
        classDay: classApplicationDays,
        gymDay: gymApplicationDays,
      }),
    [classApplicationDays, gymApplicationDays],
  );

  const activeTicketTypes = useMemo(() => {
    if (!issueControls) {
      return [];
    }
    const hasReachedCapacity =
      remainingJuniorIssueCapacity !== null &&
      remainingJuniorIssueCapacity < juniorIssueCost;
    const visibleTicketTypes = ticketTypes.filter((ticketType) => {
      if (ticketType.id === 5) {
        const isClassTicketAllowed =
          issueControls.junior_class_mode !== 'off' &&
          !hasReachedCapacity &&
          applicationDayVisibility.showClassPerformances;
        return isClassTicketAllowed;
      }
      if (ticketType.id === 6) {
        const isGymTicketAllowed =
          issueControls.junior_gym_mode !== 'off' &&
          !hasReachedCapacity &&
          applicationDayVisibility.showGymPerformances;
        return isGymTicketAllowed;
      }
      if (ticketType.id === JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID) {
        return (
          issueControls.junior_entry_only_mode !== 'off' &&
          !hasIssuedJuniorEntryOnlyTicket
        );
      }
      return false;
    });

    return visibleTicketTypes.map((ticketType) => ({
      ...ticketType,
      is_active: true,
    }));
  }, [
    ticketTypes,
    issueControls,
    hasIssuedJuniorEntryOnlyTicket,
    remainingJuniorIssueCapacity,
    juniorIssueCost,
    applicationDayVisibility,
  ]);

  useEffect(() => {
    const firstActive = activeTicketTypes.find(
      (ticketType) => ticketType.is_active,
    );
    if (firstActive) {
      setSelectedTicketTypeId(firstActive.id);
    }
  }, [activeTicketTypes]);

  useEffect(() => {
    return () => {
      if (animationTimerRef.current !== null) {
        window.clearTimeout(animationTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const loadSelectionFromQuery = async () => {
      const params = new URLSearchParams(window.location.search);
      const venue = params.get('venue');
      const performanceId = Number(params.get('performanceId'));
      const scheduleId = Number(params.get('scheduleId'));

      if (venue === 'gym') {
        if (!Number.isInteger(performanceId) || performanceId <= 0) {
          return;
        }

        const [
          { data: performanceData, error: performanceError },
          { data: counterData, error: counterError },
        ] = await Promise.all([
          supabase
            .from('gym_performances')
            .select('id, group_name, round_name, capacity')
            .eq('id', performanceId)
            .maybeSingle(),
          supabase
            .from('gym_ticket_counters')
            .select('issued_count')
            .eq('performance_id', performanceId)
            .maybeSingle(),
        ]);

        if (performanceError || counterError || !performanceData) {
          return;
        }

        const issuedCount = Number(
          (counterData as GymTicketCounterRow | null)?.issued_count ?? 0,
        );
        const remaining = Math.max(
          Number(performanceData.capacity ?? 0) - issuedCount,
          0,
        );

        if (remaining <= 0) {
          return;
        }

        const gymTicketType = activeTicketTypes.find((ticketType) =>
          ticketType.name.includes(GYM_TICKET_KEYWORD),
        );
        if (gymTicketType?.is_active) {
          setSelectedTicketTypeId(gymTicketType.id);
        }

        setSelectedPerformance({
          performanceId: performanceData.id,
          performanceName: performanceData.group_name,
          scheduleId: 0,
          scheduleName: performanceData.round_name,
          remaining,
        });
        setStep(3);
        return;
      }

      if (
        !Number.isInteger(performanceId) ||
        !Number.isInteger(scheduleId) ||
        performanceId <= 0 ||
        scheduleId <= 0
      ) {
        return;
      }

      const [
        { data: performanceData, error: performanceError },
        { data: scheduleData, error: scheduleError },
        { data: counterData, error: counterError },
        { data: configData, error: configError },
      ] = await Promise.all([
        supabase
          .from('class_performances')
          .select('id, class_name, total_capacity, junior_capacity')
          .eq('id', performanceId)
          .maybeSingle(),
        supabase
          .from('performances_schedule')
          .select('id, round_name')
          .eq('id', scheduleId)
          .maybeSingle(),
        supabase
          .from('class_ticket_counters')
          .select('issued_general, issued_junior, issued_other')
          .eq('class_id', performanceId)
          .eq('round_id', scheduleId)
          .maybeSingle(),
        supabase
          .from('configs')
          .select('junior_release_open')
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      if (performanceError || scheduleError || counterError || configError) {
        return;
      }

      if (!performanceData || !scheduleData) {
        return;
      }

      const counter = counterData as ClassTicketCounterRow | null;
      const remaining = calculateClassJuniorRemaining({
        totalCapacity: Number(performanceData.total_capacity ?? 0),
        juniorCapacity: Number(performanceData.junior_capacity ?? 0),
        issuedGeneral: Number(counter?.issued_general ?? 0),
        issuedJunior: Number(counter?.issued_junior ?? 0),
        issuedOther: Number(counter?.issued_other ?? 0),
        isJuniorReleased: Boolean(configData?.junior_release_open),
      });

      if (remaining <= 0) {
        return;
      }

      const classTicketType = activeTicketTypes.find(
        (ticketType) =>
          ticketType.name !== ADMISSION_ONLY_TICKET_NAME &&
          !ticketType.name.includes(GYM_TICKET_KEYWORD),
      );
      if (classTicketType?.is_active) {
        setSelectedTicketTypeId(classTicketType.id);
      }

      setSelectedPerformance({
        performanceId: performanceData.id,
        performanceName: performanceData.class_name,
        scheduleId: scheduleData.id,
        scheduleName: scheduleData.round_name,
        remaining,
      });
      setStep(3);
    };

    void loadSelectionFromQuery();
  }, [activeTicketTypes]);

  const selectedTicketType = useMemo(
    () =>
      ticketTypes.find(
        (ticketType) => ticketType.id === selectedTicketTypeId,
      ) ?? null,
    [selectedTicketTypeId, ticketTypes],
  );
  const isGymPerformanceTicket = Boolean(
    selectedTicketType?.name.includes(GYM_TICKET_KEYWORD),
  );
  const isAdmissionOnlyTicket =
    selectedTicketType?.name === ADMISSION_ONLY_TICKET_NAME;
  const hasAnyActiveTicketType = useMemo(
    () => activeTicketTypes.some((ticketType) => ticketType.is_active),
    [activeTicketTypes],
  );
  const visiblePerformanceFilter = useMemo(() => {
    if (!classApplicationDays || classApplicationDays.length === 0) {
      return null;
    }

    return (scheduleId: number, roundName: string) => {
      const day1Schedules = [1, 2, 3, 4];
      const day2Schedules = [5, 6, 7, 8];
      const allowedScheduleIds = [
        ...(classApplicationDays.includes('day1') ? day1Schedules : []),
        ...(classApplicationDays.includes('day2') ? day2Schedules : []),
      ];
      if (!allowedScheduleIds.includes(scheduleId)) {
        return false;
      }
      if (
        classApplicationDays.includes('day1') &&
        classApplicationDays.includes('day2')
      ) {
        return true;
      }
      if (classApplicationDays.includes('day1')) {
        return !roundName.includes('2日目');
      }
      return roundName.includes('2日目');
    };
  }, [classApplicationDays]);

  const visibleGymPerformanceFilter = useMemo(() => {
    if (!gymApplicationDays || gymApplicationDays.length === 0) {
      return null;
    }

    return (_scheduleId: number, roundName: string) => {
      if (
        gymApplicationDays.includes('day1') &&
        gymApplicationDays.includes('day2')
      ) {
        return true;
      }
      if (gymApplicationDays.includes('day1')) {
        return !roundName.includes('2日目');
      }
      return roundName.includes('2日目');
    };
  }, [gymApplicationDays]);
  const isIssueReceptionStopped =
    !isTicketIssuingEnabled || !hasAnyActiveTicketType;
  const isAtJuniorIssueLimit =
    remainingJuniorIssueCapacity !== null &&
    remainingJuniorIssueCapacity < juniorIssueCost;

  useEffect(() => {
    if (!selectedTicketType) {
      return;
    }

    if (isAdmissionOnlyTicket) {
      if (
        !selectedPerformance ||
        selectedPerformance.performanceId !== 0 ||
        selectedPerformance.scheduleId !== 0
      ) {
        setSelectedPerformance({
          performanceId: 0,
          performanceName: '入場専用券',
          scheduleId: 0,
          scheduleName: '',
          remaining: 0,
        });
      }
      return;
    }

    if (
      selectedPerformance &&
      selectedPerformance.performanceId === 0 &&
      selectedPerformance.scheduleId === 0
    ) {
      setSelectedPerformance(null);
    }
  }, [isAdmissionOnlyTicket, selectedPerformance, selectedTicketType]);

  const selectedCellKey = selectedPerformance
    ? selectedPerformance.performanceId > 0
      ? `${selectedPerformance.performanceId}-${selectedPerformance.scheduleId}`
      : undefined
    : undefined;

  const canSubmit = Boolean(selectedTicketType) && Boolean(selectedPerformance);

  const transitionToStep = (nextStep: Step) => {
    if (nextStep === step) {
      return;
    }

    if (animationTimerRef.current !== null) {
      window.clearTimeout(animationTimerRef.current);
    }

    const movingForward = nextStep > step;
    setIsForward(movingForward);
    setLeavingStep(step);
    setStep(nextStep);

    if (movingForward) {
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }

    animationTimerRef.current = window.setTimeout(() => {
      setLeavingStep(null);
      animationTimerRef.current = null;
    }, PANEL_ANIMATION_MS);
  };

  const getPanelClassName = (panelStep: Step) => {
    if (panelStep === step) {
      if (leavingStep === null) {
        return `${styles.stepPanel} ${styles.panelVisible}`;
      }

      return `${styles.stepPanel} ${styles.panelVisible} ${
        isForward ? styles.panelEnterFromRight : styles.panelEnterFromLeft
      }`;
    }

    if (panelStep === leavingStep) {
      return `${styles.stepPanel} ${styles.panelLeaving} ${
        isForward ? styles.panelExitToLeft : styles.panelExitToRight
      }`;
    }

    return `${styles.stepPanel} ${styles.panelHidden}`;
  };

  const handleIssue = async () => {
    if (isIssueReceptionStopped) {
      alert('現在チケット発券は受付停止中です。');
      return;
    }

    if (!canSubmit || !selectedPerformance || !selectedTicketType) {
      return;
    }

    setIsIssuing(true);

    const isGymSelection =
      selectedPerformance.performanceId > 0 &&
      selectedPerformance.scheduleId === 0;

    const [
      { data: performanceTitle },
      { data: scheduleData },
      { data: gymPerformanceData },
      { data: configData },
    ] = await Promise.all([
      !isGymSelection && selectedPerformance.performanceId > 0
        ? supabase
            .from('class_performances')
            .select('title')
            .eq('id', selectedPerformance.performanceId)
            .maybeSingle()
        : { data: null },
      selectedPerformance.scheduleId > 0
        ? supabase
            .from('performances_schedule')
            .select('start_at')
            .eq('id', selectedPerformance.scheduleId)
            .maybeSingle()
        : { data: null },
      isGymSelection
        ? supabase
            .from('gym_performances')
            .select('start_at')
            .eq('id', selectedPerformance.performanceId)
            .maybeSingle()
        : { data: null },
      supabase
        .from('configs')
        .select('show_length')
        .order('id', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    let scheduleDate = '-';
    let scheduleTime = '';
    let scheduleEndTime = '';
    if (selectedPerformance.scheduleId === 0) {
      if (selectedPerformance.performanceId === 0) {
        const eventDates = (config.date ?? []).filter(
          (date) => typeof date === 'string' && date.length > 0,
        );
        scheduleDate = formatDateText(eventDates) || '-';
      } else if (gymPerformanceData?.start_at) {
        const startAt = new Date(gymPerformanceData.start_at);
        const showLengthMinutes = Number(configData?.show_length ?? 0);
        const endAt = new Date(
          startAt.getTime() + showLengthMinutes * 60 * 1000,
        );
        scheduleDate = startAt.toLocaleDateString('ja-JP', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        scheduleTime = startAt.toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
        });
        scheduleEndTime = endAt.toLocaleTimeString('ja-JP', {
          hour: '2-digit',
          minute: '2-digit',
        });
      }
    } else if (scheduleData?.start_at) {
      const startAt = new Date(scheduleData.start_at);
      const showLengthMinutes = Number(configData?.show_length ?? 0);
      const endAt = new Date(startAt.getTime() + showLengthMinutes * 60 * 1000);
      scheduleDate = startAt.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      scheduleTime = startAt.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      });
      scheduleEndTime = endAt.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    const { data, error } = await supabase.functions.invoke('issue-tickets', {
      body: {
        ticketTypeId: selectedTicketType.id,
        relationshipId: SELF_RELATIONSHIP_ID,
        performanceId: selectedPerformance.performanceId,
        scheduleId: selectedPerformance.scheduleId,
        issueCount: 1,
      },
    });

    if (error) {
      const message = await readFunctionErrorMessage(error);
      alert(`発券に失敗しました: ${message}`);
      setIsIssuing(false);
      return;
    }

    const payload: IssueResultPayload = {
      performanceName: selectedPerformance.performanceName,
      performanceTitle:
        (performanceTitle as { title?: string | null } | null)?.title ?? '',
      scheduleName: selectedPerformance.scheduleName,
      scheduleDate,
      scheduleTime,
      scheduleEndTime,
      ticketTypeLabel: formatTicketTypeLabel({
        type: selectedTicketType.type,
        name: selectedTicketType.name,
        fallback: selectedTicketType.name,
      }),
      relationshipName: SELF_RELATIONSHIP_NAME,
      relationshipId: SELF_RELATIONSHIP_ID,
      issuedTickets: (data?.issuedTickets ?? []) as Array<{
        code: string;
        signature: string;
      }>,
    };

    window.sessionStorage.setItem(
      JUNIOR_ISSUE_RESULT_STORAGE_KEY,
      JSON.stringify(payload),
    );
    route('/junior/issue/result');
  };

  return (
    <div className={styles.issuePage}>
      <BackButton href='/junior/mypage' />
      <h1 className={styles.pageTitle}>チケット発券</h1>

      {isIssueReceptionStopped && !isAtJuniorIssueLimit ? (
        <Alert type='warning'>現在チケット発券は受付停止中です。</Alert>
      ) : null}
      {isAtJuniorIssueLimit ? (
        <Alert type='warning'>
          最大発行可能枚数に達しているため、入場専用券のみ発券できます。
        </Alert>
      ) : null}

      <div className={styles.sliderViewport}>
        <div className={getPanelClassName(1)}>
          <IssueStepTicketType
            options={activeTicketTypes}
            selectedTicketTypeId={selectedTicketTypeId}
            onSelectTicketType={setSelectedTicketTypeId}
          />
        </div>

        <div className={getPanelClassName(2)}>
          <IssueStepPerformance
            isGymPerformanceTicket={isGymPerformanceTicket}
            selectedPerformance={selectedPerformance}
            selectedCellKey={selectedCellKey}
            classRemainingMode='junior'
            classScheduleFilter={visiblePerformanceFilter ?? undefined}
            gymScheduleFilter={visibleGymPerformanceFilter ?? undefined}
            showClassPerformances={
              applicationDayVisibility.showClassPerformances
            }
            showGymPerformances={applicationDayVisibility.showGymPerformances}
            onSelectPerformance={setSelectedPerformance}
          />
        </div>

        <div className={getPanelClassName(3)}>
          <section>
            <h2 className={styles.sectionTitle}>3. 発券内容</h2>
            <ul className={styles.previewList}>
              <li>
                <span>チケットタイプ</span>
                <strong>{selectedTicketType?.name ?? '-'}</strong>
              </li>
              <li>
                <span>公演</span>
                <strong>{selectedPerformance?.performanceName ?? '-'}</strong>
              </li>
              <li>
                <span>公演回</span>
                <strong>{selectedPerformance?.scheduleName ?? '-'}</strong>
              </li>
              <li>
                <span>間柄</span>
                <strong>{SELF_RELATIONSHIP_NAME}</strong>
              </li>
              <li>
                <span>発行枚数</span>
                <strong>1枚</strong>
              </li>
            </ul>
          </section>
        </div>

        <div className={styles.actions}>
          <div className={styles.progressSection}>
            {(() => {
              const totalSteps = isAdmissionOnlyTicket ? 2 : 3;
              const displayedStep =
                isAdmissionOnlyTicket && step === 3 ? 2 : step;
              return (
                <>
                  <progress
                    className={styles.progressBar}
                    max={totalSteps}
                    value={displayedStep}
                  ></progress>
                  <p className={styles.stepIndicator}>
                    STEP {displayedStep} / {totalSteps}
                  </p>
                </>
              );
            })()}
          </div>
          <button
            type='button'
            className={styles.backButton}
            onClick={() => {
              if (step === 3 && isAdmissionOnlyTicket) {
                transitionToStep(1);
              } else if (step > 1) {
                transitionToStep((step - 1) as Step);
              }
            }}
            style={step === 1 ? { visibility: 'hidden' } : undefined}
          >
            戻る
          </button>
          <div>
            <button
              type='button'
              className={styles.nextButton}
              onClick={() => {
                if (step === 1) {
                  transitionToStep(isAdmissionOnlyTicket ? 3 : 2);
                } else if (step === 2) {
                  transitionToStep(3);
                }
              }}
              disabled={
                (step === 1 && !selectedTicketType) ||
                (step === 2 && !selectedPerformance)
              }
              style={step === 3 ? { display: 'none' } : undefined}
            >
              次へ
            </button>
            <button
              type='button'
              className={styles.generateButton}
              onClick={() => void handleIssue()}
              disabled={isIssuing || !canSubmit || isIssueReceptionStopped}
              style={step !== 3 ? { display: 'none' } : undefined}
            >
              {isIssuing ? '発券中...' : '発券する'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Issue;
