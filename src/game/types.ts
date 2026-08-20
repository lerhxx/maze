// ===== Maze Data Types =====

/**
 * 块式迷宫：每个单元格要么是道路，要么是墙壁。
 */
export type CellType = 'wall' | 'path';

export interface Cell {
  type: CellType;
  visited: boolean; // 用于迷宫生成时的 DFS
}

export interface MazeData {
  width: number; // 扩展后实际网格宽度（奇数）
  height: number; // 扩展后实际网格高度（奇数）
  cells: Cell[][]; // cells[col][row]
  startCol: number;
  startRow: number;
  exitCol: number;
  exitRow: number;
}

// ===== Game State =====

export type GameStatus = 'menu' | 'playing' | 'won';

export type Difficulty = 'easy' | 'medium' | 'hard';

export interface GameRef {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  visitedCells: Set<string>;
  maze: MazeData;
  pointerLocked: boolean;
}
