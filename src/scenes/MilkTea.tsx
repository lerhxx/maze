import { Suspense, useRef } from 'react';
import * as THREE from 'three';
import {
  type DescriptionId,
} from '../state/sceneStore';
import { SCENE_MODEL_LOAD_RADIUS, modelUrl } from '../constants/global';
import { useNearbyActive, useNormalizedModel } from '../hooks/useLazyModel';

// const MILK_TEA_URL = modelUrl('milk-tea.glb');
const MILK_TEA_URL = modelUrl('amiba-95.glb');

export interface MilkTeaProps {
  position: [number, number, number];
  size?: number;
  rotationY?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  descriptionId?: DescriptionId;
  pathCells?: Array<{ c: number; r: number }>;
}

export function MilkTea({
  position,
  size = 1,
  rotationY = 0,
  castShadow = true,
  receiveShadow = true,
}: MilkTeaProps) {
  const groupRef = useRef<THREE.Group>(null);
  // 懒加载：玩家靠近后才真正请求 glb
  const active = useNearbyActive(groupRef, SCENE_MODEL_LOAD_RADIUS);

  return (
    <group
      ref={groupRef}
      position={[position[0], position[1] - 0.14, position[2]]}
      rotation={[0, rotationY, 0]}
    >
      {/* milk-tea（懒加载：靠近后才挂载下载） */}
      {active && (
        <Suspense fallback={null}>
          <MilkTeaModel size={size} castShadow={castShadow} receiveShadow={receiveShadow} />
        </Suspense>
      )}
    </group>
  );
}

/** 真正下载 + 挂载 glb 的内层组件（放在 Suspense 内，加载期间不影响其余场景） */
function MilkTeaModel({
  size,
  castShadow,
  receiveShadow,
}: {
  size: number;
  castShadow: boolean;
  receiveShadow: boolean;
}) {
  const milkTea = useNormalizedModel(MILK_TEA_URL, size, castShadow, receiveShadow);

  return (
    <primitive
      object={milkTea.clonedScene}
      position={[0, 0.3, 0]}
      scale={milkTea.normalizeScale}
    />
  );
}

export default MilkTea;
