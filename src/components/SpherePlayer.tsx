import { Suspense, useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import type { GameRef, MazeData, PathDirection } from '../game/types';
import { canMove } from '../game/mazeGenerator';
import {
  PLAYER_RADIUS,
  MOVE_SPEED,
  TURN_SPEED,
  MOUSE_SENSITIVITY,
  RUN_SPEED_MULTIPLIER,
  WALK_ANIM_SPEED,
  RUN_ANIM_SPEED,
  ANIM_BLEND_RATE,
} from '../constants/player';
import { CELL_SCALE, USE_MOUSE } from '../constants/global';
import { updatePlayerPathCell, sceneState } from '../state/sceneStore';

// 防穿墙：每步最大位移 = 0.2 个单元格（世界单位）
const MAX_STEP = 0.2 * CELL_SCALE;
// 走到墙边时留一点 epsilon，防止贴墙抖动
const MOVE_EPSILON = 0.05;

const PLAYER_URL = `${import.meta.env.BASE_URL}/models/player.glb`;

// 模型本体高约 1.7，脚底在 y=0；Mixamo 模型默认面向 +Z，
// 而本游戏 forward(yaw=0) = -Z，故需要 π 的朝向补偿。
const MODEL_YAW_OFFSET = Math.PI;
// 目标高度 = 单元格的一半（CELL_SCALE / 2 = 0.5），模型高 1.7 → 缩放比
const MODEL_SCALE = 0.3 / 1.7;

/** 将路径方向 (t/r/b/l) 转换为相机 yaw 值
 *  forward = (-sin(yaw), -cos(yaw))
 *  r (+x) → yaw = -π/2
 *  l (-x) → yaw =  π/2
 *  t (-z) → yaw =  0
 *  b (+z) → yaw =  π
 */
function directionToYaw(dir?: PathDirection): number {
  switch (dir) {
    case 'r': return -Math.PI / 2;
    case 'l': return Math.PI / 2;
    case 't': return 0;
    case 'b': return Math.PI;
    default: return 0;
  }
}


interface PlayerProps {
  maze: MazeData;
  gameRef: React.MutableRefObject<GameRef>;
  onWin: () => void;
}

export function Player({ maze, gameRef, onWin }: PlayerProps) {
  const { camera, gl } = useThree();
  const keysRef = useRef<Set<string>>(new Set());
  // 初始 yaw：面向下一个道路单元格
  const initialYaw = directionToYaw(maze.solutionPath[0]?.dir);
  const yawRef = useRef(initialYaw);
  const pitchRef = useRef(0);
  const posRef = useRef({ x: (maze.startCol + 0.5) * CELL_SCALE, z: (maze.startRow + 0.5) * CELL_SCALE });
  const isLockedRef = useRef(false);
  const groupRef = useRef<THREE.Group>(null);
  const wonRef = useRef(false);
  // 动画当前 timeScale（平滑过渡用）
  const animSpeedRef = useRef(0);
  // 当前所处的光柱环 cellKey（边沿触发：只在"进入"瞬间打开弹窗）
  const inBeamRef = useRef<string | null>(null);
  // player.glb 懒加载：模型下载完成前 mixer 为空，先保证移动/碰撞逻辑可用
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  // Reset when maze changes
  useEffect(() => {
    posRef.current = { x: (maze.startCol + 0.5) * CELL_SCALE, z: (maze.startRow + 0.5) * CELL_SCALE };
    yawRef.current = directionToYaw(maze.solutionPath[0]?.dir);
    pitchRef.current = 0;
    wonRef.current = false;
    gameRef.current.visitedCells.clear();
    gameRef.current.visitedCells.add(`${maze.startCol},${maze.startRow}`);
  }, [maze, gameRef]);

  // Keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysRef.current.add(e.code);
      // Prevent page scroll on arrow keys / space
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysRef.current.delete(e.code);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Pointer lock & mouse look
  useEffect(() => {
    const canvas = gl.domElement;

    const handleClick = () => {
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock();
      }
    }

    const handleLockChange = () => {
      isLockedRef.current = document.pointerLockElement === canvas;
      gameRef.current.pointerLocked = isLockedRef.current;
    }

    const handleMouseMove = (e: MouseEvent) => {
      if (!isLockedRef.current) return;
      yawRef.current -= e.movementX * MOUSE_SENSITIVITY;
      pitchRef.current -= e.movementY * MOUSE_SENSITIVITY;
      // Clamp pitch
      const maxPitch = Math.PI / 2 - 0.05;
      pitchRef.current = Math.max(-maxPitch, Math.min(maxPitch, pitchRef.current));
    };

    if (USE_MOUSE) {
      canvas.addEventListener('click', handleClick);
      document.addEventListener('pointerlockchange', handleLockChange);
      document.addEventListener('mousemove', handleMouseMove);
    }

    return () => {
      canvas.removeEventListener('click', handleClick);
      document.removeEventListener('pointerlockchange', handleLockChange);
      document.removeEventListener('mousemove', handleMouseMove);
    };
  }, [gl, gameRef]);

  // Game loop
  useFrame((_, delta) => {
    if (wonRef.current) return;

    // Clamp delta to avoid large jumps
    const dt = Math.min(delta, 0.05);

    // --- Arrow key turning ---
    if (keysRef.current.has('ArrowLeft')) yawRef.current -= TURN_SPEED * dt;
    if (keysRef.current.has('ArrowRight')) yawRef.current += TURN_SPEED * dt;
    if (keysRef.current.has('ArrowUp')) pitchRef.current += TURN_SPEED * dt;
    if (keysRef.current.has('ArrowDown')) pitchRef.current -= TURN_SPEED * dt;
    const maxPitch = Math.PI / 2 - 0.05;
    pitchRef.current = Math.max(-maxPitch, Math.min(maxPitch, pitchRef.current));

    // --- WASD movement ---
    let dx = 0;
    let dz = 0;
    const forwardX = -Math.sin(yawRef.current);
    const forwardZ = -Math.cos(yawRef.current);
    const rightX = Math.cos(yawRef.current);
    const rightZ = -Math.sin(yawRef.current);

    if (keysRef.current.has('KeyW')) {
      dx += forwardX;
      dz += forwardZ;
    }
    if (keysRef.current.has('KeyS')) {
      dx -= forwardX;
      dz -= forwardZ;
    }
    if (keysRef.current.has('KeyA')) {
      dx -= rightX;
      dz -= rightZ;
    }
    if (keysRef.current.has('KeyD')) {
      dx += rightX;
      dz += rightZ;
    }

    // Normalize and apply speed
    const len = Math.sqrt(dx * dx + dz * dz);
    const isRunning =
      keysRef.current.has('ShiftLeft') || keysRef.current.has('ShiftRight');
    const isMoving = len > 0;
    if (isMoving) {
      const speed = MOVE_SPEED * (isRunning ? RUN_SPEED_MULTIPLIER : 1);
      dx = (dx / len) * speed * dt;
      dz = (dz / len) * speed * dt;

      // 把整帧位移拆成小步迭代（防高速跨格穿墙）。
      // 每轴分别推进，遇到墙就停在该轴（保留另一轴继续 → 实现滑墙）。
      const radius = PLAYER_RADIUS + MOVE_EPSILON + 0.05;

      // --- X 轴 ---
      const stepCountX = Math.ceil(Math.abs(dx) / MAX_STEP);
      const stepX = dx / stepCountX;
      for (let i = 0; i < stepCountX; i++) {
        const next = posRef.current.x + stepX;
        if (canMove(next, posRef.current.z, radius, maze)) {
          posRef.current.x = next;
        } else {
          break;
        }
      }

      // --- Z 轴 ---
      const stepCountZ = Math.ceil(Math.abs(dz) / MAX_STEP);
      const stepZ = dz / stepCountZ;
      for (let i = 0; i < stepCountZ; i++) {
        const next = posRef.current.z + stepZ;
        if (canMove(posRef.current.x, next, radius, maze)) {
          posRef.current.z = next;
        } else {
          break;
        }
      }
    }

    // --- Update player model & animation ---
    if (groupRef.current) {
      const px = posRef.current.x;
      const pz = posRef.current.z;
      groupRef.current.position.set(px, 0, pz); // 脚底贴地
      // 模型朝向跟随 yaw（+π 补偿 glTF 默认 +Z 朝向）
      groupRef.current.rotation.y = yawRef.current + MODEL_YAW_OFFSET;

      // 动画状态机：静止 0 / 走路 1.0 / 跑步 1.8（timeScale 平滑插值 → 自然过渡）
      const targetSpeed = !isMoving ? 0 : isRunning ? RUN_ANIM_SPEED : WALK_ANIM_SPEED;
      const blend = 1 - Math.exp(-ANIM_BLEND_RATE * dt);
      animSpeedRef.current = THREE.MathUtils.lerp(animSpeedRef.current, targetSpeed, blend);
      if (mixerRef.current) mixerRef.current.timeScale = animSpeedRef.current * 3;

      if (USE_MOUSE) {
        // 越肩视角：相机位于 player 后上方，视线越过 player 投向前方道路
        // behind = -forward；forward = (forwardX, forwardZ)
        // 高度按缩小后的模型（0.5 高）调整
        const camDist = 0.5;    // 身后距离
        const camHeight = 0.45; // 胸口高度
        camera.position.set(
          px - forwardX * camDist,
          camHeight,
          pz - forwardZ * camDist,
        );
        // 视线看向 player 前方的点 → player 落在画面下方偏中央
        // 鼠标上下（pitch）控制视线俯仰：正值抬头看更远处
        const lookAhead = 1.5;
        const lookHeight = pitchRef.current * 1.0;
        camera.lookAt(
          px + forwardX * lookAhead,
          lookHeight,
          pz + forwardZ * lookAhead,
        );
      }
    }


    // --- Update game ref (for minimap) ---
    gameRef.current.playerX = posRef.current.x;
    gameRef.current.playerZ = posRef.current.z;
    gameRef.current.playerYaw = yawRef.current;

    // Track visited cells for fog of war
    const cellCol = Math.floor(posRef.current.x / CELL_SCALE);
    const cellRow = Math.floor(posRef.current.z / CELL_SCALE);
    const cellKey = `${cellCol},${cellRow}`;
    if (!gameRef.current.visitedCells.has(cellKey)) {
      gameRef.current.visitedCells.add(cellKey);
    }

    // --- Win check ---
    if (cellCol === maze.exitCol && cellRow === maze.exitRow) {
      wonRef.current = true;
      onWin();
    }

    // --- 光柱环触发：进入环内自动打开描述（等效按 E 键），走出环自动关闭 ---
    {
      let insideBeamKey: string | null = null;
      for (const beam of sceneState.getBeams()) {
        const bx = posRef.current.x - beam.x;
        const bz = posRef.current.z - beam.z;
        if (bx * bx + bz * bz <= beam.radius * beam.radius) {
          insideBeamKey = beam.cellKey;
          break;
        }
      }
      const prevBeamKey = inBeamRef.current;
      if (prevBeamKey !== null && prevBeamKey !== insideBeamKey) {
        // 离开边沿：走出（或跨入相邻）环 → 若打开的正是该场景的弹窗则关闭
        const id = sceneState.getIdForCell(prevBeamKey);
        if (id && sceneState.openId === id) {
          sceneState.closeDescription();
        }
      }
      if (insideBeamKey !== null && prevBeamKey !== insideBeamKey && sceneState.openId === null) {
        // 进入边沿：刚进入这个环 且 弹窗未打开 → 自动打开
        const id = sceneState.getIdForCell(insideBeamKey);
        if (id) sceneState.openDescription(id);
      }
      inBeamRef.current = insideBeamKey;
    }

    // --- 更新玩家世界坐标到 store（LightBeam 发光检测用） ---
    sceneState.playerPos.x = posRef.current.x;
    sceneState.playerPos.z = posRef.current.z;

    // --- 更新场景道路格（用于气泡触发） ---
    updatePlayerPathCell(
      posRef.current.x,
      posRef.current.z,
      CELL_SCALE,
      (c, r) =>
        c >= 0 &&
        c < maze.width &&
        r >= 0 &&
        r < maze.height &&
        maze.cells[c][r].type === 'path',
    );
  });

  return (
    <group ref={groupRef} scale={MODEL_SCALE}>
      {/* player.glb 懒加载：下载完成前玩家已可正常移动 */}
      <Suspense fallback={null}>
        <PlayerModel groupRef={groupRef} mixerRef={mixerRef} />
      </Suspense>
    </group>
  );
}

/** 真正下载 + 挂载 player.glb 的内层组件（Suspense 内，加载不阻塞主逻辑） */
function PlayerModel({
  groupRef,
  mixerRef,
}: {
  groupRef: React.RefObject<THREE.Group | null>;
  mixerRef: React.MutableRefObject<THREE.AnimationMixer | null>;
}) {
  const { scene: playerModel, animations } = useGLTF(PLAYER_URL);
  const { actions, mixer } = useAnimations(animations, groupRef);

  useEffect(() => {
    mixerRef.current = mixer;
    return () => {
      mixerRef.current = null;
    };
  }, [mixer, mixerRef]);

  // 播放唯一的 walking_man clip（走路/跑步/静止靠 timeScale 区分）
  useEffect(() => {
    const clip = animations[0];
    const action = clip && actions[clip.name];
    if (!action) return;
    action.play();
    mixer.timeScale = 0; // 初始静止
  }, [actions, animations, mixer]);

  return <primitive object={playerModel} />;
}
