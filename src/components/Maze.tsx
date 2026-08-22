import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MazeData } from '../game/types';
import { WALL_HEIGHT } from '../constants/wall';
import { EXIT_COLOR } from '../constants/flag';
import { CELL_SCALE } from '../constants/global';
import { GrassCells } from './GrassCells';
import {
  InteriorTreesCells,
  PerimeterSakuraCells,
  isPerimeterWall,
  type InteriorWallCell,
} from './Wall';
import { Shopee } from './Shopee';
import { Kilox } from './Kilox';

// 上(r-1)、右(c+1)、下(r+1)、左(c-1)
const ADJACENT_DIRS: Array<[number, number]> = [
  [0, -1], // 上
  [1, 0],  // 右
  [0, 1],  // 下
  [-1, 0], // 左
];

/**
 * 计算模型绕 Y 轴的旋转角度，使其正面朝向 pathCell。
 * 假设模型默认正面朝 +Z。
 * Three.js rotation.y 正值从 +Z 转向 +X（俯视逆时针），
 * 方向向量 (dc, dr) → XZ 平面角度 = atan2(dc, dr)。
 */
function calcFrontRotationY(
  cell: { c: number; r: number },
  pathCell: { c: number; r: number },
): number {
  const dc = pathCell.c - cell.c;
  const dr = pathCell.r - cell.r;
  return Math.atan2(dc, dr);
}

// ===== Content 生成函数：根据 solutionPath 位置查找附近墙格，返回 content 映射 =====

/** 一个 content 放置点定义 */
interface ContentPlacement {
  /** 在 solutionPath 上的位置比例 [0, 1] */
  pathFraction: number;
  /** 找到墙格后生成 content；返回值会直接作为该格的 content */
  generateContent: (cell: { c: number; r: number }, pathCell: { c: number; r: number }) => ReactNode;
}

/**
 * 查找 solutionPath 指定位置附近的首个墙格（按上右下左顺序），返回 content 映射。
 *
 * @param maze 迷宫数据
 * @param placements 多个放置点定义
 * @returns Map<"c-r", ReactNode> — 墙格坐标 → content
 */
function findContentCells(
  maze: MazeData,
  placements: ContentPlacement[],
): Map<string, ReactNode> {
  const result = new Map<string, ReactNode>();
  const path = maze.solutionPath;
  if (!path || path.length < 4) return result;
  const w = maze.width;
  const h = maze.height;
  for (const placement of placements) {
    const idx = Math.floor(path.length * placement.pathFraction);
    const [pc, pr] = path[Math.min(idx, path.length - 1)];
    for (const [dc, dr] of ADJACENT_DIRS) {
      const nc = pc + dc;
      const nr = pr + dr;
      if (nc < 0 || nc >= w || nr < 0 || nr >= h) continue;
      if (maze.cells[nc][nr].type !== 'wall') continue;
      // 跳过外围墙：外围墙不在 interiorWallCells 里，content 匹配不上
      if (isPerimeterWall(nc, nr, w, h)) continue;
      const key = `${nc}-${nr}`;
      if (!result.has(key)) {
        result.set(key, placement.generateContent({ c: nc, r: nr }, { c: pc, r: pr }));
      }
      break;
    }
  }
  return result;
}

interface MazeEnvironmentProps {
  maze: MazeData;
}

export function MazeEnvironment({ maze }: MazeEnvironmentProps) {
  const { width: w, height: h } = maze;

  // 墙格分两类：
  //   perimeterSakuraCells → 迷宫四边（c=0/w-1 或 r=0/h-1）→ 樱花树贴边围绕
  //   interiorWallCells    → 所有内部墙（去重每格一条）→ 每格放多棵 GreenTree 针叶松
  //   grassCells           → 所有 wall cells（外围 + 内部并集）→ 每格底部平铺 grass.glb
  const { perimeterSakuraCells, interiorWallCells, grassCells } = useMemo(() => {
    const sak: Array<{ c: number; r: number }> = [];
    const int: InteriorWallCell[] = [];
    const grass: Array<{ c: number; r: number }> = [];
    const seenInt = new Set<string>();
    for (let c = 0; c < w; c++) {
      for (let r = 0; r < h; r++) {
        if (maze.cells[c][r].type !== 'wall') continue;
        grass.push({ c, r });
        if (isPerimeterWall(c, r, w, h)) {
          sak.push({ c, r });
          continue;
        }
        const key = `${c}-${r}`;
        if (seenInt.has(key)) continue;
        seenInt.add(key);
        int.push({ c, r });
      }
    }
    return { perimeterSakuraCells: sak, interiorWallCells: int, grassCells: grass };
  }, [maze, w, h]);

  // 用 findContentCells 查找多个 content 放置点（便于扩展）
  const contentMap = useMemo(() => {
    return findContentCells(maze, [
      {
        pathFraction: 0.25,
        generateContent: (_cell, pathCell) => {
          const rotationY = calcFrontRotationY(_cell, pathCell);
          return <Kilox position={[0, 0, 0]} size={CELL_SCALE * 0.75} rotationY={rotationY} />;
        },
      },
      {
        pathFraction: 0.5,
        generateContent: (_cell, pathCell) => {
          const rotationY = calcFrontRotationY(_cell, pathCell);
          return <Shopee position={[0, 0, 0]} size={CELL_SCALE} rotationY={rotationY} />;
        },
      },
    ]);
  }, [maze]);

  // 给 interiorWallCells 中对应的格子加上 content
  const interiorWithContent = useMemo<InteriorWallCell[]>(() => {
    if (contentMap.size === 0) return interiorWallCells;
    return interiorWallCells.map((cell) => {
      const key = `${cell.c}-${cell.r}`;
      const content = contentMap.get(key);
      if (content) return { ...cell, content };
      return cell;
    });
  }, [interiorWallCells, contentMap]);

  return (
    <group>
      {/* Floor */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(w / 2) * CELL_SCALE, 0, (h / 2) * CELL_SCALE]}
      >
        <planeGeometry args={[w * CELL_SCALE, h * CELL_SCALE]} />
        <meshStandardMaterial color="#D29E76" />
      </mesh>

      {/* 所有墙格底部：grass.glb 贴地平铺（1 格一个） */}
      <GrassCells cells={grassCells} />

      {/* 内部墙 → 有 content 的格渲染 content（如 shopee），无 content 的渲染针叶松 */}
      <InteriorTreesCells cells={interiorWithContent} />

      {/* 迷宫四边：樱花树贴边围绕（每格 1 棵，最高 1 cell 高度） */}
      <PerimeterSakuraCells cells={perimeterSakuraCells} />

      {/* Exit Portal */}
      <ExitPortal x={(maze.exitCol + 0.5) * CELL_SCALE} z={(maze.exitRow + 0.5) * CELL_SCALE} />

      {/* Start marker (subtle) */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(maze.startCol + 0.5) * CELL_SCALE, 0.01, (maze.startRow + 0.5) * CELL_SCALE]}
      >
        <circleGeometry args={[0.3, 24]} />
        <meshStandardMaterial color="#ff6644" emissive="#ff6644" emissiveIntensity={0.5} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

// ===== Exit Portal =====

interface ExitPortalProps {
  x: number;
  z: number;
}

function ExitPortal({ x, z }: ExitPortalProps) {
  const ringRef = useRef<THREE.Mesh>(null);
  const innerRef = useRef<THREE.Mesh>(null);

  // 动画
  useFrameAnimation(ringRef, innerRef);

  return (
    <group position={[x, 0, z]}>
      {/* Glowing ring on the floor */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <torusGeometry args={[0.32, 0.04, 8, 32]} />
        <meshStandardMaterial
          color={EXIT_COLOR}
          emissive={EXIT_COLOR}
          emissiveIntensity={1.2}
          roughness={0.3}
        />
      </mesh>

      {/* Inner glow disc */}
      <mesh ref={innerRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.28, 24]} />
        <meshStandardMaterial
          color={EXIT_COLOR}
          emissive={EXIT_COLOR}
          emissiveIntensity={0.8}
          transparent
          opacity={0.4}
        />
      </mesh>

      {/* Vertical light beam */}
      <mesh position={[0, WALL_HEIGHT / 2, 0]}>
        <cylinderGeometry args={[0.15, 0.3, WALL_HEIGHT, 16, 1, true]} />
        <meshStandardMaterial
          color={EXIT_COLOR}
          emissive={EXIT_COLOR}
          emissiveIntensity={0.6}
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
        />
      </mesh>

      <directionalLight position={[10, 10, 10]} />
    </group>
  );
}

// 抽取 useFrame 动画到独立 hook
function useFrameAnimation(
  ringRef: React.RefObject<THREE.Mesh | null>,
  innerRef: React.RefObject<THREE.Mesh | null>,
) {
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.8;
      const pulse = 1 + Math.sin(t * 2.5) * 0.08;
      ringRef.current.scale.setScalar(pulse);
    }
    if (innerRef.current) {
      const pulse = 0.5 + Math.sin(t * 3) * 0.15;
      innerRef.current.scale.setScalar(pulse);
      (innerRef.current.material as THREE.MeshStandardMaterial).emissiveIntensity =
        0.8 + Math.sin(t * 3) * 0.3;
    }
  });
}
