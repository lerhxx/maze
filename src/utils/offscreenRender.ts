import * as THREE from 'three';
import type { Camera, Scene, WebGLRenderer } from 'three';

/**
 * 离屏渲染（WebGLRenderTarget）工具。
 *
 * 渲染分两趟（two-pass）：
 *  1) 把场景渲进 RenderTarget A（线性色空间 + 半浮点以保留 HDR，可超采样）；
 *     three 渲染到 RenderTarget 时**不会**做 tone mapping，也不会做输出色空间编码，
 *     所以 A 里是「原始线性颜色」，直接读出来会比屏幕暗；
 *  2) 用一个全屏四边形采样 A，手动补上 tone mapping + linear→sRGB 编码，
 *     渲进 RenderTarget B（8bit，输出尺寸），再 readRenderTargetPixels 读回 CPU，
 *     翻转 Y 后写进 2D canvas。
 *
 * 这样导出的 PNG 与屏幕所见一致，且不受 canvas 尺寸限制。
 */

/** 离屏渲染所需的最小上下文，由 <Canvas> 内部的组件注册进来 */
export interface RendererContext {
  gl: WebGLRenderer;
  scene: Scene;
  camera: Camera;
}

/** 渲染目标像素上限（防止在高分屏上申请过大显存） */
const MAX_RENDER_PIXELS = 16_000_000;

let rendererContext: RendererContext | null = null;

/** 注册 / 注销渲染上下文（在 Canvas 内部调用） */
export function setRendererContext(context: RendererContext | null) {
  rendererContext = context;
}

/** 获取当前渲染上下文 */
export function getRendererContext(): RendererContext | null {
  return rendererContext;
}

export interface OffscreenCaptureOptions {
  /** 输出图相对当前 drawingBuffer 的倍数，默认 1（= 屏幕物理像素尺寸） */
  scale?: number;
  /** 内部超采样倍数，渲染后缩放回输出尺寸实现抗锯齿，默认 2 */
  supersample?: number;
  /** MSAA 采样数，默认 0（超采样已提供抗锯齿，需要时可手动开启） */
  samples?: number;
  /** 文件名（不含扩展名），默认 maze-<时间戳> */
  filename?: string;
  /** 是否保留 alpha 通道，默认 false（导出不透明图片） */
  alpha?: boolean;
}

export interface OffscreenCaptureResult {
  canvas: HTMLCanvasElement;
  dataUrl: string;
  blob: Blob;
  width: number;
  height: number;
  /** 完整文件名，含 .png */
  filename: string;
}

const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/** 第二趟：tone mapping + sRGB 编码（等价于 three 的 tonemapping_fragment / colorspace_fragment） */
const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uExposure;
uniform int uToneMapping;

varying vec2 vUv;

vec3 toneMapLinear( vec3 color ) {
  return clamp( uExposure * color, 0.0, 1.0 );
}

vec3 toneMapReinhard( vec3 color ) {
  color *= uExposure;
  return clamp( color / ( vec3( 1.0 ) + color ), 0.0, 1.0 );
}

vec3 toneMapCineon( vec3 color ) {
  color *= uExposure;
  color = max( vec3( 0.0 ), color - 0.004 );
  return pow( ( color * ( 6.2 * color + 0.5 ) ) / ( color * ( 6.2 * color + 1.7 ) + 0.06 ), vec3( 2.2 ) );
}

vec3 RRTAndODTFit( vec3 v ) {
  vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
  vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
  return a / b;
}

vec3 toneMapACESFilmic( vec3 color ) {
  const mat3 ACESInputMat = mat3(
    vec3( 0.59719, 0.07600, 0.02840 ),
    vec3( 0.35458, 0.90834, 0.13383 ),
    vec3( 0.04823, 0.01566, 0.83777 )
  );
  const mat3 ACESOutputMat = mat3(
    vec3(  1.60475, -0.10208, -0.00327 ),
    vec3( -0.53108,  1.10813, -0.07276 ),
    vec3( -0.07367, -0.00605,  1.07602 )
  );
  color *= uExposure / 0.6;
  color = ACESInputMat * color;
  color = RRTAndODTFit( color );
  color = ACESOutputMat * color;
  return clamp( color, 0.0, 1.0 );
}

vec3 linearToSRGB( vec3 color ) {
  color = max( color, vec3( 0.0 ) );
  return mix(
    pow( color, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ),
    color * 12.92,
    vec3( lessThanEqual( color, vec3( 0.0031308 ) ) )
  );
}

void main() {
  vec4 texel = texture2D( tDiffuse, vUv );
  vec3 color = texel.rgb;

  if ( uToneMapping == 1 ) {
    color = toneMapLinear( color );
  } else if ( uToneMapping == 2 ) {
    color = toneMapReinhard( color );
  } else if ( uToneMapping == 3 ) {
    color = toneMapCineon( color );
  } else if ( uToneMapping == 4 ) {
    color = toneMapACESFilmic( color );
  }

  gl_FragColor = vec4( clamp( linearToSRGB( color ), 0.0, 1.0 ), texel.a );
}
`;

/** three 的 toneMapping 常量 → 着色器里的模式编号 */
function toneMappingToMode(toneMapping: THREE.ToneMapping): number {
  switch (toneMapping) {
    case THREE.LinearToneMapping:
      return 1;
    case THREE.ReinhardToneMapping:
      return 2;
    case THREE.CineonToneMapping:
      return 3;
    case THREE.ACESFilmicToneMapping:
      return 4;
    case THREE.AgXToneMapping:
    case THREE.NeutralToneMapping:
      console.warn('[offscreenRender] 暂不支持该 tone mapping，已回退为 ACESFilmic');
      return 4;
    default:
      return 0;
  }
}

function supportsHalfFloatRenderTarget(gl: WebGLRenderer): boolean {
  return (
    gl.extensions.has('EXT_color_buffer_half_float') ||
    gl.extensions.has('EXT_color_buffer_float')
  );
}

function createTimestampName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `maze-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/** 在保持宽高比的前提下，把尺寸收缩到 maxSize / 像素上限以内 */
function fitSize(width: number, height: number, maxSize: number, maxPixels: number) {
  let w = Math.max(1, Math.round(width));
  let h = Math.max(1, Math.round(height));

  const sizeFit = Math.min(1, maxSize / Math.max(w, h));
  if (sizeFit < 1) {
    w = Math.max(1, Math.floor(w * sizeFit));
    h = Math.max(1, Math.floor(h * sizeFit));
  }

  const pixelFit = Math.sqrt(maxPixels / (w * h));
  if (pixelFit < 1) {
    w = Math.max(1, Math.floor(w * pixelFit));
    h = Math.max(1, Math.floor(h * pixelFit));
  }

  return { width: w, height: h };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob 返回空结果'));
    }, 'image/png');
  });
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // 延迟释放，避免下载尚未开始 URL 就失效
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function requireContext(): RendererContext {
  if (!rendererContext) {
    throw new Error('尚未注册渲染上下文：请在 <Canvas> 内部调用 setRendererContext');
  }
  return rendererContext;
}

/**
 * 用 WebGLRenderTarget 离屏渲染当前场景，返回一张 2D canvas（同步、耗时）。
 */
export function renderOffscreenToCanvas(
  options: OffscreenCaptureOptions = {},
): { canvas: HTMLCanvasElement; dataUrl: string; width: number; height: number } {
  const { gl, scene, camera } = requireContext();
  const scale = Math.max(0.1, options.scale ?? 1);
  const supersample = Math.max(1, options.supersample ?? 2);
  const keepAlpha = options.alpha ?? false;

  const bufferSize = gl.getDrawingBufferSize(new THREE.Vector2());
  const maxSize = gl.capabilities.maxTextureSize;

  // 输出尺寸
  const out = fitSize(bufferSize.x * scale, bufferSize.y * scale, maxSize, MAX_RENDER_PIXELS);
  // 内部渲染尺寸（超采样，第二趟缩放回输出尺寸即得到 2×2 盒式抗锯齿）
  const render = fitSize(
    out.width * supersample,
    out.height * supersample,
    maxSize,
    MAX_RENDER_PIXELS,
  );

  const samples = Math.max(0, Math.min(options.samples ?? 0, gl.capabilities.maxSamples));

  // 第一趟：线性 HDR 场景
  const sceneTarget = new THREE.WebGLRenderTarget(render.width, render.height, {
    type: supportsHalfFloatRenderTarget(gl) ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
    samples,
  });

  // 第二趟：tone mapping + sRGB 编码后的 8bit 结果（缩放回输出尺寸）
  const outputTarget = new THREE.WebGLRenderTarget(out.width, out.height, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });

  const quadGeometry = new THREE.PlaneGeometry(2, 2);
  const quadMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: sceneTarget.texture },
      uExposure: { value: gl.toneMappingExposure },
      uToneMapping: { value: toneMappingToMode(gl.toneMapping) },
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(quadGeometry, quadMaterial);
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCamera = new THREE.Camera();

  const pixels = new Uint8Array(out.width * out.height * 4);

  // 保存 / 恢复渲染器状态，避免影响 r3f 的下一帧
  const prevTarget = gl.getRenderTarget();
  const prevActiveCubeFace = gl.getActiveCubeFace();
  const prevActiveMipmapLevel = gl.getActiveMipmapLevel();
  const prevScissorTest = gl.getScissorTest();
  const prevViewport = gl.getViewport(new THREE.Vector4());

  try {
    gl.setRenderTarget(sceneTarget);
    gl.render(scene, camera);

    gl.setRenderTarget(outputTarget);
    gl.render(quadScene, quadCamera);

    gl.readRenderTargetPixels(outputTarget, 0, 0, out.width, out.height, pixels);
  } finally {
    gl.setRenderTarget(prevTarget, prevActiveCubeFace, prevActiveMipmapLevel);
    gl.setScissorTest(prevScissorTest);
    if (prevTarget === null) gl.setViewport(prevViewport);

    sceneTarget.dispose();
    outputTarget.dispose();
    quadGeometry.dispose();
    quadMaterial.dispose();
  }

  // WebGL 原点在左下，canvas 原点在左上：需要翻转 Y
  const imageData = new ImageData(out.width, out.height);
  const data = imageData.data;
  const rowBytes = out.width * 4;
  for (let y = 0; y < out.height; y++) {
    const src = (out.height - 1 - y) * rowBytes;
    data.set(pixels.subarray(src, src + rowBytes), y * rowBytes);
  }
  if (!keepAlpha) {
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
  }

  const canvas = document.createElement('canvas');
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建 2D canvas 上下文');
  ctx.putImageData(imageData, 0, 0);

  return {
    canvas,
    dataUrl: canvas.toDataURL('image/png'),
    width: out.width,
    height: out.height,
  };
}

/**
 * 离屏渲染 → 生成 PNG → 触发下载。
 */
export async function captureAndDownload(
  options: OffscreenCaptureOptions = {},
): Promise<OffscreenCaptureResult> {
  const { canvas, dataUrl, width, height } = renderOffscreenToCanvas(options);
  const filename = `${options.filename ?? createTimestampName()}.png`;
  const blob = await canvasToBlob(canvas);
  downloadBlob(blob, filename);
  return { canvas, dataUrl, blob, width, height, filename };
}
