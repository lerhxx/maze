import { Suspense, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { SCENE_MODEL_LOAD_RADIUS, modelUrl } from '../constants/global';
// import { EnvelopeLine } from './EnvelopeLine2';
import {
  sceneState,
  useSceneBubble,
  type DescriptionId,
} from '../state/sceneStore';
import { useNearbyActive, useNormalizedModel } from '../hooks/useLazyModel';
import { ModelFallback } from './ModelFallback';

// const HUAWEI_URL = `${import.meta.env.BASE_URL}/models/huawei.glb`;
const HUAWEI_URL = modelUrl('huawei-scene-col-75.glb');

export interface HuaweiProps {
  position: [number, number, number];
  size?: number;
  rotationY?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  descriptionId?: DescriptionId;
  pathCells?: Array<{ c: number; r: number }>;
}

export function Huawei({
  position,
  size = 1,
  rotationY = 0,
  castShadow = true,
  receiveShadow = true,
  descriptionId = 'Huawei',
  pathCells,
}: HuaweiProps) {
  const groupRef = useRef<THREE.Group>(null);
  // 懒加载：玩家靠近后才真正请求 huawei-scene-90.glb（约 8MB）
  const active = useNearbyActive(groupRef, SCENE_MODEL_LOAD_RADIUS);

  useEffect(() => {
    if (!pathCells || pathCells.length === 0) return;
    const keySet = new Set(pathCells.map(({ c, r }) => `${c},${r}`));
    sceneState.register({ id: descriptionId, pathCellKeys: keySet });
    return () => sceneState.unregister(descriptionId);
  }, [descriptionId, pathCells]);

  useSceneBubble(descriptionId);

  return (
    <group
      ref={groupRef}
      position={[position[0], position[1] - 0.0, position[2] + 0.0]}
      rotation={[0, rotationY, 0]}
    >
      {/* 主模型（懒加载：靠近后才挂载下载） */}
      {active && (
        <Suspense fallback={<ModelFallback size={size} />}>
          <HuaweiModel size={size} castShadow={castShadow} receiveShadow={receiveShadow} />
        </Suspense>
      )}

      {/* <EnvelopeLine
        position={[0, 0.1, 0.5]}
      /> */}

    </group>
  );
}

/** 真正下载 + 挂载 glb 的内层组件（放在 Suspense 内，加载期间不影响其余场景） */
function HuaweiModel({
  size,
  castShadow,
  receiveShadow,
}: {
  size: number;
  castShadow: boolean;
  receiveShadow: boolean;
}) {
  const huawei = useNormalizedModel(HUAWEI_URL, size, castShadow, receiveShadow);

  return (
    <primitive
      object={huawei.clonedScene}
      position={[-0.005, huawei.offsetY + 0.065, 0]}
      scale={huawei.normalizeScale * 1.41}
    />
  );
}

export default Huawei;
