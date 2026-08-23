import { useEffect, useMemo } from 'react';
import { useGLTF, Text } from '@react-three/drei';
import * as THREE from 'three';
import { CELL_SCALE } from '../constants/global';
import { Envelope } from './Envelope';
import {
  sceneState,
  useSceneBubble,
  type DescriptionId,
} from '../state/sceneStore';

const HUAWEI_URL = '/model/huawei.glb';

export interface HuaweiProps {
  position: [number, number, number];
  size?: number;
  rotationY?: number;
  castShadow?: boolean;
  receiveShadow?: boolean;
  label?: string;
  descriptionId?: DescriptionId;
  pathCells?: Array<{ c: number; r: number }>;
}

export function Huawei({
  position,
  size = 1,
  rotationY = 0,
  castShadow = true,
  receiveShadow = true,
  label,
  descriptionId = 'Huawei',
  pathCells,
}: HuaweiProps) {
  useEffect(() => {
    if (!pathCells || pathCells.length === 0) return;
    const keySet = new Set(pathCells.map(({ c, r }) => `${c},${r}`));
    sceneState.register({ id: descriptionId, pathCellKeys: keySet });
    return () => sceneState.unregister(descriptionId);
  }, [descriptionId, pathCells]);

  const showBubble = useSceneBubble(descriptionId);

  const gltf = useGLTF(HUAWEI_URL);

  const { clonedScene, normalizeScale, offsetY } = useMemo<{
    clonedScene: THREE.Object3D;
    normalizeScale: number;
    offsetY: number;
  }>(() => {
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

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <primitive
        object={clonedScene}
        position={[0, offsetY, 0]}
        scale={normalizeScale}
      />
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

export default Huawei;
