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

export const USE_MOUSE = true;
