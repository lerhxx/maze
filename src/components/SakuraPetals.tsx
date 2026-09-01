import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { sceneState } from '../state/sceneStore';
import { sakuraTrees, type SakuraTree } from '../state/sakuraTrees';

// ============================================================
// PlayerSakuraPetals — 从玩家视线内的樱花树上不定时飘落的樱花花瓣
//
//  - 生成区域：先用相机视锥 + 距离筛出「玩家视线内」的樱花树（树的位置与树冠
//    尺寸由 Wall.tsx 注册到 sakuraTrees），再在这些树的树冠球壳内随机取点，
//    所以花瓣总是从玩家真正看到的那几棵树上飘下来。
//  - 不定时：单瓣随机间隔为主，偶尔来一阵「花瓣雨」，一阵之后多半会有个间歇，
//    形成 阵风 → 稀疏 → 间歇 的自然节奏。
//  - 实现：单个 InstancedMesh + 对象池循环复用，全程零 GC 分配。
// ============================================================

/** 对象池容量（同时存在的花瓣上限） */
const POOL = 200;

// ===== 生成源：玩家视线内的樱花树 =====
/** 树离玩家太近会让花瓣糊在镜头上，太远则看不见 —— 只取这个距离区间内的树 */
const TREE_MIN_DIST = 0.9;
const TREE_MAX_DIST = 12;
/** 可见树列表的刷新间隔（秒）：视线变化不会太快，不必每帧重算 */
const VISIBLE_REFRESH = 0.2;
/** 生成点落在树冠半径的这个比例到边缘之间（太靠中心会被枝叶挡住） */
const CROWN_SAMPLE_MIN = 0.35;

// ===== 下落 / 摆动 / 翻飞 =====
/** 落差只剩一棵树的高度，速度放慢些才够飘 */
const FALL_SPEED_MIN = 0.18;
const FALL_SPEED_MAX = 0.42;
const SWAY_AMP_MIN = 0.22;
const SWAY_AMP_MAX = 0.8;
const SWAY_FREQ_MIN = 0.7;
const SWAY_FREQ_MAX = 2.0;
const SPIN_MIN = 0.5;
const SPIN_MAX = 2.4;

// ===== 大小 =====
const SCALE_MIN = 0.04;
const SCALE_MAX = 0.075;

// ===== 不定时节奏（秒） =====
/** 单瓣之间的基础间隔 */
const GAP_MIN = 0.05;
const GAP_MAX = 0.45;
/** 生成时是多瓣「阵风」的概率 */
const GUST_CHANCE = 0.14;
const GUST_MIN = 4;
const GUST_MAX = 11;
/** 一阵之后进入「间歇」的概率（花瓣停一停，下一阵更自然） */
const LULL_CHANCE = 0.2;
const LULL_MIN = 0.9;
const LULL_MAX = 2.4;

// ===== 回收 =====
/** 离玩家超过这个距离直接回收（略大于 TREE_MAX_DIST，免得远处的瓣凭空消失） */
const DESPAWN_RADIUS = TREE_MAX_DIST + 1.5;
const GROUND_Y = 0.005;
/** 触地前的淡出高度（缩小消失，避免「啪」地弹没） */
const FADE_HEIGHT = 0.12;

/** 樱花花瓣配色：由浅粉到近白 */
const PETAL_COLORS = [
  '#ffd9e6',
  '#ffc2d8',
  '#ffb0cc',
  '#ffe6ee',
  '#fff3f6',
  '#f9a8c6',
];

interface Petal {
  active: boolean;
  x: number;
  y: number;
  z: number;
  /** 下落速度（正值，每帧减） */
  vy: number;
  /** 三轴朝向（弧度） */
  rx: number;
  ry: number;
  rz: number;
  /** 三轴翻飞角速度 */
  spinX: number;
  spinY: number;
  spinZ: number;
  /** 左右摇摆 */
  swayAmp: number;
  swayFreq: number;
  swayPhase: number;
  scale: number;
}

function randRange(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function randSpin() {
  return randRange(SPIN_MIN, SPIN_MAX) * (Math.random() < 0.5 ? -1 : 1);
}

function createPetal(): Petal {
  return {
    active: false,
    x: 0,
    y: 0,
    z: 0,
    vy: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    spinX: 0,
    spinY: 0,
    spinZ: 0,
    swayAmp: 0,
    swayFreq: 0,
    swayPhase: 0,
    scale: 0,
  };
}

/**
 * 单片花瓣几何：樱花标志性的「尖端带缺口」轮廓，
 * 再把平面压出一点弧度（两侧上翘、尖端后仰），翻飞时更有体积感。
 */
function createPetalGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.5); // 花瓣根部
  shape.bezierCurveTo(0.3, -0.42, 0.46, -0.06, 0.34, 0.26); // 右侧
  shape.quadraticCurveTo(0.28, 0.42, 0.08, 0.4); // 右上缘 → 缺口右尖
  shape.quadraticCurveTo(0.04, 0.39, 0, 0.28); // 缺口（向内凹）
  shape.quadraticCurveTo(-0.04, 0.39, -0.08, 0.4); // 缺口左尖
  shape.quadraticCurveTo(-0.28, 0.42, -0.34, 0.26); // 左上缘
  shape.bezierCurveTo(-0.46, -0.06, -0.3, -0.42, 0, -0.5); // 左侧回根部

  const geo = new THREE.ShapeGeometry(shape, 10);

  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const nx = THREE.MathUtils.clamp(pos.getX(i) / 0.46, -1, 1); // 宽度方向 -1..1
    const ny = THREE.MathUtils.clamp((pos.getY(i) + 0.5) / 0.92, 0, 1); // 根部→尖端 0..1
    pos.setZ(i, 0.3 * nx * nx * (0.35 + 0.65 * ny) - 0.16 * ny * ny);
  }
  pos.needsUpdate = true;

  geo.computeVertexNormals();
  geo.center(); // 绕自身中心翻飞
  return geo;
}

export function PlayerSakuraPetals() {
  const { camera } = useThree();
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const petals = useMemo(() => Array.from({ length: POOL }, createPetal), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colors = useMemo(
    () => PETAL_COLORS.map((c) => new THREE.Color(c)),
    [],
  );

  const geometry = useMemo(createPetalGeometry, []);
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff',
        roughness: 0.7,
        metalness: 0,
        side: THREE.DoubleSide,
        emissive: new THREE.Color('#ff9ec4'),
        emissiveIntensity: 0.35,
      }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);

  /** 写入下一个实例的游标（循环复用最老的花瓣） */
  const cursorRef = useRef(0);
  /** 距离下一次生成的剩余时间 */
  const gapRef = useRef(randRange(0.2, 0.8));
  /** 颜色有更新时再同步 instanceColor */
  const colorDirtyRef = useRef(false);
  /** 首帧跳过：Player 还没写入坐标 */
  const primedRef = useRef(false);

  /** 当前视线内的树 */
  const visibleTreesRef = useRef<readonly SakuraTree[]>([]);
  /** 距离下一次刷新可见树的剩余时间（初值 0 → 首帧立即刷新） */
  const visibleTimerRef = useRef(0);

  // 视锥剔除用的临时对象（复用，避免每帧分配）
  const frustum = useMemo(() => new THREE.Frustum(), []);
  const projScreen = useMemo(() => new THREE.Matrix4(), []);
  const sphere = useMemo(() => new THREE.Sphere(), []);

  /**
   * 刷新「玩家视线内的樱花树」：
   * 距离粗筛（便宜）→ 相机视锥精筛（用树冠包围球判断）。
   * Player 的 useFrame 先于本组件执行，相机位置已是本帧的；这里手动刷新
   * 矩阵，确保拿到的是最新视锥（渲染循环的 matrixWorld 要到最后才更新）。
   */
  const refreshVisibleTrees = useCallback(() => {
    camera.updateMatrixWorld();
    projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projScreen);

    const all = sakuraTrees.getAll();
    const px = sceneState.playerPos.x;
    const pz = sceneState.playerPos.z;
    const out: SakuraTree[] = [];

    for (let i = 0; i < all.length; i++) {
      const tree = all[i];
      const dx = tree.x - px;
      const dz = tree.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 > TREE_MAX_DIST * TREE_MAX_DIST) continue;
      if (d2 < TREE_MIN_DIST * TREE_MIN_DIST) continue;

      sphere.center.set(tree.x, tree.crownY, tree.z);
      sphere.radius = tree.crownRadius;
      if (frustum.intersectsSphere(sphere)) out.push(tree);
    }

    visibleTreesRef.current = out;
  }, [camera, frustum, projScreen, sphere]);

  /** 收起第 i 个实例（缩放到 0） */
  const hideInstance = useCallback(
    (i: number) => {
      const mesh = meshRef.current;
      if (!mesh) return;
      dummy.position.set(0, 0, 0);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    },
    [dummy],
  );

  /** 从视线内随机一棵樱花树的树冠上生成一片花瓣（循环复用对象池） */
  const spawnPetal = useCallback(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const trees = visibleTreesRef.current;
    // 视线里没有樱花树（面朝空地 / 模型还没注册）→ 这一拍不生成
    if (trees.length === 0) return;
    const tree = trees[Math.floor(Math.random() * trees.length)];

    const i = cursorRef.current;
    cursorRef.current = (i + 1) % POOL;
    const p = petals[i];

    // 树冠球壳内随机一点：先用立方体均匀取方向，再缩到 [CROWN_SAMPLE_MIN, 1] 半径
    const ox = Math.random() * 2 - 1;
    const oy = Math.random() * 2 - 1;
    const oz = Math.random() * 2 - 1;
    const inv = (CROWN_SAMPLE_MIN + Math.random() * (1 - CROWN_SAMPLE_MIN)) /
      (Math.hypot(ox, oy, oz) || 1);

    p.x = tree.x + ox * inv * tree.crownRadius;
    p.z = tree.z + oz * inv * tree.crownRadius;
    // 矮树的树冠下沿可能到地面以下，抬一点，免得花瓣刚生成就消失
    p.y = Math.max(tree.crownY + oy * inv * tree.crownRadius, 0.15);
    p.vy = randRange(FALL_SPEED_MIN, FALL_SPEED_MAX);

    p.rx = Math.random() * Math.PI * 2;
    p.ry = Math.random() * Math.PI * 2;
    p.rz = Math.random() * Math.PI * 2;
    p.spinX = randSpin();
    p.spinY = randSpin();
    p.spinZ = randSpin();

    p.swayAmp = randRange(SWAY_AMP_MIN, SWAY_AMP_MAX);
    p.swayFreq = randRange(SWAY_FREQ_MIN, SWAY_FREQ_MAX);
    p.swayPhase = Math.random() * Math.PI * 2;
    p.scale = randRange(SCALE_MIN, SCALE_MAX);

    p.active = true;

    mesh.setColorAt(i, colors[Math.floor(Math.random() * colors.length)]);
    colorDirtyRef.current = true;
  }, [colors, petals]);

  // 初始化 instanceColor（three 在首次 setColorAt 时才会创建该属性）
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const white = new THREE.Color('#ffffff');
    for (let i = 0; i < POOL; i++) {
      mesh.setColorAt(i, white);
      hideInstance(i); // 初始全部收起（instanceMatrix 初值全 0，显式写一次更稳妥）
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    // 实例位置每帧都在变，包围球不跟随 → 关掉视锥剔除，否则花瓣会整片消失
    mesh.frustumCulled = false;
  }, [hideInstance]);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;

    if (!primedRef.current) {
      primedRef.current = true;
      return; // 等 Player 写过一次 playerPos
    }

    // ---------- 刷新视线内的樱花树 ----------
    visibleTimerRef.current -= dt;
    if (visibleTimerRef.current <= 0) {
      refreshVisibleTrees();
      visibleTimerRef.current = VISIBLE_REFRESH;
    }

    // ---------- 不定时生成 ----------
    gapRef.current -= dt;
    while (gapRef.current <= 0) {
      const gust = Math.random() < GUST_CHANCE;
      const count = gust
        ? GUST_MIN + Math.floor(Math.random() * (GUST_MAX - GUST_MIN + 1))
        : 1;
      for (let k = 0; k < count; k++) spawnPetal();
      // 阵风后稍作停顿；平时也有小概率进入间歇
      gapRef.current += gust
        ? randRange(GAP_MIN, GAP_MAX) * 1.6
        : Math.random() < LULL_CHANCE
          ? randRange(LULL_MIN, LULL_MAX)
          : randRange(GAP_MIN, GAP_MAX);
    }

    // ---------- 全局微风（缓慢变化的整体风向） ----------
    const windX = 0.05 + Math.sin(t * 0.15) * 0.09;
    const windZ = Math.cos(t * 0.11) * 0.07;

    // ---------- 更新 ----------
    for (let i = 0; i < POOL; i++) {
      const p = petals[i];
      if (!p.active) continue;

      p.y -= p.vy * dt;
      p.x += (Math.sin(t * p.swayFreq + p.swayPhase) * p.swayAmp + windX) * dt;
      p.z += (Math.cos(t * p.swayFreq * 0.8 + p.swayPhase) * p.swayAmp * 0.7 + windZ) * dt;

      p.rx += p.spinX * dt;
      p.ry += p.spinY * dt;
      // 翻面：在匀速自转上叠一层周期性摆动，像被气流掀动
      p.rz += (p.spinZ + Math.sin(t * 2.4 + p.swayPhase) * 1.6) * dt;

      if (p.y <= GROUND_Y) {
        p.active = false;
      } else {
        const dx = p.x - sceneState.playerPos.x;
        const dz = p.z - sceneState.playerPos.z;
        if (dx * dx + dz * dz > DESPAWN_RADIUS * DESPAWN_RADIUS) {
          p.active = false;
        }
      }

      if (!p.active) {
        hideInstance(i);
        continue;
      }

      // 触地前缩小淡出
      const fade = THREE.MathUtils.clamp(p.y / FADE_HEIGHT, 0, 1);
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(p.rx, p.ry, p.rz);
      dummy.scale.setScalar(p.scale * fade);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (colorDirtyRef.current && mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true;
      colorDirtyRef.current = false;
    }
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, POOL]}
      frustumCulled={false}
      renderOrder={2}
    />
  );
}
