import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Dierection, CELL_SCALE } from '../constants/global';
import type { DierectionType } from '../constants/global';
import { WALL_HEIGHT } from '../constants/wall';
import { sceneState } from '../state/sceneStore';

export interface LightBeamProps {
  position: [number, number, number];
  /** 顶部半径 */
  radiusTop?: number;
  /** 底部半径 */
  radiusBottom?: number;
  /** 环形半径 */
  radius?: number;
  /** 环形厚度 */
  tube?: number;
  /** 光柱高度，默认为 WALL_HEIGHT */
  height?: number;
  /** 场景在道路的位置 */
  sceneDir?: DierectionType;
}

/**
 * 垂直光柱 + 地面发光圆环：白色
 *
 * 反应式发光：玩家进入地面环内 → 光柱自身发光（圆环/圆心变亮、
 * 垂直光柱显现、点光源点亮）；离开后平滑回到微弱的待机状态。
 * 发光效果只作用于光柱本身，玩家模型不会发光。
 *
 * 同时：玩家进入地面环内 → 通过 sceneState 注册的触发器自动打开对应描述弹窗
 * （等效按 E 键；离开再进入才会再次触发）。
 */
export function LightBeam({
  position,
  radius = 0.3,
  tube = 0.1,
  height = WALL_HEIGHT,
  radiusTop,
  radiusBottom,
  sceneDir = Dierection.Top
}: LightBeamProps) {
  // 往场景方向靠（局部计算，不改动 props）
  const biasPosition = useMemo<[number, number, number]>(() => {
    const p: [number, number, number] = [position[0], position[1], position[2]];
    const bias = 0.2 * CELL_SCALE;
    if (sceneDir === Dierection.Top) {
      p[2] -= bias;
    } else if (sceneDir === Dierection.Right) {
      p[0] += bias;
    } else if (sceneDir === Dierection.Bottom) {
      p[2] += bias;
    } else if (sceneDir === Dierection.Left) {
      p[0] -= bias;
    }
    return p;
  }, [position, sceneDir]);

  // 材质 / 灯光 ref（每帧驱动发光强度，不触发 React 重渲染）
  const ringMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const discMatRef = useRef<THREE.MeshStandardMaterial>(null);
  // const beamMatRef = useRef<THREE.MeshStandardMaterial>(null);
  // const beamMeshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  // 发光进度 0..1，平滑过渡
  const glowRef = useRef(0);

  // 触发半径：与注册到 store 的环触发半径保持一致
  const triggerRadius = radius + tube + 0.05;

  // 注册光柱触发器：环心 + 触发半径（环半径 + 厚度 + 一点余量）
  useEffect(() => {
    const cellKey = `${Math.floor(biasPosition[0] / CELL_SCALE)},${Math.floor(biasPosition[2] / CELL_SCALE)}`;
    return sceneState.registerBeam({
      x: biasPosition[0],
      z: biasPosition[2],
      radius: triggerRadius,
      cellKey,
    });
  }, [biasPosition, triggerRadius]);

  // 每帧：玩家在环内 → 光柱发光；离开 → 平滑回到待机（玩家本身不发光）
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const dx = sceneState.playerPos.x - biasPosition[0];
    const dz = sceneState.playerPos.z - biasPosition[2];
    const inside = dx * dx + dz * dz <= triggerRadius * triggerRadius;

    const target = inside ? 1 : 0;
    const k = 1 - Math.exp(-8 * dt);
    glowRef.current = THREE.MathUtils.lerp(glowRef.current, target, k);
    const g = glowRef.current;

    // 发光时的轻微脉动（待机时保持稳定）
    const pulse = g > 0.01 ? 0.85 + Math.sin(state.clock.elapsedTime * 3) * 0.15 : 1;

    if (ringMatRef.current) {
      ringMatRef.current.emissiveIntensity = (0.12 + g * 2.3) * pulse;
    }
    if (discMatRef.current) {
      discMatRef.current.emissiveIntensity = (0.08 + g * 1.6) * pulse;
    }
    // if (beamMatRef.current) {
    //   beamMatRef.current.opacity = g * 0.22;
    // }
    // if (beamMeshRef.current) {
    //   // 光柱随发光淡入并轻微放大
    //   const s = 0.6 + g * 0.4;
    //   beamMeshRef.current.scale.set(s, 1, s);
    // }
    if (lightRef.current) {
      lightRef.current.intensity = g * 5;
    }
  });

  return (
    <group position={biasPosition}>
      {/* Glowing ring on the floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <torusGeometry args={[radius, tube, 8, 32]} />
        <meshStandardMaterial
          ref={ringMatRef}
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={0.12}
          roughness={0.3}
        />
      </mesh>

      {/* 环中心小实心圆 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.021, 0]}>
        <circleGeometry args={[radius * 0.6, 24]} />
        <meshStandardMaterial
          ref={discMatRef}
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={0.08}
          roughness={0.4}
        />
      </mesh>

      {/* 垂直光柱：仅玩家进入环内时显现（默认不可见） */}
      {/* <mesh ref={beamMeshRef} position={[0, height / 2, 0]}>
        <cylinderGeometry
          args={[radiusTop ?? radius * 0.9, radiusBottom ?? radius * 1.4, height, 16, 1, true]}
        />
        <meshStandardMaterial
          ref={beamMatRef}
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={1.6}
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh> */}

      {/* 点光源：玩家进入时点亮（照亮光柱周围地面；玩家只是被光柱照亮，自身不发光） */}
      <pointLight ref={lightRef} color="#dfe9ff" intensity={0} distance={2} decay={0.5} />
    </group>
  );
}

export default LightBeam;
