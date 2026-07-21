import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import styles from '../../styles/sub-pages.module.css';
import { useTitle } from '../../hooks/useTitle';
import { supabase } from '../../lib/supabase';
import NormalSection from '../../components/ui/NormalSection';

type LeaderboardItem = {
  id: string;
  player_name: string;
  score: number;
};

type Pipe = {
  id: number;
  x: number;
  gapY: number;
};

const LIMIT_COUNT = 10;
const INITIAL_DISTANCE = 350; // 土管同士の間隔
const PIPE_COUNT = 4; // 画面内に存在させる土管の数
const GAME_SIZE = 600; // 内部の論理キャンバスサイズ（固定）

const getLevelThreshold = (lvl: number) => {
  const thresholds = [10, 8, 6, 5, 4, 3];
  return lvl < thresholds.length ? thresholds[lvl] : 3;
};

const calculateLevel = (currentScore: number) => {
  let lvl = 0;
  let scoreLeft = currentScore;
  while (scoreLeft >= getLevelThreshold(lvl)) {
    scoreLeft -= getLevelThreshold(lvl);
    lvl++;
  }
  return lvl;
};

// 初期配置用の生成関数（600px基準）
const generateInitialPipes = (): Pipe[] => {
  return Array.from({ length: PIPE_COUNT }).map((_, i) => ({
    id: i,
    x: GAME_SIZE + i * INITIAL_DISTANCE,
    gapY: Math.floor(Math.random() * 200) + 80,
  }));
};

export const MiniGame = () => {
  useTitle('ミニゲーム');
  const [gameState, setGameState] = useState<'start' | 'playing' | 'gameover'>(
    'start',
  );
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);

  // 画面サイズに応じたスケール比率
  const [scaleRatio, setScaleRatio] = useState(1);

  // 土管管理（初期状態は3本）
  const pipesRef = useRef<Pipe[]>(generateInitialPipes());
  const [renderPipes, setRenderPipes] = useState<Pipe[]>(
    generateInitialPipes(),
  );

  const [playerName, setPlayerName] = useState('');
  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [renderPos, setRenderPos] = useState({ birdY: 250, velocity: 0 });
  const birdYRef = useRef(250);
  const velocityRef = useRef(0);
  const animationFrameIdRef = useRef<number | null>(null);

  const BASE_GRAVITY = 0.5;
  const BASE_JUMP = -8.5;
  const INITIAL_PIPE_SPEED = 3.5;
  const INITIAL_GAP_SIZE = 150;

  const level = calculateLevel(score);
  const pipeSpeed = Math.min(INITIAL_PIPE_SPEED + level * 0.6, 8.5);
  const gapSize = Math.max(INITIAL_GAP_SIZE - level * 8, 85);

  const pipeSpeedRef = useRef(pipeSpeed);
  const gapSizeRef = useRef(gapSize);

  useEffect(() => {
    pipeSpeedRef.current = pipeSpeed;
    gapSizeRef.current = gapSize;
  }, [pipeSpeed, gapSize]);

  // ウィンドウリサイズ時のスケール計算
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const updateScale = () => {
      const minSide = Math.min(
        window.innerWidth * 0.9,
        window.innerHeight * 0.8,
        GAME_SIZE,
      );
      setScaleRatio(minSide / GAME_SIZE);
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

  const fetchLeaderboard = async () => {
    const { data, error } = await supabase
      .from('flappy_leaderboard')
      .select('id, player_name, score')
      .order('score', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(LIMIT_COUNT);
    if (!error && data) {
      setLeaderboard(data);
    }
  };

  useEffect(() => {
    fetchLeaderboard();
  }, []);

  const handleSubmitScore = async (e: Event) => {
    e.preventDefault();
    if (!playerName.trim() || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    const { error } = await supabase
      .from('flappy_leaderboard')
      .insert([{ player_name: playerName.trim().slice(0, 10), score }]);
    setIsSubmitting(false);
    if (!error) {
      setIsSubmitted(true);
      fetchLeaderboard();
    }
  };

  const resetGame = useCallback(() => {
    birdYRef.current = 200;
    velocityRef.current = BASE_JUMP;
    pipesRef.current = generateInitialPipes();
    setRenderPipes(pipesRef.current);
    setRenderPos({ birdY: 200, velocity: BASE_JUMP });
    setScore(0);
    setIsSubmitted(false);
    setGameState('playing');
  }, [BASE_JUMP]);

  const handleContainerClick = () => {
    if (gameState === 'playing') {
      velocityRef.current = BASE_JUMP;
    }
  };

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (gameState === 'playing') {
          velocityRef.current = BASE_JUMP;
        } else if (gameState === 'start') {
          resetGame();
        }
      }
    },
    [gameState, resetGame],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (gameState !== 'playing') {
      return;
    }

    const updateGame = () => {
      velocityRef.current += BASE_GRAVITY;
      birdYRef.current += velocityRef.current;

      const currentDistance = Math.max(INITIAL_DISTANCE - level * 30, 180);

      const nextPipes = pipesRef.current.map((pipe) => {
        let newX = pipe.x - pipeSpeedRef.current;
        let newGapY = pipe.gapY;

        if (newX < -60) {
          const maxRightX = Math.max(...pipesRef.current.map((p) => p.x));
          newX = maxRightX + currentDistance;

          // 固定サイズ（600px）基準での高さ計算
          const playableHeight = GAME_SIZE - gapSizeRef.current - 100;
          newGapY = Math.floor(Math.random() * playableHeight) + 50;

          setScore((prev) => {
            const newScore = prev + 1;
            setHighScore((hs) => Math.max(hs, newScore));
            return newScore;
          });
        }
        return { ...pipe, x: newX, gapY: newGapY };
      });

      pipesRef.current = nextPipes;
      setRenderPipes(nextPipes);

      const birdRight = 112;
      const birdLeft = 80;
      const birdTop = birdYRef.current;
      const birdBottom = birdYRef.current + 32;

      // 地面も600px基準で固定
      const groundY = GAME_SIZE - 24;

      if (birdTop <= 0 || birdBottom >= groundY) {
        setGameState('gameover');
        fetchLeaderboard();
        return;
      }

      for (const pipe of nextPipes) {
        if (pipe.x < birdRight && pipe.x + 60 > birdLeft) {
          if (
            birdTop < pipe.gapY ||
            birdBottom > pipe.gapY + gapSizeRef.current
          ) {
            setGameState('gameover');
            fetchLeaderboard();
            return;
          }
        }
      }

      setRenderPos({ birdY: birdYRef.current, velocity: velocityRef.current });
      animationFrameIdRef.current = requestAnimationFrame(updateGame);
    };

    animationFrameIdRef.current = requestAnimationFrame(updateGame);
    return () => {
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current);
      }
    };
  }, [gameState, level, gapSizeRef]);

  return (
    <>
      <h1 className={styles.pageTitle}>ミニゲーム</h1>
      <div
        onClick={handleContainerClick}
        style={{
          position: 'relative',
          width: 'min(90vw, 80vh, 600px)',
          height: 'min(90vw, 80vh, 600px)',
          aspectRatio: '1 / 1',
          margin: '20px auto',
          backgroundColor: '#70c5ce',
          borderRadius: '12px',
          overflow: 'hidden',
          boxShadow: '0 8px 20px rgba(0,0,0,0.3)',
          userSelect: 'none',
          fontFamily: 'monospace',
        }}
      >
        {/* === ゲーム描画レイヤー === */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${GAME_SIZE}px`,
            height: `${GAME_SIZE}px`,
            transform: `scale(${scaleRatio})`,
            transformOrigin: 'top left',
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: '80px',
              top: `${renderPos.birdY}px`,
              fontSize: '32px',
              lineHeight: '1',
              transform: `rotate(${Math.min(Math.max(renderPos.velocity * 3.5, -30), 70)}deg)`,
              transition: 'transform 0.1s ease',
            }}
          >
            🐣
          </div>

          {renderPipes.map((pipe) => (
            <div key={pipe.id}>
              <div
                style={{
                  position: 'absolute',
                  left: `${pipe.x}px`,
                  top: '0px',
                  width: '60px',
                  height: `${pipe.gapY}px`,
                  backgroundColor: '#73bf2e',
                  border: '3px solid #538021',
                  borderTop: 'none',
                  boxSizing: 'border-box',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: `${pipe.x}px`,
                  top: `${pipe.gapY + gapSize}px`,
                  width: '60px',
                  bottom: '24px',
                  backgroundColor: '#73bf2e',
                  border: '3px solid #538021',
                  borderBottom: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          ))}

          <div
            style={{
              position: 'absolute',
              bottom: '0',
              width: '100%',
              height: '24px',
              backgroundColor: '#ded895',
              borderTop: '4px solid #73bf2e',
            }}
          />
        </div>

        {/* === スコア表示レイヤー === */}
        <div
          style={{
            position: 'absolute',
            top: '16px',
            left: '0',
            right: '0',
            textAlign: 'center',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2px',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              fontSize: '32px',
              fontWeight: 'bold',
              color: '#fff',
              textShadow: '2px 2px #000',
              lineHeight: '1',
            }}
          >
            {score}
          </span>
          {gameState === 'playing' && level > 0 && (
            <span
              style={{
                fontSize: '12px',
                fontWeight: 'bold',
                color: '#ffe600',
                textShadow: '1px 1px #000',
                backgroundColor: 'rgba(0,0,0,0.4)',
                padding: '2px 8px',
                borderRadius: '10px',
              }}
            >
              Level Up! Lv.{level + 1}
            </span>
          )}
        </div>

        {/* === UIレイヤー（START / GAME OVER） === */}
        {gameState !== 'playing' && (
          <div
            style={{
              position: 'absolute',
              inset: '0',
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              zIndex: 20,
              overflowY: 'auto', // オーバーレイ全体をスクロール可能に変更
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: '100%', // 画面高に満たない場合は中央揃え
                padding: '20px',
                boxSizing: 'border-box',
                color: '#fff',
              }}
            >
              {gameState === 'start' ? (
                <>
                  <h2
                    style={{
                      margin: '0 0 10px 0',
                      fontSize: '28px',
                      textAlign: 'center',
                    }}
                  >
                    FLAPPY GAIENSAI
                  </h2>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      resetGame();
                    }}
                    style={{
                      padding: '10px 24px',
                      backgroundColor: '#73bf2e',
                      border: 'none',
                      color: '#fff',
                      fontWeight: 'bold',
                      borderRadius: '20px',
                      cursor: 'pointer',
                    }}
                  >
                    START
                  </button>
                </>
              ) : (
                <>
                  <h2
                    style={{
                      margin: '0 0 4px 0',
                      color: '#ff5555',
                      fontSize: '26px',
                    }}
                  >
                    GAME OVER
                  </h2>
                  <p style={{ margin: '0 0 12px 0', fontSize: '18px' }}>
                    SCORE: {score} (BEST: {highScore})
                  </p>
                  {!isSubmitted ? (
                    <form
                      onSubmit={handleSubmitScore}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        display: 'flex',
                        gap: '6px',
                        marginBottom: '16px',
                      }}
                    >
                      <input
                        type='text'
                        placeholder='名前 (10文字以内)'
                        value={playerName}
                        onInput={(e) =>
                          setPlayerName((e.target as HTMLInputElement).value)
                        }
                        maxLength={10}
                        style={{
                          padding: '6px 10px',
                          borderRadius: '6px',
                          border: '1px solid #444',
                          backgroundColor: '#222',
                          color: '#fff',
                          fontSize: '13px',
                        }}
                      />
                      <button
                        type='submit'
                        disabled={isSubmitting || !playerName.trim()}
                        style={{
                          padding: '6px 12px',
                          backgroundColor: '#3182ce',
                          border: 'none',
                          color: '#fff',
                          fontWeight: 'bold',
                          borderRadius: '6px',
                          cursor: 'pointer',
                          fontSize: '13px',
                        }}
                      >
                        登録
                      </button>
                    </form>
                  ) : (
                    <p
                      style={{
                        color: '#48bb78',
                        fontSize: '13px',
                        margin: '0 0 16px 0',
                      }}
                    >
                      登録しました！
                    </p>
                  )}
                  <div
                    style={{
                      width: '100%',
                      maxWidth: '260px',
                      backgroundColor: 'rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      padding: '10px 14px',
                      marginBottom: '16px',
                      fontSize: '13px',
                      maxHeight: '150px', // ランキングが長すぎる場合は内部スクロール
                      overflowY: 'auto',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 'bold',
                        color: '#ffe600',
                        marginBottom: '6px',
                        borderBottom: '1px solid rgba(255,255,255,0.2)',
                        paddingBottom: '4px',
                      }}
                    >
                      🏆 TOP {LIMIT_COUNT} LEADERBOARD
                    </div>
                    {leaderboard.length === 0 ? (
                      <div style={{ color: '#aaa' }}>データなし</div>
                    ) : (
                      leaderboard.map((item, idx) => (
                        <div
                          key={item.id}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            margin: '3px 0',
                          }}
                        >
                          <span>
                            {idx + 1}. {item.player_name}
                          </span>
                          <span style={{ fontWeight: 'bold' }}>
                            {item.score} pt
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      resetGame();
                    }}
                    style={{
                      padding: '10px 24px',
                      backgroundColor: '#27c93f',
                      border: 'none',
                      color: '#fff',
                      fontSize: '14px',
                      fontWeight: 'bold',
                      borderRadius: '20px',
                      cursor: 'pointer',
                    }}
                  >
                    🔄 もう一度
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      <div style={{ margin: '20px auto', maxWidth: '600px' }}>
        <NormalSection>
          <h2>遊び方</h2>
          <p>
            画面をタップして、ひよこが緑の土管や地面、画面の端に当たらないように操作しよう!
          </p>
        </NormalSection>
        <NormalSection>
          <h2>🏆 リーダーボード</h2>
          {leaderboard.length === 0 ? (
            <div style={{ color: '#aaa' }}>データなし</div>
          ) : (
            leaderboard.map((item, idx) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  maxWidth: '300px',
                  margin: '5px auto',
                }}
              >
                <span>
                  {idx + 1}. {item.player_name}
                </span>
                <span style={{ fontWeight: 'bold' }}>{item.score} pt</span>
              </div>
            ))
          )}
        </NormalSection>
      </div>
    </>
  );
};

export default MiniGame;
