import NormalSection from '../../components/ui/NormalSection';
import PerformancesTable from '../../features/performances/PerformancesTable';
import GymPerformancesTable from '../../features/performances/GymPerformancesTable';
import type { SelectedPerformance } from '../../types/Issue.types';
import styles from '../../pages/user/students/Issue.module.css';
import dashboardStyles from '../../pages/user/students/Dashboard.module.css';

type IssueStepPerformanceProps = {
  isGymPerformanceTicket: boolean;
  selectedPerformance: SelectedPerformance;
  selectedCellKey?: string;
  classRemainingMode?: 'general' | 'total' | 'junior';
  restrictedClassName?: string | null;
  restrictedGroupNames?: string[] | null;
  classScheduleFilter?: (scheduleId: number, roundName: string) => boolean;
  gymScheduleFilter?: (scheduleId: number, roundName: string) => boolean;
  showClassPerformances?: boolean;
  showGymPerformances?: boolean;
  onSelectPerformance: (selection: SelectedPerformance) => void;
};

const IssueStepPerformance = ({
  isGymPerformanceTicket,
  selectedPerformance,
  selectedCellKey,
  classRemainingMode = 'general',
  restrictedClassName = null,
  restrictedGroupNames = null,
  classScheduleFilter,
  gymScheduleFilter,
  showClassPerformances = true,
  showGymPerformances = true,
  onSelectPerformance,
}: IssueStepPerformanceProps) => {
  return (
    <NormalSection>
      <h2 className={styles.sectionTitle}>2. 公演の選択</h2>
      <p>下の表から、発券したい公演を選択してください。</p>
      <a href='/performances' className={dashboardStyles.smallButtonLink}>
        公演の詳細はこちら
      </a>
      <a href='/timetable' className={dashboardStyles.smallButtonLink}>
        タイムテーブルはこちら
      </a>
      {isGymPerformanceTicket ? (
        showGymPerformances ? (
          <GymPerformancesTable
            onAvailableCellClick={onSelectPerformance}
            restrictedGroupNames={restrictedGroupNames}
            selectedCellKey={selectedCellKey}
            filterAccepting={true}
            scheduleFilter={gymScheduleFilter}
          />
        ) : (
          <p>この申込日時では体育館公演を選択できません。</p>
        )
      ) : showClassPerformances ? (
        <PerformancesTable
          remainingMode={classRemainingMode}
          restrictedClassName={restrictedClassName}
          onAvailableCellClick={onSelectPerformance}
          selectedCellKey={selectedCellKey}
          filterAccepting={true}
          scheduleFilter={classScheduleFilter}
        />
      ) : (
        <p>この申込日時ではクラス公演を選択できません。</p>
      )}
      {selectedPerformance && (
        <p className={styles.selectedText}>
          選択中: {selectedPerformance.performanceName} /{' '}
          {selectedPerformance.scheduleName}（残り
          {selectedPerformance.remaining}
          席）
        </p>
      )}
    </NormalSection>
  );
};

export default IssueStepPerformance;
