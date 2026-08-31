import { useCallback, useEffect, useRef, useState } from 'react';
import type { Difficulty, MazeData } from './game/types';
import { generateMaze } from './game/mazeGenerator';
import { DIFFICULTY_SIZES } from './constants/global';
import { MazeGame } from './components/Game';
// import { MazeGame } from './components/old/MazeGame';
import './App.css';

/** 进入场景时 loading 最短展示时长（ms），避免 spinner 一闪而过 */
const MIN_LOADING_MS = 700;


function App() {
  const [status, setStatus] = useState<'menu' | 'playing' | 'won'>('menu');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [maze, setMaze] = useState<MazeData | null>(null);
  const [result, setResult] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const loadingStartRef = useRef(0);

  // 场景就绪后收起 loading；保证至少显示 MIN_LOADING_MS，让 spinner 可见
  const handleSceneReady = useCallback(() => {
    const elapsed = Date.now() - loadingStartRef.current;
    const wait = Math.max(0, MIN_LOADING_MS - elapsed);
    window.setTimeout(() => setLoading(false), wait);
  }, []);

  const startGame = (diff: Difficulty = 'easy') => {
    const { w, h } = DIFFICULTY_SIZES[diff];
    setDifficulty(diff);
    setMaze(generateMaze(w, h));
    loadingStartRef.current = Date.now();
    setLoading(true);
    setStatus('playing');
    // 安全兜底：若场景未回调 onReady，也强制结束 loading
    window.setTimeout(() => setLoading(false), 4000);
  };

  const handleWin = (elapsed: number) => {
    setResult(elapsed);
    setStatus('won');

    // Update best record
    // setBestRecords((prev) => {
    //   const current = prev[difficulty];
    //   if (!current || elapsed < current.seconds) {
    //     return {
    //       ...prev,
    //       [difficulty]: { seconds: elapsed, date: new Date().toLocaleDateString('zh-CN') },
    //     };
    //   }
    //   return prev;
    // });
  };

  const backToMenu = () => {
    setStatus('menu');
    setMaze(null);
    setResult(null);
    setLoading(false);
  };

  // 直接进入游戏（调试 3D 场景时可打开）
  // useEffect(() => {
  //   startGame();
  // }, [])

  return (
    <div className="app">
      {status === 'menu' && (
        <MenuScreen
          onStart={startGame}
        />
      )}

      {status === 'playing' && maze && (
         <MazeGame
           maze={maze}
           onWin={handleWin}
           onReady={handleSceneReady}
         />
      )}

      {loading && <LoadingScreen />}

      {status === 'won' && result !== null && (
        <WinScreen
          elapsed={result}
          onPlayAgain={() => startGame(difficulty)}
          onMenu={backToMenu}
        />
      )}
    </div>
  );
}

// ===== Menu Screen（欢迎页）=====

const WELCOME_URL = `${import.meta.env.BASE_URL}/welcome.webp`;

const MENU_KEY_LABELS: Record<string, string> = {
  KeyW: 'W',
  KeyA: 'A',
  KeyS: 'S',
  KeyD: 'D',
  ArrowUp: '↑',
  ArrowLeft: '←',
  ArrowDown: '↓',
  ArrowRight: '→',
  KeyE: 'E',
};

function MenuScreen({
  onStart,
}: {
  onStart: (diff: Difficulty) => void;
}) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<HTMLDivElement>(null);
  const [difficulty] = useState<Difficulty>('easy');
  const [leaving, setLeaving] = useState(false);

  const stateRef = useRef({ difficulty, leaving });
  stateRef.current = { difficulty, leaving };

  // 金色漂浮粒子
  useEffect(() => {
    const wrap = particlesRef.current;
    if (!wrap) return;

    const count = window.innerWidth < 600 ? 18 : 28;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const p = document.createElement('span');
      const size = 2 + Math.random() * 4;
      p.className = 'menu-particle';
      p.style.left = `${Math.random() * 100}%`;
      p.style.width = `${size}px`;
      p.style.height = `${size}px`;
      p.style.animationDuration = `${8 + Math.random() * 10}s`;
      p.style.animationDelay = `${Math.random() * 10}s`;
      frag.appendChild(p);
    }
    wrap.appendChild(frag);

    return () => {
      wrap.textContent = '';
    };
  }, []);

  const launch = useCallback(() => {
    if (stateRef.current.leaving) return;
    stateRef.current.leaving = true;
    setLeaving(true);
    window.setTimeout(() => onStart(stateRef.current.difficulty), 430);
  }, [onStart]);

  // 真实按键 → 键位高亮；Space / Enter 进入
  useEffect(() => {
    const toggle = (code: string, on: boolean) => {
      const label = MENU_KEY_LABELS[code];
      if (!label) return;
      sceneRef.current?.querySelectorAll<HTMLElement>('.menu-key').forEach((el) => {
        if (el.dataset.key === label) el.classList.toggle('pressed', on);
      });
    };

    const onKeyDown = (e: KeyboardEvent) => {
      toggle(e.code, true);
      if (e.code === 'Space' || e.code === 'Enter') {
        // 焦点在按钮上时交给按钮自己处理
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        launch();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => toggle(e.code, false);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [launch]);

  return (
    <div
      ref={sceneRef}
      className={`menu-scene${leaving ? ' leaving' : ''}`}
      role="main"
      aria-label="迷宫探险启动界面"
    >
      {/* 背景：多巴胺渐变 + 彩色光斑 + welcome.webp 的模糊副本 */}
      <div className="menu-bg-gradient" aria-hidden="true" />
      {/* <div
        className="menu-bg-blur"
        style={{ backgroundImage: `url(${WELCOME_URL})` }}
        aria-hidden="true"
      /> */}
      <div className="menu-blobs" aria-hidden="true">
        <span className="menu-blob menu-blob--sky" />
        <span className="menu-blob menu-blob--coral" />
        <span className="menu-blob menu-blob--pink" />
      </div>
      <div className="menu-particles" ref={particlesRef} aria-hidden="true" />

      <h1 className="menu-title">欢迎来到我的迷宫</h1>

      <div className="menu-main">
        <aside className="menu-panel menu-panel-left" aria-label="移动快捷键">
          <div className="menu-panel-title">
            <span className="menu-panel-icon">✦</span>
            <span>移动</span>
          </div>
          <div className="menu-key-cluster menu-key-wasd" aria-label="WASD 方向键">
            {['W', 'A', 'S', 'D'].map((k) => (
              <div key={k} className="menu-key" data-key={k}>
                {k}
              </div>
            ))}
          </div>
          <div className="menu-panel-note">WASD 控制前后左右移动</div>
        </aside>

        <section className="menu-stage" aria-label="迷宫之门">
          <img
            className="menu-stage-img"
            src={WELCOME_URL}
            alt="欢迎来到我的迷宫"
          />
        </section>

        <aside className="menu-panel menu-panel-right" aria-label="视角与互动快捷键">
          <div className="menu-panel-title">
            <span className="menu-panel-icon">✦</span>
            <span>视角 / 互动</span>
          </div>
          <div className="menu-key-cluster menu-key-arrows" aria-label="方向键控制视角">
            {['↑', '←', '↓', '→'].map((k) => (
              <div key={k} className="menu-key" data-key={k}>
                {k}
              </div>
            ))}
          </div>
          <div className="menu-mouse-hint">
            <svg className="menu-mouse-icon" viewBox="0 0 28 40" aria-hidden="true">
              <rect
                x="2"
                y="2"
                width="24"
                height="36"
                rx="12"
                fill="none"
                stroke="#d4af37"
                strokeWidth="2"
              />
              <line
                x1="14"
                y1="8"
                x2="14"
                y2="16"
                stroke="#d4af37"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <circle cx="14" cy="6" r="2" fill="#d4af37" />
            </svg>
            <span>
              移动鼠标控制视角
              <br />
              点击画面锁定鼠标
            </span>
          </div>
          {/* <div className="menu-e-hint">
            <div className="menu-key pink" data-key="E">
              E
            </div>
            <span>打开信封</span>
          </div> */}
        </aside>
      </div>

      <div className="menu-enter-wrap">
        {/* <div className="menu-diff" role="group" aria-label="选择难度">
          {(Object.keys(DIFFICULTY_SIZES) as Difficulty[]).map((diff) => (
            <button
              key={diff}
              type="button"
              className={`menu-chip${diff === difficulty ? ' active' : ''}`}
              aria-pressed={diff === difficulty}
              onClick={() => setDifficulty(diff)}
            >
              {DIFFICULTY_LABELS[diff]}
            </button>
          ))}
        </div> */}

        <button type="button" className="menu-enter-btn" onClick={launch} aria-label="进入游戏">
          {leaving ? '进入中…' : '进入'}
        </button>

        {/* <p className="menu-enter-hint">
          按 Space 或 Enter 也可进入 · {record ? `最佳 ${formatTime(record.seconds)}` : '暂无记录'}
        </p> */}
      </div>
    </div>
  );
}

// ===== Loading Screen =====

function LoadingScreen() {
  return (
    <div className="loading-overlay" role="status" aria-live="polite">
      <div className="loading-card">
        <div className="loading-stars" aria-hidden="true">
          <span className="loading-star loading-star--left">✦</span>
          <span className="loading-star loading-star--right">✦</span>
        </div>
        {/* <h1 className="loading-title">加载中…</h1> */}
        <h1 className="loading-title">准备好了吗？</h1>
        <div className="loading-progress" aria-label="加载进度">
          <div className="loading-progress-track">
            <div className="loading-progress-fill" />
          </div>
        </div>
        {/* <p className="loading-subtitle">正在准备迷宫资源…</p> */}
      </div>
    </div>
  );
}

// ===== Win Screen =====

function WinScreen({
  elapsed,
  onPlayAgain,
  onMenu,
}: {
  elapsed: number;
  onPlayAgain: () => void;
  onMenu: () => void;
}) {
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  // const isNewRecord = bestRecord && bestRecord.seconds === elapsed;

  return (
    <div className="win-screen">
      <div className="win-content">
        <div className="win-icon">🏆</div>
        <h1>成功逃脱！</h1>
        <div className="win-stats">
          <div className="win-stat">
            <span className="win-stat-label">用时</span>
            <span className="win-stat-value">{formatTime(elapsed)}</span>
          </div>
          {/* <div className="win-stat">
            <span className="win-stat-label">难度</span>
            <span className="win-stat-value">{DIFFICULTY_LABELS[difficulty]}</span>
          </div>
          <div className="win-stat">
            <span className="win-stat-label">最佳</span>
            <span className="win-stat-value">
              {bestRecord ? formatTime(bestRecord.seconds) : '--:--'}
            </span>
          </div> */}
        </div>
        {/* {isNewRecord && <div className="win-new-record">✨ 新纪录！</div>} */}
        <div className="win-actions">
          <button className="win-btn primary" onClick={onPlayAgain}>
            再来一局
          </button>
          <button className="win-btn" onClick={onMenu}>
            返回菜单
          </button>
        </div>
      </div>
    </div>
  );
}

export default App;
