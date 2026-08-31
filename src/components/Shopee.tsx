import { Suspense, useEffect, useRef } from 'react';
// import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
// import { EnvelopeLine } from './EnvelopeLine2';
import {
  sceneState,
  useSceneBubble,
  type DescriptionId,
} from '../state/sceneStore';
import { SCENE_MODEL_LOAD_RADIUS, modelUrl } from '../constants/global';
import { useNearbyActive, useNormalizedModel } from '../hooks/useLazyModel';

// const SHOPEE_URL = modelUrl('shopee.glb');
const SHOPEE_URL = modelUrl('shopee-scene-90.glb');
// const SHEBI_URL = modelUrl('shebi.glb');
// const HEBI_URL = modelUrl('hebi.glb');

export interface ShopeeProps {
  position: [number, number, number];
  size?: number;
  rotationY?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  descriptionId?: DescriptionId;
  pathCells?: Array<{ c: number; r: number }>;
}

export function Shopee({
  position,
  size = 1,
  rotationY = 0,
  castShadow = true,
  receiveShadow = true,
  descriptionId = 'Shopee',
  pathCells,
}: ShopeeProps) {
  const groupRef = useRef<THREE.Group>(null);
  // 懒加载：玩家靠近后才真正请求 shopee-scene-90.glb（约 8MB）
  const active = useNearbyActive(groupRef, SCENE_MODEL_LOAD_RADIUS);

  useEffect(() => {
    if (!pathCells || pathCells.length === 0) return;
    const keySet = new Set(pathCells.map(({ c, r }) => `${c},${r}`));
    sceneState.register({ id: descriptionId, pathCellKeys: keySet });
    return () => sceneState.unregister(descriptionId);
  }, [descriptionId, pathCells]);

  useSceneBubble(descriptionId);

  // shebi / hebi：归一化到 size 的 0.35，底部贴地
  // const shebi = useNormalizedModel(SHEBI_URL, size * 0.35, castShadow, receiveShadow);
  // const hebi = useNormalizedModel(HEBI_URL, size * 0.35, castShadow, receiveShadow);

  // shebi 动画：AnimationMixer 播放 clips
  // const shebiMixerRef = useRef<THREE.AnimationMixer | null>(null);
  // useEffect(() => {
  //   if (!shebi.animations || shebi.animations.length === 0) return;
  //   const mixer = new THREE.AnimationMixer(shebi.clonedScene);
  //   const action = mixer.clipAction(shebi.animations[0]);
  //   action.reset().play();
  //   action.timeScale = 1;
  //   shebiMixerRef.current = mixer;
  //   return () => {
  //     action.stop();
  //     mixer.uncacheAction(shebi.animations[0]);
  //     shebiMixerRef.current = null;
  //   };
  // }, [shebi.clonedScene, shebi.animations]);

  // hebi 动画：AnimationMixer 播放 clips
  // const hebiMixerRef = useRef<THREE.AnimationMixer | null>(null);
  // useEffect(() => {
  //   if (!hebi.animations || hebi.animations.length === 0) return;
  //   const mixer = new THREE.AnimationMixer(hebi.clonedScene);
  //   const action = mixer.clipAction(hebi.animations[0]);
  //   action.reset().play();
  //   action.timeScale = 1;
  //   hebiMixerRef.current = mixer;
  //   return () => {
  //     action.stop();
  //     mixer.uncacheAction(hebi.animations[0]);
  //     hebiMixerRef.current = null;
  //   };
  // }, [hebi.clonedScene, hebi.animations]);

  // useFrame((_, delta) => {
  //   if (shebiMixerRef.current) shebiMixerRef.current.update(delta);
  //   if (hebiMixerRef.current) hebiMixerRef.current.update(delta);
  // });

  return (
    <group ref={groupRef} position={position} rotation={[0, rotationY, 0]}>
      {/* 主 shopee-logo（懒加载：靠近后才挂载下载） */}
      {active && (
        <Suspense fallback={null}>
          <ShopeeModel size={size} castShadow={castShadow} receiveShadow={receiveShadow} />
        </Suspense>
      )}

      {/* shebi：左侧（减小 X 偏移确保在墙格内） */}
      {/* <primitive
        object={shebi.clonedScene}
        position={[-size * 0.45, shebi.offsetY + 0.05, 0.15]}
        scale={shebi.normalizeScale * 0.01}
      /> */}

      {/* hebi：右侧 */}
      {/* <primitive
        object={hebi.clonedScene}
        position={[size * 0.4, hebi.offsetY + 0.05, 0.1]}
        scale={hebi.normalizeScale * 0.01}
      /> */}

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

      {/* <EnvelopeLine
        position={[-0.02, 0.1, 0.5]}
      /> */}
    </group>
  );
}

/** 真正下载 + 挂载 glb 的内层组件（放在 Suspense 内，加载期间不影响其余场景） */
function ShopeeModel({
  size,
  castShadow,
  receiveShadow,
}: {
  size: number;
  castShadow: boolean;
  receiveShadow: boolean;
}) {
  const shopee = useNormalizedModel(SHOPEE_URL, size, castShadow, receiveShadow);

  return (
    <primitive
      object={shopee.clonedScene}
      position={[0.0, 0.32, 0.01]}
      scale={shopee.normalizeScale * 1.38}
    />
  );
}

export default Shopee;
