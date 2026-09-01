import { useCallback, useEffect, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { GameRef, MazeData } from '../game/types';
import { MazeEnvironment } from './Maze';
import { Player } from './SpherePlayer';
import { PlayerSakuraPetals } from './SakuraPetals';
import { HUD } from './HUD';
import { Description } from './Description';
import { AMBIENT_INTENSITY, AMBIENT_COLOR } from '../constants/light';
import { CELL_SCALE, WARM_LIGHT_BG } from '../constants/global';
import { OrbitControls } from '@react-three/drei';
import { Perf } from 'r3f-perf';
import { sceneState, useSceneState, type DescriptionId } from '../state/sceneStore';
import { setRendererContext } from '../utils/offscreenRender';
import { USE_MOUSE } from '../constants/global';

interface MazeGameProps {
  maze: MazeData;
  onWin: (elapsedSeconds: number) => void;
  onReady?: () => void;
}

export function MazeGame({ maze, onWin, onReady }: MazeGameProps) {
  const [startTime, setStartTime] = useState<number | null>(null);
  const [won, setWon] = useState(false);
  const startRef = useRef<number>(0);

  const gameRef = useRef<GameRef>({
    playerX: (maze.startCol + 0.5) * CELL_SCALE,
    playerZ: (maze.startRow + 0.5) * CELL_SCALE,
    playerYaw: 0,
    visitedCells: new Set([`${maze.startCol},${maze.startRow}`]),
    maze,
    pointerLocked: false,
  });

  // 订阅全局场景 state：触发重新渲染弹窗/E 键处理
  useSceneState();

  // Start timer on mount
  useEffect(() => {
    startRef.current = Date.now();
    setStartTime(startRef.current);
  }, []);

  const handleWin = useCallback(() => {
    if (won) return;
    setWon(true);
    const elapsed = Math.floor((Date.now() - startRef.current) / 1000);
    // Exit pointer lock so user can click buttons
    if (document.pointerLockElement) {
      document.exitPointerLock();
    }
    onWin(elapsed);
  }, [won, onWin]);

  // E 键全局处理：
  //  - 弹窗已打开 → 关闭（弹窗内的 E 监听也会生效）
  //  - 弹窗未打开 + 玩家在某个场景道路格上（activeSceneId） → 打开对应描述
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'e') return;
      // 忽略 input / textarea 的 e
      const tgt = e.target as HTMLElement | null;
      if (tgt && /^(INPUT|TEXTAREA)$/.test(tgt.tagName)) return;

      if (sceneState.openId) {
        sceneState.closeDescription();
      } else if (sceneState.activeSceneId) {
        sceneState.openDescription(sceneState.activeSceneId as DescriptionId);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const openId = sceneState.openId as DescriptionId | null;

  return (
    <div className="game-container">
      <Canvas
        camera={{
          fov: 75,
          near: 0.1,
          far: 50,
          // 初始位置：起点后上方（首帧会被跟随相机覆盖）
          position: [
            (maze.startCol + 0.5) * CELL_SCALE,
            1.7,
            (maze.startRow + 0.5) * CELL_SCALE + 1.8,
          ],
        }}
        className="game-canvas"
        onCreated={() => onReady?.()}
      >
        <Perf position="top-left" />
        { !USE_MOUSE && <OrbitControls />}
        <SceneContent maze={maze} gameRef={gameRef} onWin={handleWin} />
      </Canvas>

      <HUD gameRef={gameRef} isPlaying={!won} startTime={startTime} />
    
      {/* Click-to-lock hint */}
      {/* <ClickToPlayHint gameRef={gameRef} /> */}

      {openId && (
        <Description
          id={openId}
          onClose={() => sceneState.closeDescription()}
        />
      )}
    </div>
  );
}

function SceneContent({
  maze,
  gameRef,
  onWin,
}: {
  maze: MazeData;
  gameRef: React.MutableRefObject<GameRef>;
  onWin: () => void;
}) {
  const { scene, gl, camera } = useThree();

  // Set fog and background color
  // useEffect(() => {
  //   scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
  //   gl.setClearColor(FOG_COLOR);
  // }, [gl, scene]);

  useEffect(() => {
    scene.background = new THREE.Color(WARM_LIGHT_BG);
    // 清屏色也设成暖光色：Canvas 首帧 / 场景挂载完成前不会先闪一下黑屏
    gl.setClearColor(WARM_LIGHT_BG);
  }, [scene, gl])

  // 把渲染上下文暴露给 HUD 的「绘制」按钮，用于离屏渲染导出图片
  useEffect(() => {
    setRendererContext({ gl, scene, camera });
    return () => setRendererContext(null);
  }, [gl, scene, camera]);

  return (
    <>
      <ambientLight intensity={AMBIENT_INTENSITY} color={AMBIENT_COLOR} position={[10, 10, 10]} />
      <MazeEnvironment maze={maze} />
      <Player maze={maze} gameRef={gameRef} onWin={onWin} />
      {/* 玩家前方不定时飘落的樱花花瓣 */}
      <PlayerSakuraPetals />
    </>
  );
}
