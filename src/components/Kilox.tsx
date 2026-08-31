import { Suspense, useEffect, useRef } from 'react';
// import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
// import { EnvelopeLine } from './EnvelopeLine2';
import {
  sceneState,
  useSceneBubble,
  type DescriptionId,
} from '../state/sceneStore';
import { SCENE_MODEL_LOAD_RADIUS } from '../constants/global';
import { useNearbyActive, useNormalizedModel } from '../hooks/useLazyModel';

const base = import.meta.env.BASE_URL;
const KILOX_URL = `${base}/models/kilox-90.glb`;

export interface KiloxProps {
  position: [number, number, number];
  size?: number;
  rotationY?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  label?: string;
  /** 场景对应的描述 id */
  descriptionId?: DescriptionId;
  /** 场景占用的道路单元格（列,行） */
  pathCells?: Array<{ c: number; r: number }>;
}

export function Kilox({
  position,
  size = 1,
  rotationY = 0,
  castShadow = true,
  receiveShadow = true,
  label,
  descriptionId = 'Kilox',
  pathCells,
}: KiloxProps) {
  const groupRef = useRef<THREE.Group>(null);
  // 懒加载：玩家靠近后才真正请求 kilox-90.glb（约 8MB）
  const active = useNearbyActive(groupRef, SCENE_MODEL_LOAD_RADIUS);

  // 注册场景道路格
  useEffect(() => {
    if (!pathCells || pathCells.length === 0) return;
    const keySet = new Set(pathCells.map(({ c, r }) => `${c},${r}`));
    sceneState.register({ id: descriptionId, pathCellKeys: keySet });
    return () => sceneState.unregister(descriptionId);
  }, [descriptionId, pathCells]);

  useSceneBubble(descriptionId);

  // kilox 动画：AnimationMixer 播放 clips（当前模型无动画，留作后续换模型用）
  // const kiloxMixerRef = useRef<THREE.AnimationMixer | null>(null);
  // useEffect(() => {
  //   if (!kilox.animations || kilox.animations.length === 0) return;
  //   const mixer = new THREE.AnimationMixer(kilox.clonedScene);
  //   const action = mixer.clipAction(kilox.animations[0]);
  //   action.reset().play();
  //   action.timeScale = 1;
  //   kiloxMixerRef.current = mixer;
  //   return () => {
  //     action.stop();
  //     mixer.uncacheAction(kilox.animations[0]);
  //     kiloxMixerRef.current = null;
  //   };
  // }, [kilox.clonedScene, kilox.animations]);

  // useFrame((_, delta) => {
  //   if (kiloxMixerRef.current) kiloxMixerRef.current.update(delta);
  // });

  return (
    <group ref={groupRef} position={position} rotation={[0, rotationY, 0]}>
      {/* 主模型 kilox（懒加载：靠近后才挂载下载） */}
      {active && (
        <Suspense fallback={null}>
          <KiloxModel size={size} castShadow={castShadow} receiveShadow={receiveShadow} />
        </Suspense>
      )}

      {/* {label && (
        <Text
          position={[-size / 2 - CELL_SCALE * 0.1, size * 0.25, 0]}
          fontSize={CELL_SCALE * 0.15}
          color="#ffcc33"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.02}
          outlineColor="#333333"
        >
          {label}
        </Text>
      )} */}

      {/* EnvelopeLine 粒子信封 */}
      {/* <EnvelopeLine
        position={[-0.02, 0.1, 0.4]}
      /> */}
    </group>
  );
}

/** 真正下载 + 挂载 glb 的内层组件（放在 Suspense 内，加载期间不影响其余场景） */
function KiloxModel({
  size,
  castShadow,
  receiveShadow,
}: {
  size: number;
  castShadow: boolean;
  receiveShadow: boolean;
}) {
  const kilox = useNormalizedModel(KILOX_URL, size, castShadow, receiveShadow);

  return (
    <primitive
      object={kilox.clonedScene}
      position={[0.0, 0.36, 0]}
      scale={kilox.normalizeScale * 1.35}
    />
  );
}

export default Kilox;
