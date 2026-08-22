import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { useGraph } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
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

// GLTF 资产位置
const SAKURA_URL = '/model/sakura-tree.glb';

/** (c,r) 种子的确定性 LCG 伪随机 */
export function createLcg(c: number, r: number) {
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
export function isPerimeterWall(c: number, r: number, w: number, h: number): boolean {
  return c === 0 || c === w - 1 || r === 0 || r === h - 1;
}

// ===== 内部墙单元格类型（含可选 content） =====

export interface InteriorWallCell {
  c: number;
  r: number;
  /** 可选渲染内容：若存在则优先渲染，否则按默认针叶松逻辑 */
  content?: ReactNode;
}

// ===== 1. InteriorTreesCells: 内部墙格 GreenTree 针叶松群（5 调色板 × 5 子零件 = 25 InstancedMesh） =====

interface InteriorTreesCellsProps {
  cells: InteriorWallCell[];
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

export function InteriorTreesCells({ cells }: InteriorTreesCellsProps) {
  // 分离：有 content 的格 → 渲染 content；无 content 的格 → 走针叶松 InstancedMesh
  const { contentCells, treeCells } = useMemo(() => {
    const content: Array<{ c: number; r: number; node: ReactNode }> = [];
    const trees: InteriorWallCell[] = [];
    for (const cell of cells) {
      if (cell.content) {
        content.push({ c: cell.c, r: cell.r, node: cell.content });
      } else {
        trees.push(cell);
      }
    }
    return { contentCells: content, treeCells: trees };
  }, [cells]);

  // 每内部墙格 3~6 棵树，统一先算实例 → 按 (paletteIdx, partIdx) 分组
  const instancesByPalette = useMemo<SingleTree[][]>(() => {
    const buckets: SingleTree[][] = Array.from(
      { length: GREENTREE_PALETTE_SIZE },
      () => [],
    );
    const unitScale = CELL_SCALE / GREENTREE_UNIT_HEIGHT;
    for (let { c, r } of treeCells) {
      const rng = createLcg(c, r);
      const count = 3 + Math.floor(rng() * 4); // 3..6
      const cellX0 = c * CELL_SCALE;
      const cellZ0 = r * CELL_SCALE;
      for (let i = 0; i < count; i++) {
        const s = (0.6 + rng() * 0.4) * unitScale;
        const safeRadius = s * GREENTREE_UNIT_RADIUS;
        const minX = cellX0 + safeRadius;
        const maxX = cellX0 + CELL_SCALE - safeRadius;
        const minZ = cellZ0 + safeRadius;
        const maxZ = cellZ0 + CELL_SCALE - safeRadius;
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
  }, [treeCells]);

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

  const treeNodes = [];
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
      treeNodes.push(
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

  return (
    <>
      {treeNodes}
      {/* 有 content 的墙格 → 渲染 content（如 shopee.glb） */}
      {contentCells.map(({ c, r, node }, i) => (
        <group
          key={`content-${c}-${r}-${i}`}
          position={[(c + 0.5) * CELL_SCALE, 0, (r + 0.5) * CELL_SCALE]}
        >
          {node}
        </group>
      ))}
    </>
  );
}

// ===== 2. PerimeterSakuraCells: 迷宫四边樱花树贴边围绕 =====

interface PerimeterSakuraCellsProps {
  cells: Array<{ c: number; r: number }>;
}

export function PerimeterSakuraCells({ cells }: PerimeterSakuraCellsProps) {
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
