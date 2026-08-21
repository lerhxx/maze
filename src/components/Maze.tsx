import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useGraph } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { MazeData } from '../game/types';
import { WALL_HEIGHT } from '../constants/wall';
import { EXIT_COLOR } from '../constants/flag';
import { CELL_SCALE } from '../constants/global';
import {
  LEAF_PALETTE,
  TRUNK_PALETTE,
  GREENTREE_PARTS_TOTAL,
  GREENTREE_PALETTE_SIZE,
  getGreentreeGeometry,
  getGreentreeLocalPosition,
  GREENTREE_UNIT_HEIGHT,
  GREENTREE_UNIT_RADIUS,
  GREENTREE_PART_TRUNK,
} from './GreenTree';
import { GrassCells } from './GrassCells';

// GLTF 资产位置
const SAKURA_URL = '/model/sakura-tree.glb';

/** (c,r) 种子的确定性 LCG 伪随机 */
function createLcg(c: number, r: number) {
  let s = (c * 73856093) ^ (r * 19349663);
  if (s === 0) s = 1;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * 判断墙格是否属于「迷宫四边（含四角）」——
 * 这类墙格用樱花树贴边围绕。
 */
function isPerimeterWall(c: number, r: number, w: number, h: number): boolean {
  return c === 0 || c === w - 1 || r === 0 || r === h - 1;
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
    const int: Array<{ c: number; r: number }> = [];
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

  return (
    <group>
      {/* Floor */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[(w / 2) * CELL_SCALE, 0, (h / 2) * CELL_SCALE]}
      >
        <planeGeometry args={[w * CELL_SCALE, h * CELL_SCALE]} />
        {/* <meshStandardMaterial  roughness={0.9} metalness={0.1} map={pebble‌Texture} normalMap={ pebble‌NormalTexture } /> */
        <meshStandardMaterial color="#D29E76" />}
      </mesh>

      {/* 所有墙格底部：grass.glb 贴地平铺（1 格一个） */}
      <GrassCells cells={grassCells} />

      {/* 内部墙 → 每格多棵 GreenTree 针叶松（替代 wooden-fence + 描边） */}
      <InteriorTreesCells cells={interiorWallCells} />

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

// ===== 1. InteriorTreesCells: 内部墙格 GreenTree 针叶松群（5 调色板 × 5 子零件 = 25 InstancedMesh） =====

interface InteriorTreesCellsProps {
  cells: Array<{ c: number; r: number }>;
}

interface SingleTree {
  /** 世界 X */
  x: number;
  /** 世界 Z */
  z: number;
  /** 整体缩放（目标最高 ≈ CELL_SCALE） */
  s: number;
  /** 绕 Y 旋转 */
  yRot: number;
  /** 调色板索引 [0, GREENTREE_PALETTE_SIZE) */
  paletteIdx: number;
}

function InteriorTreesCells({ cells }: InteriorTreesCellsProps) {
  // 每内部墙格 3~6 棵树，统一先算实例 → 按 (paletteIdx, partIdx) 分组
  const instancesByPalette = useMemo<SingleTree[][]>(() => {
    const buckets: SingleTree[][] = Array.from(
      { length: GREENTREE_PALETTE_SIZE },
      () => [],
    );
    // GREENTREE_UNIT_HEIGHT 是单位 scale=1 时总高；目标最高 = CELL_SCALE → 单位 scale = CELL_SCALE / UNIT_HEIGHT
    const unitScale = CELL_SCALE / GREENTREE_UNIT_HEIGHT;
    // 这棵树在 XZ 平面的实际半径 = 缩放 s × GREENTREE_UNIT_RADIUS；
    // 为了「整棵树都在单元格内」，中心 (x,z) 必须落在 [cellX0 + r, cellX0 + CELL_SCALE - r] 两端各留 r 的安全边。
    // 最小/最大 r 对应最小/最大 s：这里先算 s，再 clamp 位置。
    for (let { c, r } of cells) {
      const rng = createLcg(c, r);
      const count = 3 + Math.floor(rng() * 4); // 3..6
      const cellX0 = c * CELL_SCALE;
      const cellZ0 = r * CELL_SCALE;
      for (let i = 0; i < count; i++) {
        // 高度随机 ∈ [0.6, 1.0] → 最高 = CELL_SCALE
        const s = (0.6 + rng() * 0.4) * unitScale;
        // 单元格内的「安全半径」= s × UNIT_RADIUS，整树不能出格
        const safeRadius = s * GREENTREE_UNIT_RADIUS;
        const minX = cellX0 + safeRadius;
        const maxX = cellX0 + CELL_SCALE - safeRadius;
        const minZ = cellZ0 + safeRadius;
        const maxZ = cellZ0 + CELL_SCALE - safeRadius;
        // 初始用 [0,1] 均匀随机，之后 clamp；即使 minX>maxX（极端树太大）也会塌到单元格中线，保证不出格
        const fxRaw = rng();
        const fzRaw = rng();
        const xRaw = cellX0 + fxRaw * CELL_SCALE;
        const zRaw = cellZ0 + fzRaw * CELL_SCALE;
        const x = Math.min(Math.max(xRaw, minX), maxX);
        const z = Math.min(Math.max(zRaw, minZ), maxZ);
        const yRot = rng() * Math.PI * 2;
        const paletteIdx = Math.min(
          GREENTREE_PALETTE_SIZE - 1,
          Math.floor(rng() * GREENTREE_PALETTE_SIZE),
        );
        buckets[paletteIdx].push({ x, z, s, yRot, paletteIdx });
      }
    }
    return buckets;
  }, [cells]);

  // 所有子零件（5 个）× 所有调色板（5 个）共 25 个 instancedMesh refs
  const refs = useRef<Record<string, THREE.InstancedMesh | null>>({});

  useLayoutEffect(() => {
    const treeDummy = new THREE.Object3D();
    const partDummy = new THREE.Object3D();
    const partLocalMatrix = new THREE.Matrix4();
    const composed = new THREE.Matrix4();

    for (let paletteIdx = 0; paletteIdx < GREENTREE_PALETTE_SIZE; paletteIdx++) {
      const trees = instancesByPalette[paletteIdx];
      for (let partIdx = 0; partIdx < GREENTREE_PARTS_TOTAL; partIdx++) {
        const key = `${paletteIdx}-${partIdx}`;
        const inst = refs.current[key];
        if (!inst) continue;
        const partLocalY = getGreentreeLocalPosition(partIdx);
        for (let i = 0; i < trees.length; i++) {
          const t = trees[i];
          treeDummy.position.set(t.x, 0, t.z);
          treeDummy.rotation.set(0, t.yRot, 0);
          treeDummy.scale.setScalar(t.s);
          treeDummy.updateMatrix();

          partDummy.position.set(0, partLocalY, 0);
          partDummy.rotation.set(0, 0, 0);
          partDummy.scale.set(1, 1, 1);
          partDummy.updateMatrix();
          partLocalMatrix.copy(partDummy.matrix);

          composed.multiplyMatrices(treeDummy.matrix, partLocalMatrix);
          inst.setMatrixAt(i, composed);
        }
        inst.instanceMatrix.needsUpdate = true;
      }
    }
  }, [instancesByPalette]);

  if (cells.length === 0) return null;

  const nodes = [];
  for (let paletteIdx = 0; paletteIdx < GREENTREE_PALETTE_SIZE; paletteIdx++) {
    const count = instancesByPalette[paletteIdx].length;
    if (count === 0) continue;
    const leafColor = LEAF_PALETTE[paletteIdx];
    const trunkColor = TRUNK_PALETTE[paletteIdx];
    for (let partIdx = 0; partIdx < GREENTREE_PARTS_TOTAL; partIdx++) {
      const color = partIdx === GREENTREE_PART_TRUNK ? trunkColor : leafColor;
      const key = `${paletteIdx}-${partIdx}`;
      const geom = getGreentreeGeometry(partIdx);
      const isTrunk = partIdx === GREENTREE_PART_TRUNK;
      const roughness = isTrunk ? 0.9 : 0.75;
      const flat = !isTrunk;
      nodes.push(
        <instancedMesh
          key={key}
          ref={(el) => {
            refs.current[key] = el;
          }}
          args={[geom, undefined, count]}
          castShadow
          receiveShadow
        >
          <meshStandardMaterial
            color={color}
            roughness={roughness}
            metalness={0}
            flatShading={flat}
          />
        </instancedMesh>,
      );
    }
  }
  return <>{nodes}</>;
}

// ===== 3. PerimeterSakuraCells: 迷宫四边樱花树贴边围绕 =====

interface PerimeterSakuraCellsProps {
  cells: Array<{ c: number; r: number }>;
}

function PerimeterSakuraCells({ cells }: PerimeterSakuraCellsProps) {
  const gltf = useGLTF(SAKURA_URL);
  const { nodes, materials } = useGraph(gltf.scene as unknown as THREE.Object3D);

  const { meshParts, normalizeScale } = useMemo<{
    meshParts: Array<{ mesh: THREE.Mesh; localMatrix: THREE.Matrix4 }>;
    normalizeScale: number;
  }>(() => {
    const result: Array<{ mesh: THREE.Mesh; localMatrix: THREE.Matrix4 }> = [];
    const sceneBox = new THREE.Box3();
    const tmpBox = new THREE.Box3();
    (gltf.scene as unknown as THREE.Object3D).traverse((obj) => {
      const maybeMesh = obj as unknown as { isMesh?: boolean };
      if (maybeMesh.isMesh) {
        const m = obj as unknown as THREE.Mesh;
        m.updateWorldMatrix(true, false);
        const localMatrix = new THREE.Matrix4().copy(m.matrixWorld);
        result.push({ mesh: m, localMatrix });
        if (m.geometry) {
          tmpBox.makeEmpty();
          const bb = (m.geometry as unknown as { boundingBox?: THREE.Box3 }).boundingBox;
          if (bb) tmpBox.copy(bb);
          else tmpBox.setFromObject(m as unknown as THREE.Object3D);
          tmpBox.applyMatrix4(localMatrix);
          sceneBox.union(tmpBox);
        }
      }
    });
    // 主体最长轴归一到 CELL_SCALE：主体最高 = 1 单元格；之后叠加 random [0.6, 1.0]，仍 ≤ 1 cell
    let scale = 1;
    if (!sceneBox.isEmpty()) {
      const size = new THREE.Vector3();
      sceneBox.getSize(size);
      const maxDim = Math.max(size.x, Math.max(size.y, size.z));
      if (maxDim > 0) scale = CELL_SCALE / maxDim;
    }
    return { meshParts: result, normalizeScale: scale };
  }, [gltf.scene, nodes]);

  const instancedRefs = useRef<Array<THREE.InstancedMesh | null>>([]);

  useLayoutEffect(() => {
    const dummy = new THREE.Object3D();
    const cellMatrix = new THREE.Matrix4();
    const composed = new THREE.Matrix4();
    for (let partIdx = 0; partIdx < meshParts.length; partIdx++) {
      const inst = instancedRefs.current[partIdx];
      if (!inst) continue;
      const partLocal = meshParts[partIdx].localMatrix;
      for (let i = 0; i < cells.length; i++) {
        const { c, r } = cells[i];
        const rng = createLcg(c, r);
        // 高度随机 ∈ [0.6, 1.0] × 归一化值 → 最高不超过 1 cell
        const s = 0.6 + rng() * 0.4;
        dummy.position.set((c + 0.5) * CELL_SCALE, 0, (r + 0.5) * CELL_SCALE);
        dummy.rotation.set(0, rng() * Math.PI * 2, 0);
        dummy.scale.setScalar(normalizeScale * s);
        dummy.updateMatrix();
        cellMatrix.copy(dummy.matrix);
        composed.multiplyMatrices(cellMatrix, partLocal);
        inst.setMatrixAt(i, composed);
      }
      inst.instanceMatrix.needsUpdate = true;
    }
  }, [cells, meshParts, normalizeScale]);

  void materials;

  if (cells.length === 0) return null;
  if (meshParts.length === 0) return null;

  return (
    <>
      {meshParts.map((part, idx) => {
        const srcGeom = part.mesh.geometry;
        const srcMat = Array.isArray(part.mesh.material)
          ? (part.mesh.material[0] as THREE.Material)
          : (part.mesh.material as THREE.Material);
        return (
          <instancedMesh
            key={idx}
            ref={(el) => {
              instancedRefs.current[idx] = el;
            }}
            args={[srcGeom, srcMat, cells.length]}
            castShadow
            receiveShadow
          />
        );
      })}
    </>
  );
}

// ===== 3. Exit Portal =====

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
