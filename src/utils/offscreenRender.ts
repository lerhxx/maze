import * as THREE from 'three';
import type { Camera, Scene, WebGLRenderer } from 'three';

/**
 * 离屏渲染（WebGLRenderTarget）工具。
 *
 * 关键点：three 渲染到 RenderTarget 时会**跳过**两件事（见 WebGLPrograms 源码，
 * 只有 `currentRenderTarget === null` 才生效）：
 *   1. tone mapping
 *   2. 输出色空间编码（linear → sRGB）
 * 所以直接把 RT 里的颜色读出来会明显偏暗。
 *
 * 但也不能在后期 pass 里对「整幅图」补 tone mapping——three 的 tone mapping 是
 * **逐材质在片元着色器里**做的，背景（clear color）和 `toneMapped = false` 的材质
 * 本来就不参与，半透明物体也是「先 tone mapping 再混合」。整幅图补一遍会把
 * 背景一起压暗（本项目背景是白色，会被压成灰白），画面就会发灰、不通透。
 *
 * 因此这里让 three 把这个 RenderTarget 当作「最终输出」来渲染：
 * 标记为 `isXRRenderTarget` —— three 官方为「离屏渲染出与屏幕一致的结果」
 * 提供的分支（见 three issue #27868），它同时覆盖：
 *   · WebGLPrograms：材质应用 tone mapping、按 RT 的 colorSpace 做输出编码
 *   · getUnlitUniformColorSpace：背景 clear color 也按同一 colorSpace 处理
 * 再配合把 `texture.colorSpace` 设成 `gl.outputColorSpace`，
 * 每个材质、每个透明层、以及背景都会像渲染到 canvas 一样被处理，
 * RT 里就是与屏幕逐像素一致的画面，第二趟原样搬出来即可。
 * （若日后升级 three 后画面重新变暗/发灰，先确认该分支是否仍存在。）
 *
 * 渲染分两趟：
 *  1) 场景 → sceneTarget（超采样尺寸，内容与 canvas 一致）
 *  2) 全屏四边形把 sceneTarget 缩放回输出尺寸（2× 超采样回缩 = 2×2 盒式抗锯齿，
 *     且和 canvas 的 MSAA 一样在编码后的空间里平均），再 readRenderTargetPixels 读回。
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
  /** MSAA 采样数；默认：超采样时 0（超采样已提供抗锯齿），否则 4 */
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

/** 全屏四边形：顶点直接输出裁剪空间坐标 */
const VERTEX_SHADER = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

/** 第二趟只做缩放搬运：颜色在上一趟已经和屏幕完全一致，不能再动 */
const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D tDiffuse;

varying vec2 vUv;

void main() {
  gl_FragColor = texture2D( tDiffuse, vUv );
}
`;

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

  const requestedSamples = options.samples ?? (supersample > 1 ? 0 : 4);
  const samples = Math.max(0, Math.min(requestedSamples, gl.capabilities.maxSamples));

  // 第一趟：场景（内容与 canvas 完全一致）
  const sceneTarget = new THREE.WebGLRenderTarget(render.width, render.height, {
    // 此时颜色已是输出色空间编码后的值，用 8bit 存即可，与 canvas 精度一致
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    // 让材质按 outputColorSpace 编码输出（= 渲染到 canvas 的行为）
    colorSpace: gl.outputColorSpace as THREE.ColorSpace,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
    samples,
  });
  // 让 three 把这个 RT 当作「最终输出」：逐材质应用 tone mapping + 输出编码。
  // 这是 three 给 WebXR 用的内部标记（WebGLRenderer 中 `isXRRenderTarget === true`
  // 的几处分支），副作用仅为强制内部格式使用线性 transfer（见 getInternalFormat），
  // 即不会在写入/读取时被硬件额外做一次 sRGB 编解码，正是我们需要的。
  (sceneTarget as THREE.WebGLRenderTarget & { isXRRenderTarget?: boolean }).isXRRenderTarget =
    true;

  // 第二趟：缩放回输出尺寸后读回
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
    uniforms: { tDiffuse: { value: sceneTarget.texture } },
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
