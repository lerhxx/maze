import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import type { MazeData } from '../game/types';
import {
  WALL_HEIGHT,
} from '../constants/wall';
import { EXIT_COLOR } from '../constants/flag';
import { CELL_SCALE } from '../constants/global';

interface MazeEnvironmentProps {
  maze: MazeData;
}

export function MazeEnvironment({ maze }: MazeEnvironmentProps) {
  const { width: w, height: h } = maze;

  // 收集所有「墙壁单元格」的坐标，用单个 InstancedMesh 渲染
  const wallCells = useMemo(() => {
    const list: Array<{ c: number; r: number }> = [];
    for (let c = 0; c < w; c++) {
      for (let r = 0; r < h; r++) {
        if (maze.cells[c][r].type === 'wall') {
          list.push({ c, r });
        }
      }
    }
    return list;
  }, [maze]);

  const pebble‌Texture = useTexture('./pebble‌.jpg');
  pebble‌Texture.flipY = false;
  pebble‌Texture.wrapS = THREE.RepeatWrapping;
  pebble‌Texture.wrapT = THREE.RepeatWrapping;
  pebble‌Texture.repeat.set(10, 10);

  const pebble‌NormalTexture = useTexture('./pebble‌-normal.jpg');

  return (
    <group>
      {/* Floor */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(w / 2) * CELL_SCALE, 0, (h / 2) * CELL_SCALE]}
      >
        <planeGeometry args={[w * CELL_SCALE, h * CELL_SCALE]} />
        <meshStandardMaterial  roughness={0.9} metalness={0.1} map={pebble‌Texture} normalMap={ pebble‌NormalTexture } />
      </mesh>

      {/* Walls —— 每个墙壁单元格渲染为 1×WALL_HEIGHT×1 的 box（再整体按 CELL_SCALE 缩放） */}
      <WallCells cells={wallCells} />

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

// ===== Wall rendering using InstancedMesh =====

interface WallCellsProps {
  cells: Array<{ c: number; r: number }>;
}

function WallCells({ cells }: WallCellsProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const wallTexture = useTexture('./wall-4.jpg');
  wallTexture.flipY = false;
  const wallNormalTexture = useTexture('./wall-4-normal.jpg');

  useLayoutEffect(() => {
    if (!meshRef.current) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < cells.length; i++) {
      const { c, r } = cells[i];
      // 整格 box：位置在格子中心，scale 等于一个单元格的世界尺寸
      dummy.position.set((c + 0.5) * CELL_SCALE, WALL_HEIGHT / 2, (r + 0.5) * CELL_SCALE);
      dummy.scale.set(CELL_SCALE, 1, CELL_SCALE);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [cells]);

  if (cells.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, cells.length]}
      key={cells.length}
    >
      <boxGeometry args={[1, WALL_HEIGHT, 1]} />
      <meshStandardMaterial roughness={0.8} metalness={0.15} map={ wallTexture } normalMap={ wallNormalTexture } />
    </instancedMesh>
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

      {/* Point light */}
      {/* <pointLight
        color={EXIT_COLOR}
        intensity={EXIT_LIGHT_INTENSITY}
        distance={EXIT_LIGHT_DISTANCE}
        position={[0, 0.5, 0]}
      /> */}
      <directionalLight position={[10, 10, 10]} />
    </group>
  );
}
