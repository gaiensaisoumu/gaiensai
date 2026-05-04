import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { supabase } from '../../lib/supabase';
import styles from './PerformancesTable.module.css';
import { RiCircleLine, RiCloseLargeLine, RiTriangleLine } from 'react-icons/ri';
import { useLocation } from 'preact-iso';

import type { AvailableSeatSelection } from '../../types/types';
import LoadingSpinner from '../../components/ui/LoadingSpinner';

type PerformanceRow = {
  id: number;
  class_name: string;
  total_capacity: number | null;
  junior_capacity: number | null;
};

type PerformanceSchedule = {
  id: number;
  round_name: string;
};

type ClassTicketCounterRow = {
  class_id: number;
  round_id: number;
  issued_general: number | null;
  issued_junior: number | null;
  issued_other: number | null;
};

type PerformancesTableProps = {
  enableIssueJump?: boolean;
  issuePath?: string;
  onAvailableCellClick?: (selection: AvailableSeatSelection | null) => void;
  selectedCellKey?: string;
  remainingMode?: 'general' | 'total' | 'junior';
  showToggleRemainingMode?: boolean;
  restrictedClassName?: string | null;
  filterAccepting?: boolean;
};

const PerformancesTable = ({
  enableIssueJump = false,
  issuePath = '/students/issue',
  onAvailableCellClick,
  selectedCellKey,
  remainingMode = 'general',
  showToggleRemainingMode = false,
  restrictedClassName = null,
  filterAccepting = false,
}: PerformancesTableProps) => {
  const autoSelectedCellKeyRef = useRef<string | null>(null);
  const [performances, setPerformances] = useState<PerformanceRow[]>([]);
  const [schedules, setSchedules] = useState<PerformanceSchedule[]>([]);
  const [selectedPerformanceId, setSelectedPerformanceId] = useState<
    number | 'all'
  >('all');
  const [selectedScheduleId, setSelectedScheduleId] = useState<number | 'all'>(
    'all',
  );
  const [remainingSeatMap, setRemainingSeatMap] = useState<Map<string, number>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentRemainingMode, setCurrentRemainingMode] = useState<
    'general' | 'junior' | 'total'
  >(remainingMode);

  const { route } = useLocation();

  const tableWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentRemainingMode(remainingMode);
  }, [remainingMode]);

  useEffect(() => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) {
      return;
    }

    let rafId: number | null = null;

    const updateScrollState = () => {
      const { scrollLeft, scrollWidth, clientWidth } = wrapper;

      // スクロール可能かどうか判定
      const isScrollable = scrollWidth > clientWidth;

      if (!isScrollable) {
        wrapper.removeAttribute('data-scroll-fade');
        return;
      }

      // 端の判定（1px程度の誤差を許容）
      const isAtStart = scrollLeft <= 1;
      const isAtEnd = Math.abs(scrollWidth - clientWidth - scrollLeft) <= 1;

      if (isAtStart) {
        wrapper.setAttribute('data-scroll-fade', 'start');
      } else if (isAtEnd) {
        wrapper.setAttribute('data-scroll-fade', 'end');
      } else {
        wrapper.setAttribute('data-scroll-fade', 'middle');
      }
    };

    // 初期化とイベントリスナー設定
    updateScrollState();

    // 非表示→表示直後のレイアウト確定後にも再計測する
    rafId = window.requestAnimationFrame(updateScrollState);

    wrapper.addEventListener('scroll', updateScrollState);
    window.addEventListener('resize', updateScrollState);

    const resizeObserver = new ResizeObserver(() => {
      updateScrollState();
    });
    resizeObserver.observe(wrapper);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }

      wrapper.removeEventListener('scroll', updateScrollState);
      window.removeEventListener('resize', updateScrollState);
      resizeObserver.disconnect();
    };
  }, [
    performances,
    schedules,
    remainingSeatMap,
    selectedPerformanceId,
    selectedScheduleId,
  ]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      setErrorMessage(null);

      let perfQuery = supabase
        .from('class_performances')
        .select('id, class_name, total_capacity, junior_capacity')
        .order('id', { ascending: true });

      if (filterAccepting) {
        perfQuery = perfQuery.eq('is_accepting', true);
      }

      let schQuery = supabase
        .from('performances_schedule')
        .select('id, round_name')
        .order('id', { ascending: true });

      if (filterAccepting) {
        schQuery = schQuery.eq('is_active', true);
      }

      const [
        { data: performanceData, error: performanceError },
        { data: scheduleData, error: scheduleError },
      ] = await Promise.all([perfQuery, schQuery]);

      if (!isMounted) {
        return;
      }

      if (performanceError || scheduleError) {
        setErrorMessage('公演空き状況の取得に失敗しました。');
        setLoading(false);
        return;
      }

      const loadedPerformances = (
        (performanceData ?? []) as PerformanceRow[]
      ).filter(
        (performance) =>
          !restrictedClassName ||
          performance.class_name === restrictedClassName,
      );
      const loadedSchedules = (scheduleData ?? []) as PerformanceSchedule[];

      const performanceIds = loadedPerformances.map((p) => p.id);
      const scheduleIds = loadedSchedules.map((s) => s.id);

      const countersQuery =
        performanceIds.length > 0 && scheduleIds.length > 0
          ? supabase
              .from('class_ticket_counters')
              .select(
                'class_id, round_id, issued_general, issued_junior, issued_other',
              )
              .in('class_id', performanceIds)
              .in('round_id', scheduleIds)
          : Promise.resolve({ data: [], error: null });

      const [
        { data: counterData, error: counterError },
        { data: configData, error: configError },
      ] = await Promise.all([
        countersQuery,
        supabase
          .from('configs')
          .select('junior_release_open')
          .order('id', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      if ((counterError || configError) && isMounted) {
        setErrorMessage('残席情報の取得に失敗しました。');
        setLoading(false);
        return;
      }

      const isJuniorReleased = Boolean(configData?.junior_release_open);
      const counts = new Map<
        string,
        { general: number; junior: number; other: number }
      >();
      ((counterData as ClassTicketCounterRow[] | null) ?? []).forEach((row) => {
        const key = `${row.class_id}-${row.round_id}`;
        counts.set(key, {
          general: Number(row.issued_general ?? 0),
          junior: Number(row.issued_junior ?? 0),
          other: Number(row.issued_other ?? 0),
        });
      });

      const seatMap = new Map<string, number>();
      loadedSchedules.forEach((s) => {
        loadedPerformances.forEach((p) => {
          const key = `${p.id}-${s.id}`;
          const stat = counts.get(key) || {
            general: 0,
            junior: 0,
            other: 0,
          };

          const totalCap = p.total_capacity ?? 0;
          const juniorCap = p.junior_capacity ?? 0;
          const generalCap = Math.max(totalCap - juniorCap, 0);
          const totalIssued = stat.general + stat.junior + stat.other;
          const generalRemainingRaw =
            generalCap - stat.general - stat.other;

          let remaining = 0;
          if (currentRemainingMode === 'total') {
            remaining = totalCap - totalIssued;
          } else if (currentRemainingMode === 'junior') {
            remaining = isJuniorReleased
              ? totalCap - totalIssued
              : juniorCap -
                stat.junior -
                Math.max(-generalRemainingRaw, 0);
          } else {
            remaining = isJuniorReleased
              ? totalCap - totalIssued
              : generalRemainingRaw;
          }
          seatMap.set(key, Math.max(remaining, 0));
        });
      });

      if (!isMounted) {
        return;
      }

      setRemainingSeatMap(seatMap);
      setPerformances(loadedPerformances);
      setSchedules(loadedSchedules);
      setLoading(false);
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [currentRemainingMode, restrictedClassName, filterAccepting]);

  const statusByKey = useMemo(() => {
    const map = new Map<string, 'circle' | 'triangle' | 'cross'>();

    schedules.forEach((schedule) => {
      performances.forEach((performance) => {
        const key = `${performance.id}-${schedule.id}`;
        const remaining = Number(remainingSeatMap.get(key) ?? 0);
        const totalCapacity = Number(performance.total_capacity ?? 0);
        const juniorCapacity = Number(performance.junior_capacity ?? 0);
        const baseCapacity =
          currentRemainingMode === 'total'
            ? totalCapacity
            : currentRemainingMode === 'junior'
              ? juniorCapacity
              : Math.max(totalCapacity - juniorCapacity, 0);
        const lowStockThreshold = Math.max(1, Math.ceil(baseCapacity * 0.1));

        if (remaining <= 0) {
          map.set(key, 'cross');
          return;
        }

        if (baseCapacity > 0 && remaining <= lowStockThreshold) {
          map.set(key, 'triangle');
          return;
        }

        map.set(key, 'circle');
      });
    });

    return map;
  }, [performances, schedules, remainingSeatMap, currentRemainingMode]);

  const filteredPerformances = useMemo(
    () =>
      performances.filter(
        (performance) =>
          selectedPerformanceId === 'all' ||
          performance.id === selectedPerformanceId,
      ),
    [performances, selectedPerformanceId],
  );

  const filteredSchedules = useMemo(
    () =>
      schedules.filter(
        (schedule) =>
          selectedScheduleId === 'all' || schedule.id === selectedScheduleId,
      ),
    [schedules, selectedScheduleId],
  );

  useEffect(() => {
    if (!onAvailableCellClick || enableIssueJump) {
      return;
    }

    // if table data has not yet been loaded, don't modify selection
    if (filteredPerformances.length === 0 || filteredSchedules.length === 0) {
      return;
    }

    if (selectedCellKey) {
      const [selectedPerformanceIdFromKey, selectedScheduleIdFromKey] =
        selectedCellKey.split('-').map(Number);
      const isSelectedPerformanceInFilter = filteredPerformances.some(
        (performance) => performance.id === selectedPerformanceIdFromKey,
      );
      const isSelectedScheduleInFilter = filteredSchedules.some(
        (schedule) => schedule.id === selectedScheduleIdFromKey,
      );

      if (!isSelectedPerformanceInFilter || !isSelectedScheduleInFilter) {
        autoSelectedCellKeyRef.current = null;
        onAvailableCellClick(null);
      }

      return;
    }

    const selectableCells: AvailableSeatSelection[] = [];

    for (const schedule of filteredSchedules) {
      for (const performance of filteredPerformances) {
        const key = `${performance.id}-${schedule.id}`;
        const remaining = Number(remainingSeatMap.get(key) ?? 0);

        if (remaining <= 0) {
          continue;
        }

        selectableCells.push({
          performanceId: performance.id,
          performanceName: performance.class_name,
          scheduleId: schedule.id,
          scheduleName: schedule.round_name,
          remaining,
        });
      }
    }

    if (selectableCells.length !== 1) {
      autoSelectedCellKeyRef.current = null;
      return;
    }

    const selection = selectableCells[0];
    const key = `${selection.performanceId}-${selection.scheduleId}`;

    if (selectedCellKey === key || autoSelectedCellKeyRef.current === key) {
      return;
    }

    autoSelectedCellKeyRef.current = key;
    onAvailableCellClick(selection);
  }, [
    enableIssueJump,
    filteredPerformances,
    filteredSchedules,
    onAvailableCellClick,
    remainingSeatMap,
    selectedCellKey,
  ]);

  const getMark = (status: 'circle' | 'triangle' | 'cross') => {
    if (status === 'cross') {
      return <RiCloseLargeLine />;
    }
    if (status === 'triangle') {
      return <RiTriangleLine />;
    }
    return <RiCircleLine />;
  };

  const getStatusClass = (status: 'circle' | 'triangle' | 'cross') => {
    switch (status) {
      case 'circle':
        return styles.statusCircle;
      case 'triangle':
        return styles.statusTriangle;
      case 'cross':
        return styles.statusCross;
    }
  };

  const handleAvailableCellClick = (
    selection: AvailableSeatSelection,
  ): void => {
    onAvailableCellClick?.(selection);

    if (!enableIssueJump) {
      return;
    }

    const searchParams = new URLSearchParams({
      performanceId: String(selection.performanceId),
      scheduleId: String(selection.scheduleId),
    });

    route(`${issuePath}?${searchParams.toString()}`);
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (errorMessage) {
    return <p>{errorMessage}</p>;
  }

  if (performances.length === 0 || schedules.length === 0) {
    return <p>表示できる公演データがありません。</p>;
  }

  if (filteredPerformances.length === 0 || filteredSchedules.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.filters}>
          <label className={styles.filterLabel} htmlFor='class-filter'>
            クラス
            <select
              id='class-filter'
              className={styles.filterSelect}
              value={String(selectedPerformanceId)}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setSelectedPerformanceId(
                  value === 'all' ? 'all' : Number(value),
                );
              }}
            >
              <option value='all'>すべて</option>
              {performances.map((performance) => (
                <option key={performance.id} value={performance.id}>
                  {performance.class_name}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.filterLabel} htmlFor='schedule-filter'>
            公演回
            <select
              id='schedule-filter'
              className={styles.filterSelect}
              value={String(selectedScheduleId)}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setSelectedScheduleId(value === 'all' ? 'all' : Number(value));
              }}
            >
              <option value='all'>すべて</option>
              {schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {schedule.round_name}
                </option>
              ))}
            </select>
          </label>
          {showToggleRemainingMode && (
            <label
              className={styles.filterLabel}
              htmlFor='remaining-mode-toggle'
            >
              中学生の残席も表示する
              <select
                id='remaining-mode-toggle'
                className={styles.filterSelect}
                value={currentRemainingMode}
                onChange={(event) =>
                  setCurrentRemainingMode(
                    event.currentTarget.value === 'total' ? 'total' : 'general',
                  )
                }
              >
                <option value='general'>一般のみ</option>
                <option value='total'>一般＋ジュニア</option>
              </select>
            </label>
          )}
        </div>
        <p className={styles.emptyState}>該当するデータがありません。</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.filters}>
        <label className={styles.filterLabel} htmlFor='class-filter'>
          クラス
          <select
            id='class-filter'
            className={styles.filterSelect}
            value={String(selectedPerformanceId)}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSelectedPerformanceId(value === 'all' ? 'all' : Number(value));
            }}
          >
            <option value='all'>すべて</option>
            {performances.map((performance) => (
              <option key={performance.id} value={performance.id}>
                {performance.class_name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterLabel} htmlFor='schedule-filter'>
          公演回
          <select
            id='schedule-filter'
            className={styles.filterSelect}
            value={String(selectedScheduleId)}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSelectedScheduleId(value === 'all' ? 'all' : Number(value));
            }}
          >
            <option value='all'>すべて</option>
            {schedules.map((schedule) => (
              <option key={schedule.id} value={schedule.id}>
                {schedule.round_name}
              </option>
            ))}
          </select>
        </label>

        {showToggleRemainingMode && (
          <label className={styles.filterLabel} htmlFor='remaining-mode-toggle'>
            残席表示対象
            <select
              id='remaining-mode-toggle'
              className={styles.filterSelect}
              value={currentRemainingMode}
              onChange={(event) =>
                setCurrentRemainingMode(
                  event.currentTarget.value as 'general' | 'junior' | 'total',
                )
              }
            >
              <option value='general'>一般のみ</option>
              <option value='junior'>中学生のみ</option>
              <option value='total'>一般＋中学生</option>
            </select>
          </label>
        )}
      </div>
      <div className={styles.legend}>
        <span className={`${styles.legendItem} ${styles.statusCircle}`}>
          ○ 余裕あり
        </span>
        <span className={`${styles.legendItem} ${styles.statusTriangle}`}>
          △ 残り10%以下
        </span>
        <span className={`${styles.legendItem} ${styles.statusCross}`}>
          × 売り切れ
        </span>
      </div>
      <p className={styles.scrollHint}>← 横にスクロールできます →</p>
      <div className={styles.tableWrapper} ref={tableWrapperRef}>
        <table className={styles.table}>
          <thead>
            <tr className={styles.tr}>
              <th className={styles.th}>クラス</th>
              {filteredSchedules.map((schedule) => (
                <th className={styles.th} key={schedule.id}>
                  {schedule.round_name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredPerformances.map((performance) => (
              <tr key={performance.id} className={styles.tr}>
                <th className={styles.th}>{performance.class_name}</th>
                {filteredSchedules.map((schedule) => {
                  const key = `${performance.id}-${schedule.id}`;
                  const remaining = remainingSeatMap.get(key) ?? 0;
                  const status = statusByKey.get(key) ?? 'cross';
                  const canIssue = remaining > 0;
                  const isInteractive =
                    canIssue &&
                    (enableIssueJump || Boolean(onAvailableCellClick));
                  const isSelected = selectedCellKey === key;

                  return (
                    <td
                      className={`${styles.td} ${getStatusClass(status)} ${
                        isInteractive ? styles.jumpableCell : ''
                      } ${isInteractive ? styles.interactiveCell : ''} ${
                        isSelected ? styles.selectedCell : ''
                      }`}
                      key={`${performance.id}-${schedule.id}`}
                      onClick={() => {
                        if (!canIssue) {
                          return;
                        }

                        handleAvailableCellClick({
                          performanceId: performance.id,
                          performanceName: performance.class_name,
                          scheduleId: schedule.id,
                          scheduleName: schedule.round_name,
                          remaining,
                        });
                      }}
                      onKeyDown={(event) => {
                        if (!isInteractive) {
                          return;
                        }

                        if (event.key !== 'Enter' && event.key !== ' ') {
                          return;
                        }

                        event.preventDefault();
                        handleAvailableCellClick({
                          performanceId: performance.id,
                          performanceName: performance.class_name,
                          scheduleId: schedule.id,
                          scheduleName: schedule.round_name,
                          remaining,
                        });
                      }}
                      tabIndex={isInteractive ? 0 : undefined}
                      role={isInteractive ? 'button' : undefined}
                      aria-label={
                        isInteractive
                          ? `${performance.class_name} ${schedule.round_name} 残り${remaining}席`
                          : undefined
                      }
                    >
                      <div className={styles.mark}>{getMark(status)}</div>
                      <div className={styles.remaining}>残り{remaining}席</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default PerformancesTable;
