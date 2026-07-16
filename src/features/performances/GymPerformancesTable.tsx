import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { RiCircleLine, RiCloseLargeLine, RiTriangleLine } from 'react-icons/ri';
import { supabase } from '../../lib/supabase';
import styles from './PerformancesTable.module.css';
import { useLocation } from 'preact-iso';
import type { AvailableSeatSelection } from '../../types/types';
import LoadingSpinner from '../../components/ui/LoadingSpinner';

type GymPerformanceRow = {
  id: number;
  group_name: string;
  round_name: string;
  start_at: string;
  capacity: number;
};

const cellKeySeparator = '\u0000';

const toCellKey = (roundName: string, groupName: string) =>
  `${roundName}${cellKeySeparator}${groupName}`;

type GymPerformancesTableProps = {
  enableIssueJump?: boolean;
  issuePath?: string;
  onAvailableCellClick?: (selection: AvailableSeatSelection | null) => void;
  selectedCellKey?: string;
  restrictedGroupNames?: string[] | null;
  filterAccepting?: boolean;
  scheduleFilter?: (scheduleId: number, roundName: string) => boolean;
};

const GymPerformancesTable = ({
  enableIssueJump = false,
  issuePath = '/students/issue',
  onAvailableCellClick,
  selectedCellKey,
  restrictedGroupNames = null,
  filterAccepting = false,
  scheduleFilter,
}: GymPerformancesTableProps) => {
  const [performances, setPerformances] = useState<GymPerformanceRow[]>([]);
  const [selectedGroupName, setSelectedGroupName] = useState<string | 'all'>(
    'all',
  );
  const [selectedRoundName, setSelectedRoundName] = useState<string | 'all'>(
    'all',
  );
  const [remainingByPerformanceId, setRemainingByPerformanceId] = useState<
    Map<number, number>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { route } = useLocation();

  const tableWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setErrorMessage(null);

      let query = supabase
        .from('gym_performances')
        .select('id, group_name, round_name, start_at, capacity')
        .order('start_at', { ascending: true })
        .order('id', { ascending: true });

      if (filterAccepting) {
        query = query.eq('is_accepting', true);
      }

      const { data: performanceData, error: performanceError } = await query;

      if (performanceError) {
        setErrorMessage('体育館公演の取得に失敗しました。');
        setLoading(false);
        return;
      }

      const loadedPerformances = (
        (performanceData ?? []) as GymPerformanceRow[]
      ).filter(
        (performance) =>
          (!restrictedGroupNames ||
            restrictedGroupNames.includes(performance.group_name)) &&
          (!scheduleFilter || scheduleFilter(0, performance.round_name)),
      );
      setPerformances(loadedPerformances);

      if (loadedPerformances.length === 0) {
        setRemainingByPerformanceId(new Map());
        setLoading(false);
        return;
      }

      const performanceIds = loadedPerformances.map((p) => p.id);

      const { data: issuedTickets, error: ticketError } = await supabase
        .from('gym_tickets')
        .select('performance_id, tickets!inner(status, person_count)')
        .in('performance_id', performanceIds)
        .eq('tickets.status', 'valid');

      if (ticketError) {
        setErrorMessage('体育館公演の残席情報の取得に失敗しました。');
        setLoading(false);
        return;
      }

      const issuedCountByPerformanceId = new Map<number, number>();

      (
        (issuedTickets as unknown as Array<{
          performance_id: number;
          tickets: { person_count: number };
        }>) ?? []
      ).forEach((row) => {
        const pCount = row.tickets?.person_count ?? 1;
        issuedCountByPerformanceId.set(
          row.performance_id,
          (issuedCountByPerformanceId.get(row.performance_id) ?? 0) + pCount,
        );
      });

      const remainingMap = new Map<number, number>();
      for (const performance of loadedPerformances) {
        const issued = issuedCountByPerformanceId.get(performance.id) ?? 0;
        remainingMap.set(
          performance.id,
          Math.max(performance.capacity - issued, 0),
        );
      }

      setRemainingByPerformanceId(remainingMap);
      setLoading(false);
    };

    void load();
  }, [restrictedGroupNames, filterAccepting, scheduleFilter]);

  const groupNames = useMemo(() => {
    const unique = new Set<string>();
    for (const performance of performances) {
      unique.add(performance.group_name);
    }
    return [...unique];
  }, [performances]);

  const roundNames = useMemo(() => {
    const earliestByRound = new Map<string, number>();

    for (const performance of performances) {
      const startAt = new Date(performance.start_at).getTime();
      const current = earliestByRound.get(performance.round_name);
      if (current === undefined || startAt < current) {
        earliestByRound.set(performance.round_name, startAt);
      }
    }

    return [...earliestByRound.entries()]
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], 'ja'))
      .map(([roundName]) => roundName);
  }, [performances]);

  const cellData = useMemo(() => {
    const map = new Map<
      string,
      {
        remaining: number;
        capacity: number;
        performanceId: number;
        roundName: string;
        groupName: string;
      }
    >();

    for (const performance of performances) {
      const key = toCellKey(performance.round_name, performance.group_name);
      const previous = map.get(key) ?? {
        remaining: 0,
        capacity: 0,
        performanceId: performance.id,
        roundName: performance.round_name,
        groupName: performance.group_name,
      };
      const remaining =
        remainingByPerformanceId.get(performance.id) ?? performance.capacity;

      map.set(key, {
        remaining: previous.remaining + remaining,
        capacity: previous.capacity + performance.capacity,
        performanceId: previous.performanceId,
        roundName: previous.roundName,
        groupName: previous.groupName,
      });
    }

    return map;
  }, [performances, remainingByPerformanceId]);

  const filteredGroupNames = useMemo(
    () =>
      groupNames.filter(
        (groupName) =>
          selectedGroupName === 'all' || groupName === selectedGroupName,
      ),
    [groupNames, selectedGroupName],
  );

  const filteredRoundNames = useMemo(
    () =>
      roundNames.filter(
        (roundName) =>
          selectedRoundName === 'all' || roundName === selectedRoundName,
      ),
    [roundNames, selectedRoundName],
  );

  useEffect(() => {
    const wrapper = tableWrapperRef.current;
    if (!wrapper) {
      return;
    }

    let rafId: number | null = null;

    const updateScrollState = () => {
      const { scrollLeft, scrollWidth, clientWidth } = wrapper;
      const isScrollable = scrollWidth > clientWidth;

      if (!isScrollable) {
        wrapper.removeAttribute('data-scroll-fade');
        return;
      }

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

    updateScrollState();
    rafId = window.requestAnimationFrame(updateScrollState);

    wrapper.addEventListener('scroll', updateScrollState);
    window.addEventListener('resize', updateScrollState);

    const resizeObserver = new ResizeObserver(updateScrollState);
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
    filteredGroupNames,
    filteredRoundNames,
    performances,
    remainingByPerformanceId,
    selectedGroupName,
    selectedRoundName,
  ]);

  const getMark = (remaining: number, capacity: number) => {
    if (remaining <= 0) {
      return <RiCloseLargeLine />;
    }

    const lowStockThreshold = Math.max(1, Math.ceil(capacity * 0.1));
    if (capacity > 0 && remaining <= lowStockThreshold) {
      return <RiTriangleLine />;
    }

    return <RiCircleLine />;
  };

  const getStatusClass = (remaining: number, capacity: number) => {
    if (remaining <= 0) {
      return styles.statusCross;
    }

    const lowStockThreshold = Math.max(1, Math.ceil(capacity * 0.1));
    if (capacity > 0 && remaining <= lowStockThreshold) {
      return styles.statusTriangle;
    }

    return styles.statusCircle;
  };

  const handleAvailableCellClick = (
    selection: AvailableSeatSelection,
  ): void => {
    onAvailableCellClick?.(selection);

    if (!enableIssueJump) {
      return;
    }

    const searchParams = new URLSearchParams({
      venue: 'gym',
      performanceId: String(selection.performanceId),
    });

    route(`${issuePath}?${searchParams.toString()}`);
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  if (errorMessage) {
    return <p>{errorMessage}</p>;
  }

  if (
    performances.length === 0 ||
    groupNames.length === 0 ||
    roundNames.length === 0
  ) {
    return <p>表示できる体育館公演データがありません。</p>;
  }

  if (filteredGroupNames.length === 0 || filteredRoundNames.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.filters}>
          <label className={styles.filterLabel} htmlFor='gym-group-filter'>
            団体
            <select
              id='gym-group-filter'
              className={styles.filterSelect}
              value={selectedGroupName}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setSelectedGroupName(value === 'all' ? 'all' : value);
              }}
            >
              <option value='all'>すべて</option>
              {groupNames.map((groupName) => (
                <option key={groupName} value={groupName}>
                  {groupName}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.filterLabel} htmlFor='gym-round-filter'>
            公演回
            <select
              id='gym-round-filter'
              className={styles.filterSelect}
              value={selectedRoundName}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setSelectedRoundName(value === 'all' ? 'all' : value);
              }}
            >
              <option value='all'>すべて</option>
              {roundNames.map((roundName) => (
                <option key={roundName} value={roundName}>
                  {roundName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className={styles.emptyState}>該当するデータがありません。</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.filters}>
        <label className={styles.filterLabel} htmlFor='gym-group-filter'>
          団体
          <select
            id='gym-group-filter'
            className={styles.filterSelect}
            value={selectedGroupName}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSelectedGroupName(value === 'all' ? 'all' : value);
            }}
          >
            <option value='all'>すべて</option>
            {groupNames.map((groupName) => (
              <option key={groupName} value={groupName}>
                {groupName}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterLabel} htmlFor='gym-round-filter'>
          公演回
          <select
            id='gym-round-filter'
            className={styles.filterSelect}
            value={selectedRoundName}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setSelectedRoundName(value === 'all' ? 'all' : value);
            }}
          >
            <option value='all'>すべて</option>
            {roundNames.map((roundName) => (
              <option key={roundName} value={roundName}>
                {roundName}
              </option>
            ))}
          </select>
        </label>
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
              <th className={styles.th}>団体名</th>
              {filteredRoundNames.map((roundName) => (
                <th className={styles.th} key={roundName}>
                  {roundName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredGroupNames.map((groupName) => (
              <tr key={groupName} className={styles.tr}>
                <th className={styles.th}>{groupName}</th>
                {filteredRoundNames.map((roundName) => {
                  const key = toCellKey(roundName, groupName);
                  const cell = cellData.get(key);

                  if (!cell) {
                    return (
                      <td
                        key={key}
                        className={`${styles.td} ${styles.emptyCell}`}
                      >
                        -
                      </td>
                    );
                  }

                  const isInteractive =
                    cell.remaining > 0 &&
                    (enableIssueJump || Boolean(onAvailableCellClick));
                  const selectedKey = `${cell.performanceId}-0`;
                  const isSelected = selectedCellKey === selectedKey;

                  return (
                    <td
                      className={`${styles.td} ${getStatusClass(
                        cell.remaining,
                        cell.capacity,
                      )} ${isInteractive ? styles.jumpableCell : ''} ${
                        isInteractive ? styles.interactiveCell : ''
                      } ${isSelected ? styles.selectedCell : ''}`}
                      key={key}
                      onClick={() => {
                        if (cell.remaining <= 0) {
                          return;
                        }
                        handleAvailableCellClick({
                          performanceId: cell.performanceId,
                          performanceName: cell.groupName,
                          scheduleId: 0,
                          scheduleName: cell.roundName,
                          remaining: cell.remaining,
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
                          performanceId: cell.performanceId,
                          performanceName: cell.groupName,
                          scheduleId: 0,
                          scheduleName: cell.roundName,
                          remaining: cell.remaining,
                        });
                      }}
                      tabIndex={isInteractive ? 0 : undefined}
                      role={isInteractive ? 'button' : undefined}
                      aria-label={
                        isInteractive
                          ? `${cell.groupName} ${cell.roundName} 残り${cell.remaining}席`
                          : undefined
                      }
                    >
                      <div className={styles.mark}>
                        {getMark(cell.remaining, cell.capacity)}
                      </div>
                      <div className={styles.remaining}>
                        残り{cell.remaining}席
                      </div>
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

export default GymPerformancesTable;
