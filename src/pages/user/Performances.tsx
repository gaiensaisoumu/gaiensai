import { useEffect, useState } from 'preact/hooks';
import { useTitle } from '../../hooks/useTitle';
import { supabase, getPerformanceImageUrl } from '../../lib/supabase';
import baseStyles from '../../styles/sub-pages.module.css';
import styles from './Performances.module.css';
import NormalSection from '../../components/ui/NormalSection';

interface ClassPerformance {
  id: number; // smallint
  year: number | null; // smallint
  class_name: string | null; // text
  title: string | null; // text
  description: string | null; // text
  created_at: string; // timestamptz
  junior_capacity: number | null; // smallint
  total_capacity: number | null; // smallint
  is_accepting: boolean | null; // boolean
  image_path: string | null;
}

interface GymPerformance {
  id: number;
  group_name: string;
  round_name: string;
  start_at: string; // timestamptz
  end_at: string; // timestamptz
  capacity: number;
  year: number;
  is_accepting: boolean | null;
  description: string | null;
  image_path: string | null;
}

async function getClassPerformances(): Promise<ClassPerformance[]> {
  const { data, error } = await supabase
    .from('class_performances')
    .select('*')
    .order('id', { ascending: true }); // ID順

  if (error) {
    alert('公演データの取得に失敗しました:' + error.message);
    throw new Error(error.message);
  }

  return data || [];
}

async function getGymPerformances(): Promise<GymPerformance[]> {
  // PostgreSQLの "DISTINCT ON (group_name)" をシミュレートするために
  // raw SQLのようなフィルタを指定します。
  const { data, error } = await supabase
    .from('gym_performances')
    .select('*')
    // group_nameで重複を排除するため、一番若いIDのものを取得するソートをかけます
    .order('group_name')
    .order('id', { ascending: true });

  if (error) {
    alert('体育館データの取得に失敗しました:' + error.message);
    throw new Error(error.message);
  }

  if (!data) {
    return [];
  }

  // 【重複除去ロジック】
  // group_nameごとに最初に出現した要素（IDが最も小さいもの）だけを配列に残します
  const uniqueGroupPerformances: GymPerformance[] = [];
  const seenGroups = new Set<string>();

  for (const item of data) {
    if (!seenGroups.has(item.group_name)) {
      seenGroups.add(item.group_name);
      uniqueGroupPerformances.push(item);
    }
  }

  // 最後に表示したい順序（例：開始時間順）にソートし直して返却
  return uniqueGroupPerformances.sort(
    (a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime(),
  );
}

const Performances = () => {
  useTitle('公演一覧');
  const [classData, setClassData] = useState<ClassPerformance[]>([]);
  const [gymData, setGymData] = useState<GymPerformance[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAllPerformances() {
      try {
        setLoading(true);
        const [classes, gyms] = await Promise.all([
          getClassPerformances(),
          getGymPerformances(),
        ]);
        setClassData(classes);
        setGymData(gyms);
      } catch (err) {
        setError('データの読み込みに失敗しました。');
      } finally {
        setLoading(false);
      }
    }
    loadAllPerformances();
  }, []);

  if (loading) {
    return <div className={styles.stateMessage}>データを読み込み中...</div>;
  }
  if (error) {
    return (
      <div className={`${styles.stateMessage} ${styles.errorMessage}`}>
        {error}
      </div>
    );
  }
  return (
    <>
      <h1 className={baseStyles.pageTitle}>公演一覧</h1>
      <section>
        <h2 className={baseStyles.linedH2}>クラス公演</h2>
        <div className={styles.grid}>
          {classData.length === 0 ? (
            <div className={styles.stateMessage}>
              公開中のクラス公演はありません。
            </div>
          ) : (
            classData.map((perf) => (
              <NormalSection key={perf.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  {perf.image_path && (
                    <>
                      {/* 背景画像（すべて表示） */}
                      <img
                        src={getPerformanceImageUrl(perf.image_path)}
                        alt={perf.title || '公演画像'}
                        className={styles.cardBgImage}
                        loading='lazy'
                      />
                      {/* グラデーション暗幕 */}
                      <div className={styles.overlay} />
                    </>
                  )}
                  {/* 前面のテキスト情報 */}
                  <div
                    className={`${styles.headerContent} ${!perf.image_path ? styles.noImage : ''}`}
                  >
                    <div className={styles.headerMetaData}>
                      <div>
                        <div className={styles.meta}>
                          <span className={styles.yearBadge}>
                            {perf.year}年度
                          </span>
                          <span className={styles.className}>
                            {perf.class_name}
                          </span>
                        </div>
                      </div>
                      <div>
                        <span
                          className={`${styles.statusBadge} ${perf.is_accepting ? styles.statusAccepting : styles.statusClosed}`}
                        >
                          {perf.is_accepting ? '受付中' : '受付終了'}
                        </span>
                      </div>
                    </div>
                    <h3 className={styles.cardTitle}>
                      {perf.title || '無題の公演'}
                    </h3>
                  </div>
                </div>

                {/* ─── 2. 画像が一切かぶらない「ボディエリア」（白背景） ─── */}
                <div className={styles.cardBody}>
                  {/* 体育館公演などの場合はここに timeBox を配置できます */}
                  {/* {perf.start_at && <div className={styles.timeBox}>...</div>} */}

                  <p className={styles.description}>
                    {perf.description || '説明はありません。'}
                  </p>

                  <div className={styles.footer}>
                    <div>
                      全体定員:{' '}
                      <span className={styles.capacityValue}>
                        {perf.total_capacity ?? 0}名
                      </span>
                    </div>
                    <div>
                      中学生枠:{' '}
                      <span className={styles.capacityValue}>
                        {perf.junior_capacity ?? 0}名
                      </span>
                    </div>
                  </div>
                </div>
              </NormalSection>
            ))
          )}
        </div>
      </section>
      <section>
        <h2 className={baseStyles.linedH2}>体育館公演</h2>
        <div className={styles.grid}>
          {gymData.length === 0 ? (
            <div className={styles.stateMessage}>
              公開中の体育館公演はありません。
            </div>
          ) : (
            gymData.map((perf) => (
              <NormalSection key={perf.id} className={styles.card}>
                {/* 📸 体育館用：背景画像を敷くヘッダーエリア（画像の高さで可変） */}
                <div className={styles.cardHeader}>
                  {perf.image_path && (
                    <>
                      {/* 背景画像（すべて表示） */}
                      <img
                        src={getPerformanceImageUrl(perf.image_path)}
                        alt={perf.group_name || '公演画像'}
                        className={styles.cardBgImage}
                        loading='lazy'
                      />
                      {/* グラデーション暗幕 */}
                      <div className={styles.overlay} />
                    </>
                  )}
                  {/* 画像のボトムに固定される文字コンテンツ */}
                  <div
                    className={`${styles.headerContent} ${!perf.image_path ? styles.noImage : ''}`}
                  >
                    <div className={styles.headerMetaData}>
                      <div>
                        <div className={styles.meta}>
                          <span className={styles.yearBadge}>
                            {perf.year}年度
                          </span>
                        </div>
                      </div>
                      <div>
                        <span
                          className={`${styles.statusBadge} ${perf.is_accepting ? styles.statusAccepting : styles.statusClosed}`}
                        >
                          {perf.is_accepting ? '受付中' : '受付終了'}
                        </span>
                      </div>
                    </div>
                    <h3 className={styles.cardTitle}>{perf.group_name}</h3>
                  </div>
                </div>

                {/* 📄 体育館用：画像がかぶらない白背景エリア（高さ自動調整） */}
                <div className={styles.cardBody}>
                  <p className={styles.description}>
                    {perf.description || '公演説明はありません。'}
                  </p>

                  <div className={styles.footer}>
                    <div>
                      定員:{' '}
                      <span className={styles.capacityValue}>
                        {perf.capacity}名
                      </span>
                    </div>
                  </div>
                </div>
              </NormalSection>
            ))
          )}
        </div>
      </section>
    </>
  );
};

export default Performances;
