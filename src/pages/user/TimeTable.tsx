import { useState, useEffect } from 'preact/hooks';
import { useTitle } from '../../hooks/useTitle';
import { supabase } from '../../lib/supabase';
import styles from '../../styles/sub-pages.module.css';
import TimeTableContent from '../../components/ui/TimeTableContent';

// スケジュールデータの型（提示されたテーブル構造に準拠）
interface ClassSchedule {
  id: number;
  round_name: string;
  start_at: string;
}

interface GymPerformance {
  id: number;
  group_name: string;
  round_name: string;
  start_at: string;
  end_at: string;
}

const TimeTable = () => {
  useTitle('タイムテーブル');
  const [classSchedules, setClassSchedules] = useState<ClassSchedule[]>([]);
  const [gymPerformances, setGymPerformances] = useState<GymPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);

        // 1. クラス公演スケジュールの取得
        const { data: classData, error: classError } = await supabase
          .from('performances_schedule')
          .select('id, round_name, start_at')
          .eq('is_active', true);

        if (classError) {
          throw classError;
        }

        // 2. 体育館公演スケジュールの取得
        const { data: gymData, error: gymError } = await supabase
          .from('gym_performances')
          .select('id, group_name, round_name, start_at, end_at');

        if (gymError) {
          throw gymError;
        }

        setClassSchedules(classData || []);
        setGymPerformances(gymData || []);
      } catch (err) {
        setError('スケジュールデータの読み込みに失敗しました。');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  if (loading) {
    return (
      <div
        style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}
      >
        <p>タイムテーブルを読み込み中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ color: '#dc2626', textAlign: 'center', padding: '4rem' }}>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <>
      <h1 className={styles.pageTitle}>タイムテーブル</h1>
        {/* ─── タイムテーブルの呼び出し ─── */}
        <TimeTableContent
          classSchedules={classSchedules}
          gymPerformances={gymPerformances}
        />
    </>
  );
};

export default TimeTable;
