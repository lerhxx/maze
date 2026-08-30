import { useMemo, } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  type DescriptionId,
} from '../state/sceneStore';

const base = import.meta.env.BASE_URL;
// const MILK_TEA_URL = `${base}/models/milk-tea.glb`;
const MILK_TEA_URL = `${base}/models/amiba-95.glb`;

export interface MilkTeaProps {
  position: [number, number, number];
  size?: number;
  rotationY?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  descriptionId?: DescriptionId;
  pathCells?: Array<{ c: number; r: number }>;
}

/** 加载 glb 并归一化：最大边长 -> targetSize，底部对齐 y=0
 *  有动画时用 SkeletonUtils.clone 正确克隆骨架 */
function useNormalizedModel(
  url: string,
  targetSize: number,
  castShadow: boolean,
  receiveShadow: boolean,
): { clonedScene: THREE.Object3D; normalizeScale: number; offsetY: number; animations: THREE.AnimationClip[] } {
  const gltf = useGLTF(url);
  return useMemo(() => {
    // 有动画 → SkeletonUtils.clone 保留骨架绑定
    const cloned = gltf.animations && gltf.animations.length > 0
      ? SkeletonUtils.clone(gltf.scene) as THREE.Object3D
      : (gltf.scene as THREE.Object3D).clone(true) as THREE.Object3D;
    cloned.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(cloned);
    let scale = 1.5;
    let yOff = 0;
    if (!box.isEmpty()) {
      const s = new THREE.Vector3();
      box.getSize(s);
      const maxDim = Math.max(s.x, Math.max(s.y, s.z));
      if (maxDim > 0) scale = targetSize / maxDim;
      yOff = -box.min.y * scale;
    }
    cloned.traverse((obj) => {
      const maybeMesh = obj as unknown as { isMesh?: boolean };
      if (maybeMesh.isMesh) {
        const m = obj as unknown as THREE.Mesh;
        m.castShadow = castShadow;
        m.receiveShadow = receiveShadow;
      }
    });
    return { clonedScene: cloned, normalizeScale: scale, offsetY: yOff, animations: gltf.animations ?? [] };
  }, [gltf.scene, gltf.animations, targetSize, castShadow, receiveShadow]);
}

export function MilkTea({
  position,
  size = 1,
  rotationY = 0,
  castShadow = true,
  receiveShadow = true,
}: MilkTeaProps) {

  // 主模型 milk-tea：保留原有的 0.3 缩放 + offsetY=0.35
  const milkTea = useNormalizedModel(MILK_TEA_URL, size, castShadow, receiveShadow);

  return (
    <group position={[position[0], position[1] - 0.14, position[2]]} rotation={[0, rotationY, 0]}>
      {/* milk-tea */}
      <primitive
        object={milkTea.clonedScene}
        position={[0, 0.3, 0]}
        scale={milkTea.normalizeScale}
      />
    </group>
  );
}

export default MilkTea;
