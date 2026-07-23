import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import IssueStepPerformance from '../../../features/issue/IssueStepPerformance';
import IssueStepTicketType from '../../../features/issue/IssueStepTicketType';
import {
  DAY_TICKET_RESULT_STORAGE_KEY,
  type IssueResultPayload,
} from '../../../features/issue/issueResultStorage';
import { supabase } from '../../../lib/supabase';
import type {
  SelectedPerformance,
  Step,
  TicketTypeOption,
} from '../../../types/Issue.types';
import styles from '../students/Issue.module.css';
import BackButton from '../../../components/ui/BackButton';
import NormalSection from '../../../components/ui/NormalSection';
import { formatDateText } from '../../../utils/formatDateText';
import { useEventConfig } from '../../../hooks/useEventConfig';
import { formatTicketTypeLabel } from '../../../features/tickets/formatTicketTypeLabel';
import Alert from '../../../components/ui/Alert';
import LoadingSpinner from '../../../components/ui/LoadingSpinner';
import { useTitle } from '../../../hooks/useTitle';
import { NoIndexMeta } from '../../../components/NoIndexMeta';

const MAX_ISSUE_COUNT = 5;
const PANEL_ANIMATION_MS = 360;
const SELF_RELATIONSHIP_ID = 1;
const SELF_RELATIONSHIP_NAME = '本人';
const CLASS_DAY_TICKET_ID = 8;
const GYM_DAY_TICKET_ID = 9;

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

const DayTicketIssue = () => {
  const [step, setStep] = useState<Step>(1);
  const [selectedTicketTypeId, setSelectedTicketTypeId] =
    useState<number>(CLASS_DAY_TICKET_ID);
  const [selectedPerformance, setSelectedPerformance] =
    useState<SelectedPerformance>(null);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeOption[]>([]);
  const [issueControls, setIssueControls] = useState<{
    same_day_class_mode: 'open' | 'auto' | 'off';
    same_day_gym_mode: 'open' | 'auto' | 'off';
  } | null>(null);
  const [issueCount, setIssueCount] = useState(1);
  const [isIssuing, setIsIssuing] = useState(false);
  const [isTicketIssuingEnabled, setIsTicketIssuingEnabled] = useState(true);
  const [leavingStep, setLeavingStep] = useState<Step | null>(null);
  const [isForward, setIsForward] = useState(true);
  const animationTimerRef = useRef<number | null>(null);

  const { route } = useLocation();
  const { config } = useEventConfig();

  useTitle('当日券');

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
    const loadIssueControls = async () => {
      const { data, error } = await supabase
        .from('ticket_issue_controls')
        .select('same_day_class_mode, same_day_gym_mode')
        .eq('id', 1)
        .maybeSingle();

      if (error) {
        return;
      }

      if (data) {
        setIssueControls(data);
      }
    };

    void loadIssueControls();
  }, []);

  useEffect(() => {
    const loadTicketTypes = async () => {
      const { data, error } = await supabase
        .from('ticket_types')
        .select('id, name, type')
        .eq('type', '当日券')
        .in('id', [CLASS_DAY_TICKET_ID, GYM_DAY_TICKET_ID])
        .order('id', { ascending: true });

      if (error) {
        alert('当日券種別の読み込みに失敗しました。');
        return;
      }

      const nextTypes = (data ?? []) as TicketTypeOption[];
      setTicketTypes(nextTypes);
    };

    void loadTicketTypes();
  }, []);

  // ticket_issue_controls に基づいて有効な当日券種を計算
  const activeTicketTypes = useMemo(() => {
    if (!issueControls) {
      return [];
    }

    const todayStr = new Date().toLocaleDateString('sv-SE');
    const isTodayEventDay = (config.date ?? [])
      .filter((d) => typeof d === 'string' && d.length > 0)
      .includes(todayStr);

    return ticketTypes.map((t) => {
      let mode: 'open' | 'auto' | 'off' = 'off';
      let isActive = false;
      if (t.id === CLASS_DAY_TICKET_ID) {
        mode = issueControls.same_day_class_mode;
      } else if (t.id === GYM_DAY_TICKET_ID) {
        mode = issueControls.same_day_gym_mode;
      }

      if (mode === 'open') {
        isActive = true;
      } else if (mode === 'auto') {
        isActive = isTodayEventDay;
      }

      return { ...t, is_active: isActive };
    });
  }, [ticketTypes, issueControls, config.date]);

  useEffect(() => {
    const active = activeTicketTypes.filter((t) => t.is_active);
    if (
      active.length > 0 &&
      !active.find((t) => t.id === selectedTicketTypeId)
    ) {
      setSelectedTicketTypeId(active[0].id);
    }
  }, [activeTicketTypes, selectedTicketTypeId]);

  useEffect(
    () => () => {
      if (animationTimerRef.current !== null) {
        window.clearTimeout(animationTimerRef.current);
      }
    },
    [],
  );

  const selectedTicketType = useMemo(
    () =>
      activeTicketTypes.find(
        (ticketType) => ticketType.id === selectedTicketTypeId,
      ) ?? null,
    [activeTicketTypes, selectedTicketTypeId],
  );
  const hasAnyActiveTicketType = useMemo(
    () => activeTicketTypes.some((t) => t.is_active),
    [activeTicketTypes],
  );
  const isIssueReceptionStopped =
    !isTicketIssuingEnabled || !hasAnyActiveTicketType;

  const isGymPerformanceTicket = selectedTicketTypeId === GYM_DAY_TICKET_ID;

  useEffect(() => {
    if (!selectedPerformance) {
      return;
    }

    const isGymSelection =
      selectedPerformance.performanceId > 0 &&
      selectedPerformance.scheduleId === 0;

    if (isGymPerformanceTicket && !isGymSelection) {
      setSelectedPerformance(null);
      return;
    }

    if (!isGymPerformanceTicket && isGymSelection) {
      setSelectedPerformance(null);
    }
  }, [isGymPerformanceTicket, selectedPerformance]);

  const selectedCellKey = selectedPerformance
    ? `${selectedPerformance.performanceId}-${selectedPerformance.scheduleId}`
    : undefined;

  const canSubmit =
    Boolean(selectedTicketType?.is_active) &&
    Boolean(selectedPerformance) &&
    issueCount > 0;

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
      alert('現在当日券は受付停止中です。');
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
      !isGymSelection
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

    if (selectedPerformance.scheduleId === 0 && gymPerformanceData?.start_at) {
      const startAt = new Date(gymPerformanceData.start_at);
      const showLengthMinutes = Number(configData?.show_length ?? 0);
      const endAt = startAt
        ? new Date(startAt.getTime() + showLengthMinutes * 60 * 1000)
        : null;

      scheduleDate = startAt.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      scheduleTime = startAt.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      });
      scheduleEndTime = endAt
        ? endAt.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '-';
    } else if (scheduleData?.start_at) {
      const startAt = new Date(scheduleData.start_at);
      const showLengthMinutes = Number(configData?.show_length ?? 0);
      const endAt = startAt
        ? new Date(startAt.getTime() + showLengthMinutes * 60 * 1000)
        : null;

      scheduleDate = startAt.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
      scheduleTime = startAt.toLocaleTimeString('ja-JP', {
        hour: '2-digit',
        minute: '2-digit',
      });
      scheduleEndTime = endAt
        ? endAt.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
          })
        : '-';
    }

    const { data, error } = await supabase.functions.invoke('issue-tickets', {
      body: {
        ticketTypeId: selectedTicketType.id,
        relationshipId: SELF_RELATIONSHIP_ID,
        performanceId: selectedPerformance.performanceId,
        scheduleId: selectedPerformance.scheduleId,
        issueCount,
      },
    });

    if (error) {
      const detailedMessage = await readFunctionErrorMessage(error);
      alert(`発券に失敗しました: ${detailedMessage}`);
      setIsIssuing(false);
      return;
    }

    const issuedTickets = (
      data as {
        issuedTickets?: Array<{ code: string; signature: string }>;
      } | null
    )?.issuedTickets;

    if (!issuedTickets || issuedTickets.length === 0) {
      alert('発券結果を取得できませんでした。');
      setIsIssuing(false);
      return;
    }

    const payload: IssueResultPayload = {
      performanceName: selectedPerformance.performanceName,
      performanceTitle: performanceTitle?.title ?? '',
      scheduleName: selectedPerformance.scheduleName,
      scheduleDate,
      scheduleTime,
      scheduleEndTime,
      ticketTypeLabel: formatTicketTypeLabel({
        type: selectedTicketType.type,
        name: selectedTicketType.name,
      }),
      relationshipName: SELF_RELATIONSHIP_NAME,
      relationshipId: SELF_RELATIONSHIP_ID,
      issuedTickets,
    };

    window.sessionStorage.setItem(
      DAY_TICKET_RESULT_STORAGE_KEY,
      JSON.stringify(payload),
    );

    setIssueCount(1);
    setIsIssuing(false);
    route('/day-tickets/result');
  };

  const eventDateText = formatDateText(config.date);

  const isInitialLoading = !issueControls || ticketTypes.length === 0;

  if (isInitialLoading) {
    return (
      <div className={styles.issuePage}>
        <BackButton href='/' />
        <h1 className={styles.pageTitle}>当日券発券</h1>
        <LoadingSpinner />
      </div>
    );
  }

  if (isIssueReceptionStopped) {
    return (
      <div className={styles.issuePage}>
        <BackButton href='/' />
        <h1 className={styles.pageTitle}>当日券発券</h1>
        <Alert type='warning'>
          <p>現在当日券は受付停止中です。</p>
        </Alert>
      </div>
    );
  }

  return (
    <>
      <NoIndexMeta />
      <div className={styles.issuePage}>
        <BackButton href='/' />
        <h1 className={styles.pageTitle}>当日券発券</h1>
        <p style={{ margin: '0 1rem' }}>
          {eventDateText
            ? `${eventDateText} の当日券を発券できます。`
            : '当日券を発券できます。'}
        </p>

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
              classRemainingMode='total'
              selectedPerformance={selectedPerformance}
              selectedCellKey={selectedCellKey}
              onSelectPerformance={setSelectedPerformance}
            />
          </div>

          <div className={getPanelClassName(3)}>
            <NormalSection>
              <h2 className={styles.sectionTitle}>3. 発行枚数</h2>
              <div className={styles.formRow}>
                <label className={styles.formLabel} htmlFor='day-issue-count'>
                  発行枚数
                </label>
                <p style={{ margin: 0, paddingLeft: '1em' }}>
                  この枚数分だけ、1人分のチケットが同時に発券されます。
                </p>
                <select
                  id='day-issue-count'
                  className={styles.select}
                  value={String(issueCount)}
                  onChange={(event) =>
                    setIssueCount(Number(event.currentTarget.value))
                  }
                >
                  {Array.from(
                    { length: MAX_ISSUE_COUNT },
                    (_, index) => index + 1,
                  ).map((count) => (
                    <option key={count} value={count}>
                      {count}枚
                    </option>
                  ))}
                </select>
              </div>

              <h3 className={styles.previewHeading}>発券内容</h3>
              <ul className={styles.previewList}>
                <li>
                  <span>チケットタイプ</span>
                  <strong>{selectedTicketType?.name ?? '-'}</strong>
                </li>
                <li>
                  <span>公演のクラス/団体</span>
                  <strong>
                    {selectedPerformance
                      ? selectedPerformance.performanceName
                      : '-'}
                  </strong>
                </li>
                <li>
                  <span>公演回</span>
                  <strong>
                    {selectedPerformance
                      ? selectedPerformance.scheduleName
                      : '-'}
                  </strong>
                </li>
                <li>
                  <span>利用者との間柄</span>
                  <strong>{SELF_RELATIONSHIP_NAME}</strong>
                </li>
                <li>
                  <span>発行枚数</span>
                  <strong>{issueCount}枚</strong>
                </li>
              </ul>
            </NormalSection>
          </div>

          <div className={styles.actions}>
            <div className={styles.progressSection}>
              <progress
                className={styles.progressBar}
                max={3}
                value={step}
              ></progress>
              <p className={styles.stepIndicator}>STEP {step} / 3</p>
            </div>

            <button
              type='button'
              className={styles.backButton}
              onClick={() => {
                if (step > 1) {
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
                    transitionToStep(2);
                    return;
                  }

                  if (step === 2) {
                    transitionToStep(3);
                  }
                }}
                disabled={
                  (step === 1 &&
                    (!selectedTicketType || !selectedTicketType.is_active)) ||
                  (step === 2 && !selectedPerformance) ||
                  step === 3
                }
                style={step === 3 ? { display: 'none' } : undefined}
              >
                次へ
              </button>
              <button
                type='button'
                className={styles.generateButton}
                onClick={handleIssue}
                disabled={!canSubmit || isIssuing || isIssueReceptionStopped}
                style={step !== 3 ? { display: 'none' } : undefined}
              >
                {isIssuing ? '発券中...' : '発券する'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default DayTicketIssue;
