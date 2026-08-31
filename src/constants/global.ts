import type { Difficulty } from '../game/types';

export const CELL_SCALE = 1;

// 注：实际网格尺寸为「2N+1 扩展」后的奇数尺寸，每个单元格要么是墙要么是路。
export const DIFFICULTY_SIZES: Record<Difficulty, { w: number; h: number }> = {
  // easy: { w: 17, h: 17 },
  easy: { w: 11, h: 11 },
  medium: { w: 25, h: 25 },
  hard: { w: 33, h: 33 },
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: '简单',
  medium: '中等 ',
  hard: '困难',
};

export const Dierection = {
  Left: Symbol('left'),
  Right: Symbol('right'),
  Top: Symbol('top'),
  Bottom: Symbol('bottom'),
}
export type DierectionType = typeof Dierection[keyof typeof Dierection];

export const USE_MOUSE = true;

/**
 * 场景（canvas）的暖光底色。
 *
 * 同时用在三处，必须保持一致：
 *  1. App.css 的 `--warm-light`：Canvas 还没画出内容时（首帧、模型懒加载中）
 *     先露出这个颜色，不会闪黑屏；菜单淡出的那 430ms 里也是它。
 *  2. Game.tsx 的 `gl.setClearColor(...)`：WebGL 清屏色。
 *  3. Game.tsx 的 `scene.background`：场景远景/天空色。
 */
export const WARM_LIGHT_BG = '#f6e6d6';

/** true: 用 Three.js 程序化草地（GrassCellsProcedural）；false: 用 grass.glb 模型 */
export const IS_PURE_GRASS = false;

/**
 * 场景大模型（8MB 级 glb）的懒加载触发半径（世界单位）。
 * 玩家走到该范围内才开始下载并挂载对应模型，避免开局一次性拉取几十 MB。
 */
export const SCENE_MODEL_LOAD_RADIUS = 8 * CELL_SCALE;

/** true: 显示海洋颜色调试面板（运行时可调整深水/浅水/泡沫颜色） */
export const OCEAN_DEBUG = false;

/**
 * 是否通过 jsDelivr CDN 加载大模型 glb。
 * 默认 false（走本地 public/models）；可通过环境变量 VITE_CDN=true 开启。
 */
export const CDN = import.meta.env.VITE_CDN === 'true';

/** CDN 仓库根地址（gh-pages 分支） */
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/lerhxx/3d-maze@gh-pages';

/**
 * 构建模型 glb 的完整 URL。
 * - 生产打包（PROD）：始终走 CDN。
 * - 开发环境：CDN 为 true 时走 CDN；为 false 时走本地 `${BASE_URL}models/...`（保持现有逻辑）。
 */
export function modelUrl(name: string): string {
  if (import.meta.env.PROD || CDN) {
    return `${CDN_BASE}/models/${name}`;
  }
  return `${import.meta.env.BASE_URL}/models/${name}`;
}


