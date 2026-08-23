import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, Text } from '@react-three/drei';
import * as THREE from 'three';
import { CELL_SCALE } from '../constants/global';
import { Envelope } from './Envelope';
import {
  sceneState,
  useSceneBubble,
  type DescriptionId,
} from '../state/sceneStore';

const ROBOT_URL = '/model/robot.glb';

export interface KiloxProps {
  position: [number, number, number];
  size?: number;
  rotationY?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  orbitRadius?: number;
  orbitSpeed?: number;
  bobAmplitude?: number;
  bobSpeed?: number;
  label?: string;
  /** 场景对应的描述 id */
  descriptionId?: DescriptionId;
  /** 场景占用的道路单元格（列,行） */
  pathCells?: Array<{ c: number; r: number }>;
}

/** 加载 glb 并归一化克隆场景 */
function useNormalizedScene(
  url: string,
  size: number,
  castShadow: boolean,
  receiveShadow: boolean,
): { clonedScene: THREE.Object3D; normalizeScale: number; offsetY: number } {
  const gltf = useGLTF(url);
  return useMemo(() => {
    const cloned = (gltf.scene as THREE.Object3D).clone(true) as THREE.Object3D;
    cloned.updateWorldMatrix(true, false);
    const box = new THREE.Box3().setFromObject(cloned);
    let scale = 1;
    let yOff = 0;
    if (!box.isEmpty()) {
      const s = new THREE.Vector3();
      box.getSize(s);
      const maxDim = Math.max(s.x, Math.max(s.y, s.z));
      if (maxDim > 0) scale = size / maxDim;
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
    return { clonedScene: cloned, normalizeScale: scale, offsetY: yOff };
  }, [gltf.scene, size, castShadow, receiveShadow]);
}

export function Kilox({
  position,
  size = 1,
  rotationY = 0,
  castShadow = true,
  receiveShadow = true,
  orbitRadius,
  orbitSpeed = 0.5,
  bobAmplitude,
  bobSpeed = 2,
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

  const showBubble = useSceneBubble(descriptionId);

  // robot: 归一化到 size 的 0.2
  const robotSize = size * 0.2;
  const robot = useNormalizedScene(ROBOT_URL, robotSize, castShadow, receiveShadow);

  const robotRef = useRef<THREE.Object3D>(null);

  // 轨道半径与浮动幅度
  const rOrbit = orbitRadius ?? size * 1.65;
  const rBob = bobAmplitude ?? size * 0.1;
  const robotBaseY = robot.offsetY - 0.35;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (robotRef.current) {
      const angle = t * orbitSpeed;
      // 上下浮动
      robotRef.current.position.y = robotBaseY + Math.sin(t * bobSpeed) * rBob;
      // 让 robot 朝向运动方向
      robotRef.current.rotation.y = -angle + Math.PI / 2;
    }
  });

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <group position={[0, 0, 0]}>
        <primitive
          ref={robotRef as unknown as React.Ref<THREE.Object3D>}
          object={robot.clonedScene}
          scale={robot.normalizeScale}
        />
      </group>

      {label && (
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
      )}

      {/* Envelope 放在（0.5, 0, 0.5）位置（相对于组件 size） */}
      <Envelope
        position={[0.5, 0, 0.5]}
        size={size * 0.35}
        animated
        showBubble={showBubble}
        castShadow={castShadow}
        receiveShadow={receiveShadow}
      />
    </group>
  );
}

export default Kilox;
