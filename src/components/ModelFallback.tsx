import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/**
 * ModelFallback：模型（glb）懒加载期间的 3D 占位体。
 *
 * 用法：放在 <Suspense fallback={...}> 上，模型下载完成前占位，
 * 下载完成后由 Suspense 自动卸载，不会残留在场景里。
 *
 * 视觉参考 ThreeJS-practice 的 lightShading35：
 *   - 顶点着色器只做 MVP 变换（与该 lesson 一致）
 *   - 片元着色器 = uColor × 环境光（ambientLight(color, intensity)）+ 边缘光
 * 在其基础上加了脉动与旋转，用来表达「正在加载」。
 */

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    // 参考 lightShading35：只做 mvp 变换，额外输出视空间法线/视线用于边缘光
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3  uColor;
  uniform float uTime;
  uniform float uOpacity;

  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 normal = normalize(vNormal);
    vec3 viewDir = normalize(vViewPosition);

    // 环境光（lightShading35 的 ambientLight(vec3(1.0), 0.2)）+ 一盏固定方向光
    vec3 light = vec3(1.0) * 0.2;
    float diffuse = max(dot(normal, normalize(vec3(0.45, 0.8, 1.0))), 0.0);
    light += diffuse * 0.55;

    vec3 color = uColor * light;

    // 边缘光：勾出体积轮廓，透明占位体才不会糊成一团
    float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 2.5);
    color += uColor * fresnel * 1.6;

    // 呼吸脉动
    float pulse = 0.78 + 0.22 * sin(uTime * 2.4);

    gl_FragColor = vec4(color * pulse, uOpacity * mix(0.45, 1.0, fresnel) * pulse);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface ModelFallbackProps {
  /** 与场景模型的 size 对齐（模型最大边长归一化后的尺寸，通常 1 格 = 1） */
  size?: number;
  /** 占位体主色（默认 lightShading35 的 #78c1ff） */
  color?: string;
  /** 相对父 group 的偏移，默认浮在格子中心偏上 */
  position?: [number, number, number];
  /** 自转角速度（弧度/秒） */
  speed?: number;
}

export function ModelFallback({
  size = 1,
  color = '#78c1ff',
  position,
  speed = 0.6,
}: ModelFallbackProps) {
  const groupRef = useRef<THREE.Group>(null);

  const uniforms = useMemo(
    () => ({
      uColor: { value: new THREE.Color(color) },
      uTime: { value: 0 },
      uOpacity: { value: 0.9 },
    }),
    [color],
  );

  const baseY = position ? position[1] : size * 0.75;

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    const u = uniforms as unknown as {
      uTime: { value: number };
    };
    u.uTime.value = t;

    const g = groupRef.current;
    if (!g) return;
    g.rotation.y += delta * speed;
    g.rotation.x = Math.sin(t * 0.5) * 0.22;
    g.position.y = baseY + Math.sin(t * 1.6) * size * 0.04;
  });

  const px = position ? position[0] : 0;
  const pz = position ? position[2] : 0;

  return (
    <group ref={groupRef} position={[px, baseY, pz]}>
      {/* 主体：环面纽结（对应 lightShading35 的 torusKnot） */}
      <mesh>
        <sphereGeometry args={[size * 0.45, 96, 12]} />
        <shaderMaterial
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* 外壳：线框球（对应 lightShading35 的 sphere），暗示模型的体积范围 */}
      <mesh>
        <icosahedronGeometry args={[size * 0.62, 1]} />
        <meshBasicMaterial
          color={color}
          wireframe
          transparent
          opacity={0.18}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export default ModelFallback;
