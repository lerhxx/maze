import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import type { MazeData } from '../game/types';
import { CELL_SCALE } from '../constants/global';

const SAKURA_URL = '/model/sakura-tree.glb';
const FENCE_URL = '/model/wooden-fence.glb';
const BENCH_URL = '/model/bench.glb';
const LAMP_URL = '/model/lamp.glb';

export interface Scene1Props {
  cellC: number;
  cellR: number;
  maze: MazeData;
  /**
   * 可选：绕 Y 轴的整体朝向（弧度）。
   * 如果不传，则根据四周 path 自动选择朝内的方向。
   *
   * 组件本地约定：
   *   - 长轴沿 local X，跨度 = 2 × CELL_SCALE
   *   - 入口在 local +Z（无栅栏/樱花）
   *   - 栅栏与樱花沿 local -Z（后）、-X（左）、+X（右）三侧
   *
   * 迷宫四边推荐：
   *   顶边 (r=0)       heading = 0           （入口 +Z = 朝南，朝内）
   *   底边 (r=h-1)     heading = π           （入口 -Z = 朝北，朝内）
   *   左边 (c=0)       heading = -π/2        （入口 +X = 朝东，朝内）
   *   右边 (c=w-1)     heading = +π/2        （入口 -X = 朝西，朝内）
   */
  heading?: number;
}

/** 确定性伪随机：用 (c, r) 做种子，提供一串可复现的 [0,1) 值 */
function createRng(c: number, r: number) {
  let s = (c * 73856093) ^ (r * 19349663);
  if (s === 0) s = 1;
  return function rng() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/** 根据四周 path cell 计算"朝内"的 fallback heading（仅在 prop 未传时使用） */
function computeHeadingFallback(cellC: number, cellR: number, maze: MazeData): number {
  const sides: Array<[number, number, number]> = [
    [0, 1, 0],                   // +Z → 0
    [0, -1, Math.PI],            // -Z → π
    [1, 0, -Math.PI / 2],        // +X → -π/2
    [-1, 0, Math.PI / 2],        // -X → +π/2
  ];
  let bestAngle = 0;
  let bestScore = -Infinity;
  for (const [dc, dr, angle] of sides) {
    const nc = cellC + dc;
    const nr = cellR + dr;
    if (nc < 0 || nc >= maze.width || nr < 0 || nr >= maze.height) continue;
    if (maze.cells[nc][nr].type !== 'path') continue;
    const distToStart =
      Math.abs(nc - maze.startCol) + Math.abs(nr - maze.startRow);
    const score = 1000 - distToStart;
    if (score > bestScore) {
      bestScore = score;
      bestAngle = angle;
    }
  }
  return bestAngle;
}

/** 抽取整场景 Mesh + 零件本地矩阵；按 targetSize 统一归一化最长轴 */
function extractMeshes(scene: THREE.Object3D, targetSize: number) {
  const parts: Array<{
    geometry: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
    localMatrix: THREE.Matrix4;
  }> = [];
  const sceneBox = new THREE.Box3();
  const tmpBox = new THREE.Box3();

  scene.traverse((obj) => {
    const m = obj as unknown as THREE.Mesh;
    if ((m as unknown as { isMesh?: boolean }).isMesh && m.geometry) {
      m.updateWorldMatrix(true, false);
      const localMatrix = new THREE.Matrix4().copy(m.matrixWorld);
      let mat: THREE.Material | THREE.Material[] = m.material;
      if (Array.isArray(mat) && mat.length === 1) mat = mat[0];
      parts.push({ geometry: m.geometry, material: mat, localMatrix });

      tmpBox.makeEmpty();
      const bbox = (m.geometry as unknown as { boundingBox?: THREE.Box3 }).boundingBox;
      if (bbox) tmpBox.copy(bbox);
      else tmpBox.setFromObject(obj as unknown as THREE.Object3D);
      tmpBox.applyMatrix4(localMatrix);
      sceneBox.union(tmpBox);
    }
  });

  let scale = 1;
  if (!sceneBox.isEmpty()) {
    const size = new THREE.Vector3();
    sceneBox.getSize(size);
    const maxDim = Math.max(size.x, Math.max(size.y, size.z));
    if (maxDim > 0) scale = targetSize / maxDim;
  }
  return { parts, scale };
}

/** 一批零件 × N 个实例 → 每个零件渲染 N 个 mesh（矩阵预乘） */
function MultiInstancedParts(props: {
  parts: Array<{
    geometry: THREE.BufferGeometry;
    material: THREE.Material | THREE.Material[];
    localMatrix: THREE.Matrix4;
  }>;
  instances: THREE.Matrix4[];
  objectScale: number;
}) {
  const { parts, instances, objectScale } = props;
  if (instances.length === 0) return null;

  const uniformScale = objectScale;
  const composed = new THREE.Matrix4();
  const dummy = new THREE.Object3D();

  const matricesPerPart = useMemo(() => {
    const out: THREE.Matrix4[][] = parts.map(() => []);
    for (let i = 0; i < instances.length; i++) {
      const instMat = instances[i];
      for (let p = 0; p < parts.length; p++) {
        dummy.matrix.copy(parts[p].localMatrix);
        dummy.scale.setScalar(uniformScale);
        dummy.updateMatrix();
        const local = dummy.matrix.clone();
        composed.multiplyMatrices(instMat, local);
        out[p].push(composed.clone());
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, instances, uniformScale]);

  return (
    <>
      {parts.map((part, idx) => {
        const mats = Array.isArray(part.material) ? part.material : [part.material];
        const mat = mats[0];
        return (
          <group key={idx}>
            {matricesPerPart[idx].map((m, i) => (
              <mesh
                key={i}
                geometry={part.geometry}
                material={mat}
                matrix={m}
                matrixAutoUpdate={false}
                castShadow
                receiveShadow
              />
            ))}
          </group>
        );
      })}
    </>
  );
}

export function Scene1({ cellC, cellR, maze, heading: headingProp }: Scene1Props) {
  // 加载 4 种模型（drei useGLTF 全局缓存）
  const sakuraGltf = useGLTF(SAKURA_URL) as unknown as { scene: THREE.Object3D };
  const fenceGltf = useGLTF(FENCE_URL) as unknown as { scene: THREE.Object3D };
  const benchGltf = useGLTF(BENCH_URL) as unknown as { scene: THREE.Object3D };
  const lampGltf = useGLTF(LAMP_URL) as unknown as { scene: THREE.Object3D };

  const { heading, worldCenterX, worldCenterZ } = useMemo(() => {
    const h =
      headingProp !== undefined ? headingProp : computeHeadingFallback(cellC, cellR, maze);
    return {
      heading: h,
      worldCenterX: (cellC + 0.5) * CELL_SCALE,
      worldCenterZ: (cellR + 0.5) * CELL_SCALE,
    };
  }, [cellC, cellR, maze, headingProp]);

  // 每种资产：归一化目标长度
  const sakuraPart = useMemo(
    // 樱花树最高 = 单元格 1/2。按最长轴归一到 CELL_SCALE/2，再叠加随机 [0.6, 1.0]，
    // 最高高 = CELL_SCALE/2。Y 为主轴时，高度 ∈ [0.3, 0.5] CELL
    () => extractMeshes(sakuraGltf.scene, CELL_SCALE / 2),
    [sakuraGltf.scene],
  );
  const fencePart = useMemo(
    // fence 单段长度 = 单元格的 1/6（全局统一约定）
    () => extractMeshes(fenceGltf.scene, CELL_SCALE / 6),
    [fenceGltf.scene],
  );
  const benchPart = useMemo(
    // bench 长度 = 单元格的 1/4（全局统一约定）
    () => extractMeshes(benchGltf.scene, CELL_SCALE / 4),
    [benchGltf.scene],
  );
  const lampPart = useMemo(
    // 街灯最高 = 单元格 1/2。按最长轴归一到 CELL_SCALE/2，再随机 [0.7, 1.0]，
    // 高度 ∈ [0.35, 0.5] CELL
    () => extractMeshes(lampGltf.scene, CELL_SCALE / 2),
    [lampGltf.scene],
  );

  // 确定性布局（本地坐标：x ∈ [-CS, +CS] 长 2 单元格，z ∈ [-CS/2, +CS/2] 宽 1 单元格，入口 +Z）
  const layout = useMemo(() => {
    const rng = createRng(cellC, cellR);
    const CS = CELL_SCALE;
    // 组件新尺寸：长轴 X = 2 单元格；宽度 Z = 1 单元格。
    // 本地坐标范围约定：
    //   x ∈ [-CS, +CS]      = 2 单元格（长度）
    //   z ∈ [-CS/2, +CS/2]  = 1 单元格（宽度），入口在 +Z/2 侧，封闭在 -Z/2 侧
    const Z_HALF = CS / 2;

    // ---- 栅栏：内层一圈（+X, -X, -Z 三侧），+Z 是入口开放 ----
    // 长侧（-Z 后栅栏沿 X，2 单元格）= 10 根 fence
    // 短侧（±X 侧栅栏沿 Z，1 单元格）= 5 根 fence（数量按宽度线性缩半）
    const FENCE_LONG = 10;
    const FENCE_SHORT = 5;
    const HALF_GAP = CS / 6;
    const fenceInstances: THREE.Matrix4[] = [];
    const fenceD = new THREE.Object3D();

    // -Z 后方栅栏：沿 X（组件长轴，2 单元格长），z = -Z_HALF * 0.9 贴后边
    for (let i = 0; i < FENCE_LONG; i++) {
      const t = (i + 0.5) / FENCE_LONG;
      const x = -CS + HALF_GAP + t * (CS * 2 - HALF_GAP * 2);
      fenceD.position.set(x, 0, -Z_HALF * 0.9);
      fenceD.rotation.set(0, 0, 0);
      fenceD.updateMatrix();
      fenceInstances.push(fenceD.matrix.clone());
    }
    // -X 左侧栅栏：沿 Z（组件短轴，1 单元格宽），z 范围 [-Z_HALF + HALF_GAP, +Z_HALF - HALF_GAP]
    for (let i = 0; i < FENCE_SHORT; i++) {
      const t = (i + 0.5) / FENCE_SHORT;
      const z = -Z_HALF + HALF_GAP + t * (CS - HALF_GAP * 2);
      fenceD.position.set(-CS * 0.9, 0, z);
      fenceD.rotation.set(0, Math.PI / 2, 0);
      fenceD.updateMatrix();
      fenceInstances.push(fenceD.matrix.clone());
    }
    // +X 右侧栅栏：沿 Z
    for (let i = 0; i < FENCE_SHORT; i++) {
      const t = (i + 0.5) / FENCE_SHORT;
      const z = -Z_HALF + HALF_GAP + t * (CS - HALF_GAP * 2);
      fenceD.position.set(CS * 0.9, 0, z);
      fenceD.rotation.set(0, Math.PI / 2, 0);
      fenceD.updateMatrix();
      fenceInstances.push(fenceD.matrix.clone());
    }

    // ---- 樱花：+X / -X / -Z 三侧栅栏外侧。主体高归一到 CELL_SCALE/2，再随机 [0.6, 1.0]，最高 = 1/2 cell ----
    const sakuraInstances: THREE.Matrix4[] = [];
    const pushSakura = (x: number, z: number, yRot: number) => {
      const s = 0.6 + rng() * 0.4;
      const d = new THREE.Object3D();
      d.position.set(x, 0, z);
      d.rotation.set(0, yRot, 0);
      d.scale.setScalar(s);
      d.updateMatrix();
      sakuraInstances.push(d.matrix.clone());
    };
    const sakCountBack = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < sakCountBack; i++) {
      const t = (i + 0.5) / sakCountBack;
      const x = -CS + t * CS * 2 + (rng() - 0.5) * CS * 0.2;
      // 后栅栏外：再向 -Z 外推 0.2~0.5 CS
      const z = -Z_HALF * 1.2 - rng() * CS * 0.3;
      pushSakura(x, z, rng() * Math.PI * 2);
    }
    const sakCountLeft = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < sakCountLeft; i++) {
      const t = (i + 0.5) / sakCountLeft;
      const x = -CS * 1.2 - rng() * CS * 0.3;
      // 左栅栏外：z 的变化区间按 1 格宽度收窄到 [-Z_HALF, +Z_HALF]
      const z = -Z_HALF + t * CS + (rng() - 0.5) * CS * 0.2;
      pushSakura(x, z, rng() * Math.PI * 2);
    }
    const sakCountRight = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < sakCountRight; i++) {
      const t = (i + 0.5) / sakCountRight;
      const x = CS * 1.2 + rng() * CS * 0.3;
      const z = -Z_HALF + t * CS + (rng() - 0.5) * CS * 0.2;
      pushSakura(x, z, rng() * Math.PI * 2);
    }

    // ---- 四角：街灯（入口两前角 + 栅栏后两角）。X 方向 ±0.75 CS，Z 方向 ±0.75 Z_HALF ----
    const lampInstances: THREE.Matrix4[] = [];
    const lampCorners: Array<[number, number]> = [
      [-CS * 0.75,  Z_HALF * 0.75],   // 入口左前
      [ CS * 0.75,  Z_HALF * 0.75],   // 入口右前
      [-CS * 0.75, -Z_HALF * 0.75],   // 后左
      [ CS * 0.75, -Z_HALF * 0.75],   // 后右
    ];
    for (const [lx, lz] of lampCorners) {
      const d = new THREE.Object3D();
      d.position.set(lx, 0, lz);
      d.rotation.set(0, rng() * Math.PI * 2, 0);
      // 灯高度随机 [0.7, 1.0] × 归一化 CELL_SCALE/2 → 最高 0.5 cell
      const lampScale = 0.7 + rng() * 0.3;
      d.scale.setScalar(lampScale);
      d.updateMatrix();
      lampInstances.push(d.matrix.clone());
    }

    // ---- 内层随机 bench：2~4 个（空间比 2×2 小，减少数量），方向只有 0°/90° ----
    const benchInstances: THREE.Matrix4[] = [];
    const benchCount = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < benchCount; i++) {
      const bx = (rng() - 0.5) * CS * 1.4;               // X：长度方向给点余量
      const bz = (-Z_HALF * 0.7) + rng() * Z_HALF * 1.3;  // Z：宽度方向，从后侧缩进至前侧入口
      const yRot = rng() < 0.5 ? 0 : Math.PI / 2;
      const d = new THREE.Object3D();
      d.position.set(bx, 0, bz);
      d.rotation.set(0, yRot, 0);
      d.updateMatrix();
      benchInstances.push(d.matrix.clone());
    }

    return { fenceInstances, sakuraInstances, lampInstances, benchInstances };
  }, [cellC, cellR]);

  // 最外层 group：定位到本单元格中心 + 整体 heading 绕 Y 旋转
  // 长轴始终沿 local X（2 CELL_SCALE 跨度），旋转后自动在顶/底边沿世界 X，在左/右边沿世界 Z
  return (
    <group position={[worldCenterX, 0, worldCenterZ]} rotation={[0, heading, 0]}>
      {fencePart.parts.length > 0 && (
        <MultiInstancedParts
          parts={fencePart.parts}
          instances={layout.fenceInstances}
          objectScale={fencePart.scale}
        />
      )}
      {sakuraPart.parts.length > 0 && (
        <MultiInstancedParts
          parts={sakuraPart.parts}
          instances={layout.sakuraInstances}
          objectScale={sakuraPart.scale}
        />
      )}
      {lampPart.parts.length > 0 && (
        <MultiInstancedParts
          parts={lampPart.parts}
          instances={layout.lampInstances}
          objectScale={lampPart.scale}
        />
      )}
      {benchPart.parts.length > 0 && (
        <MultiInstancedParts
          parts={benchPart.parts}
          instances={layout.benchInstances}
          objectScale={benchPart.scale}
        />
      )}
    </group>
  );
}

export default Scene1;
