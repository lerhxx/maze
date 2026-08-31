import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameRef } from '../game/types';
import { Minimap } from './Minimap';
import { captureAndDownload } from '../utils/offscreenRender';
import { USE_MOUSE } from '../constants/global';

interface HUDProps {
  gameRef: React.MutableRefObject<GameRef>;
  isPlaying: boolean;
  startTime: number | null;
}

type CaptureStatus = 'idle' | 'working' | 'done' | 'error';

interface CaptureState {
  status: CaptureStatus;
  message: string;
  preview: string | null;
}

const MESSAGE_DURATION = 5000;

export function HUD({ gameRef, isPlaying, startTime }: HUDProps) {
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<number>(0);

  const [capture, setCapture] = useState<CaptureState>({
    status: 'idle',
    message: '',
    preview: null,
  });
  const messageTimerRef = useRef<number>(0);

  useEffect(() => {
    if (!isPlaying || startTime === null) return;

    const updateTimer = () => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
      timerRef.current = window.setTimeout(updateTimer, 1000);
    };
    updateTimer();

    return () => clearTimeout(timerRef.current);
  }, [isPlaying, startTime]);

  useEffect(() => () => clearTimeout(messageTimerRef.current), []);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const handleCapture = useCallback(async () => {
    if (capture.status === 'working') return;

    clearTimeout(messageTimerRef.current);
    setCapture((prev) => ({ ...prev, status: 'working', message: '正在离屏渲染…' }));

    // 让出一帧，先把「正在离屏渲染…」画到界面上，再做同步的重度渲染
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

    try {
      const result = await captureAndDownload();
      setCapture({
        status: 'done',
        message: `已保存 ${result.filename}（${result.width}×${result.height}）`,
        preview: result.dataUrl,
      });
    } catch (err) {
      setCapture((prev) => ({
        ...prev,
        status: 'error',
        message: err instanceof Error ? err.message : '绘制失败',
      }));
    } finally {
      clearTimeout(messageTimerRef.current);
      messageTimerRef.current = window.setTimeout(() => {
        setCapture((prev) => ({ ...prev, status: 'idle', message: '' }));
      }, MESSAGE_DURATION);
    }
  }, [capture.status]);

  const isRendering = capture.status === 'working';

  return (
    <div className="hud">
      {/* 绘制（离屏渲染导出图片） */}
      { !USE_MOUSE && <div className="hud-capture">
        <button
          className="capture-btn"
          onClick={handleCapture}
          disabled={isRendering}
          title="使用 WebGLRenderTarget 离屏渲染当前画面并保存为 PNG"
        >
          <span className="capture-btn-icon">{isRendering ? '⏳' : '🎨'}</span>
          {isRendering ? '绘制中…' : '绘制'}
        </button>

        {capture.message && (
          <div
            className={`capture-status${capture.status === 'error' ? ' error' : ''}`}
          >
            {capture.message}
          </div>
        )}

        {capture.preview && (
          <img className="capture-preview" src={capture.preview} alt="离屏渲染预览" />
        )}
      </div> }

      {/* Timer */}
      <div className="hud-timer">
        <span className="hud-timer-icon">⏱</span>
        <span className="hud-timer-value">{formatTime(elapsed)}</span>
      </div>

      {/* Minimap */}
      <Minimap gameRef={gameRef} />

      {/* Controls hint */}
      <div className="hud-controls">
        <div className="hud-controls-title">操作说明</div>
        <div className="hud-controls-grid">
          <span className="key">W A S D</span>
          <span>移动</span>
          <span className="key">鼠标</span>
          <span>视角（点击画面锁定）</span>
          <span className="key">← →</span>
          <span>转向</span>
          <span className="key">↑ ↓</span>
          <span>俯仰视角</span>
          <span className="key">Esc</span>
          <span>释放鼠标</span>
          {/* <span className="key">E</span>
          <span>打开信封</span> */}
        </div>
      </div>

      {/* Goal hint */}
      <div className="hud-goal">
        🎯 找到 <span className="hud-goal-exit">绿色传送门</span> 逃出迷宫
      </div>
    </div>
  );
}
