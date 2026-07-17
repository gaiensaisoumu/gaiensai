// Timetable.tsx
import styles from './TimeTableContent.module.css';
import baseStyles from '../../styles/sub-pages.module.css';

// ─── 1. 型定義 ───
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

interface TimetableProps {
  classSchedules: ClassSchedule[];
  gymPerformances: GymPerformance[];
}

// ─── 2. タイムスロット計算の定数 ───
const START_HOUR = 9; // 開始時間: 9:00
const END_HOUR = 16; // 終了時間: 16:00
const SLOT_MINUTES = 15; // 1マスの刻み: 15分
const HEADER_OFFSET = 1; // CSS Grid でヘッダーが使う1行分をずらす

// 時間からGridの行番号を計算するヘルパー関数
const getGridRowIndex = (dateTimeStr: string): number => {
  const date = new Date(dateTimeStr);
  const hours = date.getHours();
  const minutes = date.getMinutes();

  // 開始時間（9:00）からの経過分数を求める
  const elapsedMinutes = (hours - START_HOUR) * 60 + minutes;
  // 15分ごとのスロット数に変換
  const slotIndex = Math.floor(elapsedMinutes / SLOT_MINUTES);

  // 1（Gridは1始まり） + ヘッダー分 + スロット数
  return HEADER_OFFSET + 1 + slotIndex;
};

/**
 * YYYY-MM-DD 形式の文字列を M/D 形式に変換する関数
 * @param dateStr 例: "2025-08-30"
 * @returns 例: "8/30"
 */
export function formatToShortDate(dateStr: string): string {
  if (!dateStr) {
    return '';
  }

  // ハイフンで分割する -> ["2025", "08", "30"]
  const parts = dateStr.split('-');
  if (parts.length !== 3) {
    return dateStr;
  } // 不正なフォーマットの場合はそのまま返す

  // parseInt を通すことで、先頭の "0" を自動的に削除します ("08" -> 8)
  const month = parseInt(parts[1], 10);
  const day = parseInt(parts[2], 10);

  return `${month}/${day}`;
}

export default function TimeTableContent({
  classSchedules,
  gymPerformances,
}: TimetableProps) {
  // 学園祭の日付（仮に9/21を1日目、9/22を2日目とする）
  const uniqueDates = Array.from(
    new Set(classSchedules.map((item) => item.start_at.split('T')[0])),
  ).sort(); // 日付順に並び替え（昇順）

  // ─── 3. データのフィルタリング（選択中の一日分のみ抽出） ───
  const filterByDate = (dateStr: string) => (item: { start_at: string }) => {
    return (
      new Date(item.start_at)
        .toLocaleDateString('ja-JP', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        })
        .replace(/\//g, '-') === dateStr
    );
  };

  const day1ClassSchedules = classSchedules.filter(
    filterByDate(uniqueDates[0]),
  );
  const day2ClassSchedules = classSchedules.filter(
    filterByDate(uniqueDates[1]),
  );
  const day1GymPerformances = gymPerformances.filter(
    filterByDate(uniqueDates[0]),
  );
  const day2GymPerformances = gymPerformances.filter(
    filterByDate(uniqueDates[1]),
  );

  // ─── 4. 時間軸目盛りの作成 ───
  const timeScaleElements = [];
  const gridLines = [];
  const totalSlots = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES;

  for (let i = 0; i <= totalSlots; i++) {
    const elapsedMinutes = i * SLOT_MINUTES;
    const currentHour = START_HOUR + Math.floor(elapsedMinutes / 60);
    const currentMin = elapsedMinutes % 60;
    const gridRow = HEADER_OFFSET + 1 + i;

    // 1時間ごとに左側に数字ラベルを表示する
    if (currentMin === 0 && currentHour <= END_HOUR) {
      const displayTime = `${String(currentHour).padStart(2, '0')}:00`;
      timeScaleElements.push(
        <div
          key={`time-${currentHour}`}
          className={styles.timeScale}
          style={{ gridRow, gridColumn: 1, height: '40px' }} // 高さをある程度確保
        >
          {displayTime}
        </div>,
      );

      // 背景に敷く太い区切り線
      gridLines.push(
        <div
          key={`line-${i}`}
          className={styles.gridLineHour}
          style={{ gridRow, height: '1px' }}
        />,
      );
    } else {
      // 15分ごとの薄い点線
      gridLines.push(
        <div
          key={`line-${i}`}
          className={styles.gridLine}
          style={{ gridRow, height: '1px' }}
        />,
      );
    }
  }

  return (
    <div className={styles.container}>
      <h2 className={baseStyles.linedH2}>
        1日目 ({formatToShortDate(uniqueDates[0])})
      </h2>

      {/* 🗓 タイムテーブル本体 */}
      <div className={styles.timetableWrapper}>
        <div
          className={styles.timetable}
          style={{
            // 総スロット（28マス）+ ヘッダー分の高さを自動確保
            gridTemplateRows: `50px repeat(${totalSlots}, 40px)`,
          }}
        >
          {/* 列タイトルヘッダー */}
          <div
            className={styles.headerCell}
            style={{ gridRow: 1, gridColumn: 1 }}
          >
            時間
          </div>
          <div
            className={styles.headerCell}
            style={{ gridRow: 1, gridColumn: 2 }}
          >
            クラス公演
          </div>
          <div
            className={styles.headerCell}
            style={{ gridRow: 1, gridColumn: 3 }}
          >
            体育館公演
          </div>

          {/* 背景の区切り線 */}
          {gridLines}

          {/* 左側の時間軸ラベル */}
          {timeScaleElements}

          {/* 🏫 クラス公演カードの配置 */}
          {day1ClassSchedules.map((item) => {
            const startRow = getGridRowIndex(item.start_at);
            // クラス公演は一律45分間（15分×3スロット分）と仮定
            const endRow = startRow + 3;

            const formattedTime = new Date(item.start_at).toLocaleTimeString(
              'ja-JP',
              {
                hour: '2-digit',
                minute: '2-digit',
              },
            );

            return (
              <div
                key={`class-${item.id}`}
                className={`${styles.eventCard} ${styles.classEvent}`}
                style={{
                  gridColumn: 2, // クラス公演列
                  gridRow: `${startRow} / ${endRow}`, // 縦の引き伸ばし範囲
                }}
              >
                <div>
                  <div className={styles.eventTitle}>{item.round_name}</div>
                  <div className={styles.eventSubtitle}>各教室公演</div>
                </div>
                <div className={styles.eventTime}>{formattedTime} 〜</div>
              </div>
            );
          })}

          {/* 🎪 体育館公演カードの配置（こちらはデータベースの終了時間を正確に使用） */}
          {day1GymPerformances.map((item) => {
            const startRow = getGridRowIndex(item.start_at);
            const endRow = getGridRowIndex(item.end_at);

            const formattedStartTime = new Date(
              item.start_at,
            ).toLocaleTimeString('ja-JP', {
              hour: '2-digit',
              minute: '2-digit',
            });
            const formattedEndTime = new Date(item.end_at).toLocaleTimeString(
              'ja-JP',
              {
                hour: '2-digit',
                minute: '2-digit',
              },
            );

            return (
              <div
                key={`gym-${item.id}`}
                className={`${styles.eventCard} ${styles.gymEvent}`}
                style={{
                  gridColumn: 3, // 体育館公演列
                  gridRow: `${startRow} / ${endRow}`, // 縦の引き伸ばし範囲
                }}
              >
                <div>
                  <div className={styles.eventTitle}>{item.group_name}</div>
                  <div className={styles.eventSubtitle}>{item.round_name}</div>
                </div>
                <div className={styles.eventTime}>
                  {formattedStartTime} 〜 {formattedEndTime}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <h2 className={baseStyles.linedH2}>
        2日目 ({formatToShortDate(uniqueDates[1])})
      </h2>

      {/* 🗓 タイムテーブル本体 */}
      <div className={styles.timetableWrapper}>
        <div
          className={styles.timetable}
          style={{
            // 総スロット（28マス）+ ヘッダー分の高さを自動確保
            gridTemplateRows: `50px repeat(${totalSlots}, 40px)`,
          }}
        >
          {/* 列タイトルヘッダー */}
          <div
            className={styles.headerCell}
            style={{ gridRow: 1, gridColumn: 1 }}
          >
            時間
          </div>
          <div
            className={styles.headerCell}
            style={{ gridRow: 1, gridColumn: 2 }}
          >
            クラス公演
          </div>
          <div
            className={styles.headerCell}
            style={{ gridRow: 1, gridColumn: 3 }}
          >
            体育館公演
          </div>

          {/* 背景の区切り線 */}
          {gridLines}

          {/* 左側の時間軸ラベル */}
          {timeScaleElements}

          {/* 🏫 クラス公演カードの配置 */}
          {day2ClassSchedules.map((item) => {
            const startRow = getGridRowIndex(item.start_at);
            // クラス公演は一律45分間（15分×3スロット分）と仮定
            const endRow = startRow + 3;

            const formattedTime = new Date(item.start_at).toLocaleTimeString(
              'ja-JP',
              {
                hour: '2-digit',
                minute: '2-digit',
              },
            );

            return (
              <div
                key={`class-${item.id}`}
                className={`${styles.eventCard} ${styles.classEvent}`}
                style={{
                  gridColumn: 2, // クラス公演列
                  gridRow: `${startRow} / ${endRow}`, // 縦の引き伸ばし範囲
                }}
              >
                <div>
                  <div className={styles.eventTitle}>{item.round_name}</div>
                  <div className={styles.eventSubtitle}>各教室公演</div>
                </div>
                <div className={styles.eventTime}>{formattedTime} 〜</div>
              </div>
            );
          })}

          {/* 🎪 体育館公演カードの配置（こちらはデータベースの終了時間を正確に使用） */}
          {day2GymPerformances.map((item) => {
            const startRow = getGridRowIndex(item.start_at);
            const endRow = getGridRowIndex(item.end_at);

            const formattedStartTime = new Date(
              item.start_at,
            ).toLocaleTimeString('ja-JP', {
              hour: '2-digit',
              minute: '2-digit',
            });
            const formattedEndTime = new Date(item.end_at).toLocaleTimeString(
              'ja-JP',
              {
                hour: '2-digit',
                minute: '2-digit',
              },
            );

            return (
              <div
                key={`gym-${item.id}`}
                className={`${styles.eventCard} ${styles.gymEvent}`}
                style={{
                  gridColumn: 3, // 体育館公演列
                  gridRow: `${startRow} / ${endRow}`, // 縦の引き伸ばし範囲
                }}
              >
                <div>
                  <div className={styles.eventTitle}>{item.group_name}</div>
                  <div className={styles.eventSubtitle}>{item.round_name}</div>
                </div>
                <div className={styles.eventTime}>
                  {formattedStartTime} 〜 {formattedEndTime}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
