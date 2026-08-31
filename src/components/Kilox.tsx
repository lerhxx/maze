import { useEffect, useMemo } from 'react';
// import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
// import { CELL_SCALE } from '../constants/global';
// import { EnvelopeLine } from './EnvelopeLine2';
import {
  sceneState,
  useSceneBubble,
  type DescriptionId,
} from '../state/sceneStore';

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
    let scale = 1;
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
  // 注册场景道路格
  useEffect(() => {
    if (!pathCells || pathCells.length === 0) return;
    const keySet = new Set(pathCells.map(({ c, r }) => `${c},${r}`));
    sceneState.register({ id: descriptionId, pathCellKeys: keySet });
    return () => sceneState.unregister(descriptionId);
  }, [descriptionId, pathCells]);

  useSceneBubble(descriptionId);

  // 主模型 kilox：与 Shopee 一致，归一化到 size 并放大悬浮展示
  const kilox = useNormalizedModel(KILOX_URL, size, castShadow, receiveShadow);

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
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 主模型 kilox */}
      <primitive
        object={kilox.clonedScene}
        position={[0.0, 0.36, 0]}
        scale={kilox.normalizeScale * 1.35}
      />

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

export default Kilox;
