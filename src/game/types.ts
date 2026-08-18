// ===== Maze Data Types =====

export interface CellWalls {
  N: boolean;
  E: boolean;
  S: boolean;
  W: boolean;
}

export interface Cell {
  walls: CellWalls;
  visited: boolean; // used during generation
}

export interface MazeData {
  width: number;
  height: number;
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

// ===== Wall Segment (for collision & rendering) =====

export interface WallSegment {
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  // 'V' = vertical wall (along Z axis), 'H' = horizontal wall (along X axis)
  orientation: 'V' | 'H';
}
