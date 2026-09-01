import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * ModelFallback：模型（glb）懒加载期间的 3D 占位体（粒子式 loading）。
 *
 * 视觉：12 颗胶囊（CapsuleGeometry）均匀排成一个**垂直环**（环面在 XY 平面，
 * Y 轴为竖直方向），每颗沿径向朝外，颜色按圆周角在青→蓝之间渐变（与原
 * fallback 的冷色调匹配）。整个环绕自身 Z 轴（视线轴）持续旋转；同时环面
 * 每帧朝向相机（billboard），这样在 3D 场景里从任何角度看都是完整的圆，
 * 不会退化成一条线。
 *
 * 周期性地（5~9 秒随机间隔）触发一次"向四周消散"：所有粒子沿径向向外飞出 +
 * 缩小 + 整体淡出，~1.5 秒后收回原位继续旋转，给人「正在准备切换模式」的
 * 节奏感。组件卸载（Suspense 切到真实模型）时再补一次消散淡出。
 *
 * 用法：放在 <Suspense fallback={...}> 上，模型下载完成前占位；
 * 下载完成后由 Suspense 自动卸载。
 */

const COUNT = 12;
/** 圆环相对 size 的半径 */
const RING_RADIUS_RATIO = 0.42;
/** 消散时粒子向外飞的最大距离（相对 size） */
const DISSIPATE_DISTANCE_RATIO = 0.7;
/** 消散阶段总时长（秒） */
const DISSIPATE_DURATION = 1.5;
/** 两次消散之间的随机静默时间（秒） */
const LULL_MIN = 5;
const LULL_MAX = 9;
/** 卸载时再额外播一次消散（让 Suspense 切到真模型时也能看到一点过渡） */
const UNMOUNT_DISSIPATE_DURATION = 0.9;

export interface ModelFallbackProps {
  /** 占位体整体尺寸（与对应场景模型的 size 对齐） */
  size?: number;
  /** 整体色色相。传了就用这个颜色画整环；不传就用青→蓝渐变（匹配场景冷色调） */
  color?: string;
  /** 相对父 group 的偏移；默认浮在格子中心偏上 */
  position?: [number, number, number];
  /** 转圈角速度（弧度/秒） */
  speed?: number;
}

export function ModelFallback({
  size = 1,
  color,
  position,
  speed = 1.2,
}: ModelFallbackProps) {
  const { camera } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  /** 累计自转角（billboard 每帧重置 rotation，所以角度要自己存） */
  const spinRef = useRef(0);

  // ===== 几何与材质 =====
  // 胶囊：长 ~0.22 * size，半径 ~0.045 * size
  const geometry = useMemo(
    () => new THREE.CapsuleGeometry(size * 0.045, size * 0.15, 4, 12),
    [size],
  );
  const material = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#ffffff', // 实际颜色由 instanceColor 控制
        roughness: 0.3,
        metalness: 0,
        emissive: '#ffffff',
        emissiveIntensity: 0.4,
        transparent: true,
        opacity: 1,
        depthWrite: false, // 整体淡出时不会因为深度写入留下残影
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      material.dispose();
    },
    [geometry, material],
  );

  // ===== 颜色 =====
  // 不传 color → 青→蓝渐变（图片同款、匹配冷色调场景）
  // 传了 color → 整环用该色（每个粒子用 instanceColor 单独设置）
  const colors = useMemo<THREE.Color[]>(() => {
    const out: THREE.Color[] = [];
    if (color) {
      const base = new THREE.Color(color);
      // 围绕 base 在 HSL 上做 ±0.05 亮度波动 → 立体感（避免完全死板的单色）
      const hsl = { h: 0, s: 0, l: 0 };
      base.getHSL(hsl);
      for (let i = 0; i < COUNT; i++) {
        const t = i / (COUNT - 1);
        const c = new THREE.Color().setHSL(
          hsl.h,
          hsl.s,
          THREE.MathUtils.clamp(hsl.l + (t - 0.5) * 0.18, 0.1, 0.85),
        );
        out.push(c);
      }
    } else {
      // 青 (#5ed8d6) → 蓝 (#4aa8f0) 按圆周角渐变
      const start = new THREE.Color('#5ed8d6');
      const end = new THREE.Color('#4aa8f0');
      for (let i = 0; i < COUNT; i++) {
        const t = i / (COUNT - 1);
        out.push(new THREE.Color().lerpColors(start, end, t));
      }
    }
    return out;
  }, [color]);

  // 写入 instanceColor（three 在首次 setColorAt 时才创建该属性）
  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < COUNT; i++) mesh.setColorAt(i, colors[i]);
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false; // 粒子飞出包围球时不能被剔除
  }, [colors]);

  // ===== 粒子基础角度 =====
  const data = useMemo(
    () => Array.from({ length: COUNT }, (_, i) => ({ theta: (i / COUNT) * Math.PI * 2 })),
    [],
  );

  // 旋转用的临时对象，避免每帧分配
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const yAxis = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const radialVec = useMemo(() => new THREE.Vector3(), []);

  // ===== 状态机：spin ↔ dissipate（卸载时再补一次 dissipated 阶段） =====
  const stateRef = useRef({
    phase: 'spin' as 'spin' | 'dissipate' | 'unmount',
    phaseStart: 0,
    // 首屏后短延迟第一次消散（避免一上来就炸开）
    nextDissipate: 0.8 + Math.random() * 1.2,
  });

  // 卸载时进入 dissipate 阶段，尝试播一段消散再让外层卸载
  useEffect(() => {
    return () => {
      stateRef.current.phase = 'unmount';
      stateRef.current.phaseStart = performance.now() / 1000;
    };
  }, []);

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    const group = groupRef.current;
    if (!mesh || !group) return;

    const t = state.clock.elapsedTime;
    const dt = Math.min(delta, 0.05);

    // ---- 整体转圈 ----
    // 垂直环：环面每帧朝向相机（billboard，侧看不会退化成线），
    // 再绕自身 Z 轴（= 视线轴）叠加自转
    spinRef.current += speed * dt;
    group.lookAt(camera.position);
    group.rotateZ(spinRef.current);

    // ---- 状态机推进 ----
    const s = stateRef.current;
    if (s.phase === 'spin') {
      if (t >= s.nextDissipate) {
        s.phase = 'dissipate';
        s.phaseStart = t;
      }
    } else if (s.phase === 'dissipate') {
      if (t - s.phaseStart > DISSIPATE_DURATION) {
        s.phase = 'spin';
        s.nextDissipate = t + LULL_MIN + Math.random() * (LULL_MAX - LULL_MIN);
      }
    }

    // ---- 计算消散进度（0=完全聚拢，1=完全散开） ----
    // 用 sin(πp) 让 p∈[0,1] 上的曲线两端为 0、中间为 1 —— 单段就能飞出再回收
    let dissipate = 0;
    let duration = DISSIPATE_DURATION;
    if (s.phase === 'dissipate') {
      const p = Math.min((t - s.phaseStart) / DISSIPATE_DURATION, 1);
      dissipate = Math.sin(p * Math.PI);
    } else if (s.phase === 'unmount') {
      // 卸载阶段：从挂载时间起算，让用户能看到一次完整的「炸开 → 收口之前」
      // （Suspense 切到真模型时 fallback 会被直接卸载，所以这一段往往只播到一半）
      const p = Math.min((performance.now() / 1000 - s.phaseStart) / UNMOUNT_DISSIPATE_DURATION, 1);
      dissipate = Math.sin(Math.min(p, 0.55) * Math.PI);
      duration = UNMOUNT_DISSIPATE_DURATION;
    }

    // ---- 写入每个 instance 的矩阵 ----
    const baseRadius = size * RING_RADIUS_RATIO;
    const maxOutward = size * DISSIPATE_DISTANCE_RATIO;
    // 缩放：消散时收到 0.35 倍；透明度：同步淡到 0.1
    const scaleK = 1 - 0.65 * dissipate;
    const opacityK = 1 - 0.9 * dissipate;
    material.opacity = opacityK;

    for (let i = 0; i < COUNT; i++) {
      const d = data[i];
      const cos = Math.cos(d.theta);
      const sin = Math.sin(d.theta);
      const r = baseRadius + maxOutward * dissipate;

      // 垂直环：环面铺在 XY 平面（Y 为竖直方向），Z 恒为 0
      dummy.position.set(cos * r, sin * r, 0);

      // 胶囊 Y 轴对齐径向外
      radialVec.set(cos, sin, 0);
      dummy.quaternion.setFromUnitVectors(yAxis, radialVec);

      dummy.scale.setScalar(scaleK);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    void duration;
  });

  const px = position ? position[0] : 0;
  const pz = position ? position[2] : 0;
  const py = position ? position[1] : size * 0.5;

  return (
    <group ref={groupRef} position={[px, py, pz]}>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, COUNT]}
        castShadow
        receiveShadow
        frustumCulled={false}
      />
    </group>
  );
}

export default ModelFallback;