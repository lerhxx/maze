import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { sceneState } from '../state/sceneStore';

/** 距离检测节流：每 N 帧检测一次（避免每帧计算 + 触发 setState） */
const PROXIMITY_CHECK_INTERVAL = 10;

export interface NormalizedModel {
  clonedScene: THREE.Object3D;
  /** 把模型最大边长归一到 targetSize 所需的缩放 */
  normalizeScale: number;
  /** 底部对齐 y=0 所需的纵向偏移（未乘 scale 前的补偿量） */
  offsetY: number;
  animations: THREE.AnimationClip[];
}

/**
 * 加载 glb 并归一化：最大边长 -> targetSize，底部对齐 y=0。
 * 有动画时用 SkeletonUtils.clone 正确克隆骨架。
 *
 * 注意：内部通过 drei 的 useGLTF 加载（自带 DRACO / meshopt 解码 + 全局缓存），
 * 首次加载会 suspend，因此**调用方必须被 <Suspense> 包裹**，
 * 否则整个 Canvas 会被阻塞。
 */
export function useNormalizedModel(
  url: string,
  targetSize: number,
  castShadow: boolean,
  receiveShadow: boolean,
): NormalizedModel {
  const gltf = useGLTF(url);
  return useMemo(() => {
    // 有动画 → SkeletonUtils.clone 保留骨架绑定
    const cloned =
      gltf.animations && gltf.animations.length > 0
        ? (SkeletonUtils.clone(gltf.scene) as THREE.Object3D)
        : (gltf.scene as THREE.Object3D).clone(true);

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

    return {
      clonedScene: cloned,
      normalizeScale: scale,
      offsetY: yOff,
      animations: gltf.animations ?? [],
    };
  }, [gltf.scene, gltf.animations, targetSize, castShadow, receiveShadow]);
}

/**
 * 基于玩家距离的懒加载开关。
 *
 * 只有玩家走进 radius（世界单位，按 XZ 平面算）范围内才返回 true，
 * 一旦触发就保持 true（模型不会反复卸载/重载）。
 * 外层组件常驻挂载，真正下载 glb 的子组件通过 `{active && ...}` 控制挂载时机。
 */
export function useNearbyActive(
  ref: React.RefObject<THREE.Object3D | null>,
  radius: number,
  enabled = true,
): boolean {
  // 激活状态跟随组件实例（换迷宫时场景组件会随 key 变化重新挂载 → 自动重置）
  const [active, setActive] = useState(false);
  const activeRef = useRef(false);
  // 从 1 起计数：跳过首帧（此时 Player 还未写入 playerPos，坐标仍是原点，会误判）
  const tickRef = useRef(1);
  const worldPos = useRef(new THREE.Vector3());

  useFrame(() => {
    if (!enabled || activeRef.current) return;
    if (tickRef.current++ % PROXIMITY_CHECK_INTERVAL !== 0) return;

    const obj = ref.current;
    if (!obj) return;
    obj.getWorldPosition(worldPos.current);

    const dx = sceneState.playerPos.x - worldPos.current.x;
    const dz = sceneState.playerPos.z - worldPos.current.z;
    if (dx * dx + dz * dz <= radius * radius) {
      activeRef.current = true;
      setActive(true);
    }
  });

  return active;
}
