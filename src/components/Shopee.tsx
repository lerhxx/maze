import { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

const SHOPEE_URL = '/model/shopee.glb';

/**
 * Shopee: 加载 shopee.glb 并归一化到指定尺寸，放置到指定位置。
 *
 * Props:
 *   - position: [x, y, z] — 世界坐标
 *   - size?: number — 归一化后的最大边长（默认 1）
 *   - rotationY?: number — 绕 Y 轴旋转（弧度）
 *   - castShadow? / receiveShadow?: boolean
 */
export interface ShopeeProps {
  position: [number, number, number];
  size?: number;
  rotationY?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export function Shopee({
  position,
  size = 1,
  rotationY = 0,
  castShadow = true,
  receiveShadow = true,
}: ShopeeProps) {
  const gltf = useGLTF(SHOPEE_URL);

  const { clonedScene, normalizeScale, offsetY } = useMemo<{
    clonedScene: THREE.Object3D;
    normalizeScale: number;
    offsetY: number;
  }>(() => {
    // 深克隆场景，避免修改原始 gltf 缓存
    const cloned = (gltf.scene as THREE.Object3D).clone(true) as THREE.Object3D;
    // 计算包围盒
    cloned.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(cloned);
    let scale = 1;
    let yOff = 0;
    if (!box.isEmpty()) {
      const s = new THREE.Vector3();
      box.getSize(s);
      const maxDim = Math.max(s.x, Math.max(s.y, s.z));
      if (maxDim > 0) scale = size / maxDim;
      // 底部贴 y=0
      yOff = -box.min.y * scale;
    }
    // 遍历设置阴影
    cloned.traverse((obj) => {
      const maybeMesh = obj as unknown as { isMesh?: boolean };
      if (maybeMesh.isMesh) {
        const m = obj as unknown as THREE.Mesh;
        m.castShadow = castShadow;
        m.receiveShadow = receiveShadow;
      }
    });
    return { clonedScene: cloned, normalizeScale: scale, offsetY: yOff };
  }, [gltf.scene, size, castShadow, receiveShadow]);

  return (
    <primitive
      object={clonedScene}
      position={[position[0], position[1] + offsetY, position[2]]}
      rotation={[0, rotationY, 0]}
      scale={normalizeScale}
    />
  );
}

export default Shopee;
