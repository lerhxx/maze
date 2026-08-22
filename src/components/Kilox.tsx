import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';

const FACTORY_URL = '/model/factory.glb';
const ROBOT_URL = '/model/robot.glb';

/**
 * Killox: 加载 factory.glb 和 robot.glb。
 * factory 居中展示，robot 围绕 factory 慢转 + 上下轻微浮动。
 *
 * Props:
 *   - position: [x, y, z] — 世界坐标
 *   - size?: number — factory 归一化后的最大边长（默认 1）
 *   - rotationY?: number — 整体绕 Y 轴旋转（弧度）
 *   - castShadow? / receiveShadow?: boolean
 *   - orbitRadius?: number — robot 轨道半径（默认 = size * 0.6）
 *   - orbitSpeed?: number — 公转速度（默认 0.5 rad/s）
 *   - bobAmplitude?: number — 上下浮动幅度（默认 size * 0.1）
 *   - bobSpeed?: number — 浮动速度（默认 2 rad/s）
 */
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
}: KiloxProps) {
  // factory: 居中展示，归一化到 size
  const factory = useNormalizedScene(FACTORY_URL, size, castShadow, receiveShadow);

  // robot: 归一化到 size 的 0.3
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
      // 在 XZ 平面绕中心做圆周运动
      robotRef.current.position.x = Math.cos(angle) * rOrbit;
      robotRef.current.position.z = Math.sin(angle) * rOrbit;
      // 上下浮动
      robotRef.current.position.y = robotBaseY + Math.sin(t * bobSpeed) * rBob;
      // 让 robot 朝向运动方向
      robotRef.current.rotation.y = -angle + Math.PI / 2;
    }
  });

  return (
    <group
      position={[position[0], position[1] + factory.offsetY, position[2]]}
      rotation={[0, rotationY, 0]}
      scale={factory.normalizeScale}
    >
      {/* factory 居中 */}
      <primitive object={factory.clonedScene} />

      {/* robot 围绕 factory 运动（scale 补偿 factory 缩放） */}
      <group ref={robotRef} scale={1 / factory.normalizeScale}>
        <primitive
          object={robot.clonedScene}
          scale={robot.normalizeScale}
        />
      </group>
    </group>
  );
}

export default Kilox;
