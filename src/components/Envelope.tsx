import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF, Html } from '@react-three/drei';
import * as THREE from 'three';

const ENVELOPE_URL = '/model/envelope.glb';

export interface EnvelopeProps {
  /** 世界坐标 */
  position: [number, number, number];
  /** 归一化尺寸（最大边长） */
  size?: number;
  /** 绕 Y 轴旋转 */
  rotationY?: number;
  /** 是否开启动画（上下浮动 + 自转） */
  animated?: boolean;
  /** 气泡是否可见（玩家在对应道路格上时 true） */
  showBubble?: boolean;
  /** 阴影 */
  castShadow?: boolean;
  receiveShadow?: boolean;
}

/**
 * Envelope：加载 envelope.glb。
 * - 支持位置/尺寸/旋转/动画
 * - 当 showBubble 为 true 时，右上角显示 Html 气泡框，内容为 'E'
 */
export function Envelope({
  position,
  size = 0.3,
  rotationY = 0,
  animated = true,
  showBubble = false,
  castShadow = true,
  receiveShadow = true,
}: EnvelopeProps) {
  const gltf = useGLTF(ENVELOPE_URL);

  const { clonedScene, normalizeScale, offsetY } = useMemo(() => {
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

  const groupRef = useRef<THREE.Group>(null);

  // 上下浮动 + 缓慢自转
  useFrame((state) => {
    if (!groupRef.current || !animated) return;
    const t = state.clock.elapsedTime;
    groupRef.current.position.y = yOffRef.current + Math.sin(t * 2) * size * 0.15;
    groupRef.current.rotation.y = baseRotRef.current + Math.sin(t * 0.6) * 0.15;
  });

  const yOffRef = useRef(0);
  const baseRotRef = useRef(0);
  yOffRef.current = offsetY;
  baseRotRef.current = rotationY;

  // 气泡尺寸（根据 size 自适应）
  const bubbleSize = Math.max(0.22, size * 0.8);

  return (
    <group position={position}>
      <group ref={groupRef} scale={normalizeScale}>
        <primitive object={clonedScene} />
      </group>

      {/* 右上角气泡框：纯 HTML 元素，背景 bubble.png，文字 E */}
      {showBubble && (
        <Html
          transform
          occlude
          distanceFactor={3}
          position={[size * 0.6, size * 1.0, -size * 0.2]}
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              position: 'relative',
              width: 64,
              height: 64,
              backgroundImage: 'url(/bubble.png)',
              backgroundSize: '100% 100%',
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'center',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              filter: 'drop-shadow(0 3px 6px rgba(0,0,0,0.35))',
              userSelect: 'none',
            }}
          >
            <div
              style={{
                fontWeight: 900,
                fontSize: 26,
                color: '#8a4a00',
                fontFamily:
                  '"PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
                textShadow: '0 1px 2px rgba(255,255,255,0.8)',
                marginLeft: -2,
                marginTop: -4,
              }}
            >
              E
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

export default Envelope;
