import { useEffect, useMemo } from 'react';
// import { EnvelopeLine } from './EnvelopeLine2';
import { Dierection, CELL_SCALE } from '../constants/global';
import type { DierectionType } from '../constants/global';
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
  /** 是否在光柱中心显示粉色粒子信封（相机触发汇聚/散开），默认 true */
  envelope?: boolean;
  /** 场景在道路的位置 */
  sceneDir?: DierectionType;
}

/**
 * 垂直光柱 + 地面发光圆环：白色
 * 可选：光柱中心悬浮粉色粒子信封（EnvelopeLine），
 * 相机进入视野时汇聚、经过时散开、离开后重聚。
 *
 * 玩家进入地面环内 → 通过 sceneState 注册的触发器自动打开对应描述弹窗
 * （等效按 E 键；离开再进入才会再次触发）。
 */
export function LightBeam({
  position,
  radius = 0.3,
  tube = 0.1,
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

  // 注册光柱触发器：环心 + 触发半径（环半径 + 厚度 + 一点余量）
  useEffect(() => {
    const cellKey = `${Math.floor(biasPosition[0] / CELL_SCALE)},${Math.floor(biasPosition[2] / CELL_SCALE)}`;
    return sceneState.registerBeam({
      x: biasPosition[0],
      z: biasPosition[2],
      radius: radius + tube + 0.05,
      cellKey,
    });
  }, [biasPosition, radius, tube]);

  return (
    <group position={biasPosition}>
      {/* Glowing ring on the floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <torusGeometry args={[radius, tube, 8, 32]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={1.2}
          roughness={0.3}
        />
      </mesh>

      {/* 环中心小实心圆 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.021, 0]}>
        <circleGeometry args={[radius * 0.6, 24]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={0.9}
          roughness={0.4}
        />
      </mesh>

      {/* Vertical light beam */}
      {/* <mesh position={[0, height / 2, 0]}>
        <cylinderGeometry args={[radiusTop, radiusBottom, height, 16, 1, true]} />
        <meshStandardMaterial
          color="#ffffff"
          emissive="#ffffff"
          emissiveIntensity={0.6}
          transparent
          opacity={0.15}
          side={THREE.DoubleSide}
        />
      </mesh> */}

      {/* 粒子信封：悬浮在光柱顶部上方（墙顶以上，避免被迷宫墙遮挡），无浮动
          光柱进入相机前方视野 → 汇聚成信封；移出视野 → 散开
          宽度 = 地面发光环直径的一半（radiusBottom），与环呼应 */}
      {/* {envelope && (
        <EnvelopeLine
          position={[0, height + 0.6, 0]}
          size={radiusBottom}
          maxCount={3500}
        />
        <EnvelopeLine
          svgUrl='/envelope.svg'
        />
      )} */}
      {/* <EnvelopeLine
        size={0.075}
        position={[0, 0.25, 0]}
      /> */}
    </group>
  );
}

export default LightBeam;
