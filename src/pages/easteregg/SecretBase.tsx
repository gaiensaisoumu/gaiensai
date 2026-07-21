import { useState, useEffect, useRef } from 'preact/hooks';
import { useTitle } from '../../hooks/useTitle';
import styles from '../../styles/sub-pages.module.css';
import Alert from '../../components/ui/Alert';
import { useLocation } from 'preact-iso';
import { MiniGame } from '../../routes';

// ターミナルに流すクレジットテキスト（ここを好きに書き換えてね！）
const CREDIT_LOGS = [
  'INITIALIZING SYSTEM ARCHITECT AREA...',
  'BYPASSING FIREWALL... [====================] 100%',
  'ACCESS GRANTED: DEVELOPER CREDIT LOG',
  '------------------------------------------------',
  '[PROJECT ROLES & ASSIGNMENTS]',
  '  - Project Manager (PM)   : Rio Gunawan',
  '  - System Architect       : Rio Gunawan, Gemini',
  '  - Lead Frontend Dev      : Rio Gunawan, Copilot, Codex, Gemini',
  '  - Backend & DB Engineer  : Rio Gunawan, Gemini, Codex, Copilot',
  '  - DevOps & Infra         : Rio Gunawan',
  '  - UI/UX Designer         : Rio Gunawan',
  '  - Game Designer          : Rio Gunawan, Gemini',
  '  - QA & Load Tester (k6)  : Rio Gunawan, Gemini',
  '  - Emergency Hotfix Team  : Rio Gunawan',
  ' ',
  '[SPECIAL RESPONSIBILITIES]',
  '  - Chief Bug Generator    : Rio Gunawan, Copilot, Gemini, Codex',
  '  - Bug Eliminator         : Codex, Gemini, Copilot, Rio Gunawan',
  '  - Legacy Doc Skipper     : Rio Gunawan (Making future juniors cry)',
  '  - Solo Code Reviewer     : Rio Gunawan',
  '  - Coffee-to-Code Runner  : Rio Gunawan',
  ' ',
  '[ORGANIZATION CHART]',
  '  Our Teachers',
  '   └─ Gaiensai Festival General Affairs Committee',
  '      └─ Rio Gunawan (CEO/CTO/Lead Developer)',
  '         └─ Rio Gunawan (Sub-Developer)',
  '             └─ Rio Gunawan (Intern / Coffee Fetcher)',
  ' ',
  '[LEAD DEVELOPER]',
  '  Name: Rio Gunawan (Aoym 79th)',
  '  Role: Full-Stack Developer & Lead Designer',
  '  Favorite: React / TypeScript / Python',
  ' ',
  '[GAIENSAI FESTIVAL GENERAL AFFAIRS COMMITTEE]',
  '  Name: M.H. / H.K. / R.I. / A.O. / Y.M. / S.N. / K.T.',
  '  Role: Numbered Ticket Staff (One is a mini programmer)',
  '',
  '[TOKYO METROPOLITAN AOYAMA HIGH SCHOOL TEACHERS]',
  '  Name: anonymous',
  '  Role: Adviser, (Complainer)',
  '',
  '[SPECIAL THANKS]',
  '  - Gemini',
  '  - Codex / ChatGPT',
  '  - GitHub Copilot',
  '  - Devin',
  '  - ESLint / TypeScript (Complainer)',
  '  - S.N. (A True Friend)',
  ' ',
  '[DEVELOPMENT STATS]',
  '  - Development Period    : ~1 Year (365 Days)',
  '  - Total Program Lines   : 47,345 lines',
  '  - Exam Score Sacrificed : -100 pts total',
  '  - Sleeping Hours Lost   : Unknown',
  "  - Bug-to-Feature Ratio  : It's not a bug, it's a feature",
  '  - Backup Strategy       : Praying to God',
  "  - Current Status        : Ready for launch (Please don't crash on prod)",
  '------------------------------------------------',
];

const PUZZLE_HINT = [
  ' ',
  '=== SECRET PUZZLE ============================== ',
  '  Sequence : 2, 3, -1, 8, -8, [ A ], -19, 30',
  ' ',
  '  [ B ] : Find the hidden single-digit number in the log:',
  '  System initialized and running smoothly.',
  '  Environment variables loaded properly.',
  '  Verifying user access permissions...',
  '  Executing core security protocols.',
  '  No unauthorized intrusions detected.',
  ' ',
  '  Passcode : [ A ][ B ]',
  '================================================',
  ' ',
];

const SECRET_GAME_URL = '/gunawan/?mode=arcade';

const SecretBase = () => {
  useTitle('開発者の秘密基地');
  const [lines, setLines] = useState<string[]>([]);
  const [isTypingComplete, setIsTypingComplete] = useState(false);
  const [input, setInput] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { query } = useLocation();

  useEffect(() => {
    const linkId = 'hack-font-cdn';
    if (!document.getElementById(linkId)) {
      const link = document.createElement('link');
      link.id = linkId;
      link.rel = 'stylesheet';
      link.href =
        'https://cdnjs.cloudflare.com/ajax/libs/hack-font/3.3.0/web/hack.min.css';
      document.head.appendChild(link);
    }
  }, []);

  useEffect(() => {
    let currentLine = 0;
    const interval = setInterval(() => {
      if (currentLine < CREDIT_LOGS.length) {
        setLines((prev) => [...prev, CREDIT_LOGS[currentLine]]);
        currentLine++;
      } else {
        clearInterval(interval);
        setIsTypingComplete(true);
      }
    }, 150);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isTypingComplete && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isTypingComplete]);

  if (query.mode === 'arcade') {
    return <MiniGame />;
  }

  const handleCommandSubmit = (e: Event) => {
    e.preventDefault();
    const cmd = input.trim().normalize('NFKC'); // 全角を半角に変換
    if (!cmd) {
      return;
    }

    const newLines = [...lines, `> ${cmd}`];
    const cmdLower = cmd.toLowerCase();

    if (cmdLower === 'help' || cmdLower === 'puzzle') {
      newLines.push(...PUZZLE_HINT);
    } else if (cmdLower === '177') {
      newLines.push(
        '------------------------------------------------',
        ' [ACCESS GRANTED] SECRET SYSTEM UNLOCKED!',
        ` LAUNCHING MINI-GAME...`,
        '------------------------------------------------',
      );
      setIsUnlocked(true);
      setTimeout(() => {
        window.open(SECRET_GAME_URL, '_blank');
      }, 2000);
    } else {
      newLines.push(
        ` Command not recognized: '${cmd}'.`,
        ` Type 'puzzle' to show the secret challenge, or enter passcode.`,
      );
    }

    setLines(newLines);
    setInput('');
  };

  return (
    <>
      <h1 className={styles.pageTitle}>開発者の秘密基地</h1>

      <Alert type='info'>
        開発者の秘密基地へようこそ。ここは一般ユーザー立ち入り禁止です。バグを見つけても見逃してくれる心優しい方のみお進みください。
      </Alert>

      <section>
        <div style={terminalContainerStyle}>
          <div style={terminalHeaderStyle}>
            <span style={{ color: '#ff5f56' }}>●</span>{' '}
            <span style={{ color: '#ffbd2e' }}>●</span>{' '}
            <span style={{ color: '#27c93f' }}>●</span>{' '}
            <span style={{ marginLeft: '10px', color: '#888' }}>
              bash - credits.sh
            </span>
          </div>

          <div style={terminalContentStyle}>
            {lines.map((line, index) => (
              <p key={index} style={lineStyle}>
                {line.startsWith('[') || line.startsWith('===') ? (
                  <span style={{ color: '#00ffff' }}>{line}</span>
                ) : line.startsWith('> ') ? (
                  <span style={{ color: '#ffbd2e' }}>{line}</span>
                ) : (
                  line
                )}
              </p>
            ))}

            {isTypingComplete && !isUnlocked && (
              <form onSubmit={handleCommandSubmit} style={formStyle}>
                <label
                  htmlFor='cmd-input'
                  style={{ color: '#00ff33', marginRight: '8px' }}
                >
                  STATUS: IDLE. WAITING FOR DEEP COMMAND&gt;
                </label>
                <input
                  id='cmd-input'
                  ref={inputRef}
                  type='text'
                  value={input}
                  onInput={(e) =>
                    setInput((e.target as HTMLInputElement).value)
                  }
                  style={terminalInputStyle}
                  placeholder="Type 'puzzle' or passcode..."
                  autoComplete='off'
                />
              </form>
            )}

            {!isTypingComplete && (
              <span className='blink-cursor' style={cursorStyle}>
                _
              </span>
            )}
          </div>
        </div>

        <style>{`
          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0; }
          }
          .blink-cursor {
            animation: blink 1s infinite;
          }
        `}</style>
      </section>
    </>
  );
};

const terminalContainerStyle = {
  backgroundColor: '#0c0c0c',
  borderRadius: '8px',
  border: '1px solid #333',
  padding: '16px',
  boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
  margin: '20px 0',
};

const terminalHeaderStyle = {
  borderBottom: '1px solid #222',
  paddingBottom: '8px',
  marginBottom: '16px',
  fontSize: '12px',
  fontFamily: 'monospace',
};

const terminalContentStyle = {
  fontFamily: 'Hack, HackGen, "Cascadia Code", Consolas, Monaco, monospace',
  color: '#00ff33',
  fontSize: '12px',
  lineHeight: '1.6',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  WebkitOverflowScrolling: 'touch',
};

const lineStyle = {
  margin: '2px 0',
  minHeight: '1.2em',
};

const cursorStyle = {
  color: '#00ff33',
  fontWeight: 'bold',
};

const formStyle = {
  display: 'flex',
  flexWrap: 'wrap' as const,
  alignItems: 'center',
  marginTop: '8px',
};

const terminalInputStyle = {
  backgroundColor: 'transparent',
  border: 'none',
  borderBottom: '1px solid #00ff33',
  color: '#00ff33',
  fontFamily: 'Hack, HackGen, "Cascadia Code", Consolas, Monaco, monospace',
  fontSize: '12px',
  outline: 'none',
  flex: 1,
  minWidth: '150px',
};

export default SecretBase;
