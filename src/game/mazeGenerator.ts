import type { Cell, MazeData, WallSegment } from './types';
import { CELL_SCALE } from '../constants/global';

/**
 * Generate a perfect maze using recursive backtracking (iterative DFS).
 * Every cell is reachable from every other cell via exactly one path.
 */
export function generateMaze(width: number, height: number): MazeData {
  // Initialize all cells with all walls intact
  const cells: Cell[][] = [];
  for (let c = 0; c < width; c++) {
    cells[c] = [];
    for (let r = 0; r < height; r++) {
      cells[c][r] = {
        walls: { N: true, E: true, S: true, W: true },
        visited: false,
      };
    }
  }

  // Iterative DFS
  const stack: Array<[number, number]> = [];
  const startC = 0;
  const startR = 0;
  cells[startC][startR].visited = true;
  stack.push([startC, startR]);

  while (stack.length > 0) {
    const [c, r] = stack[stack.length - 1];
    const neighbors = getUnvisitedNeighbors(c, r, cells, width, height);

    if (neighbors.length === 0) {
      stack.pop();
      continue;
    }

    const [nc, nr, dir] = neighbors[Math.floor(Math.random() * neighbors.length)];

    // Remove wall between current cell and neighbor
    removeWall(cells[c][r], cells[nc][nr], dir);
    cells[nc][nr].visited = true;
    stack.push([nc, nr]);
  }

  return {
    width,
    height,
    cells,
    startCol: 0,
    startRow: 0,
    exitCol: width - 1,
    exitRow: height - 1,
  };
}

type Direction = 'N' | 'E' | 'S' | 'W';

function getUnvisitedNeighbors(
  c: number,
  r: number,
  cells: Cell[][],
  w: number,
  h: number,
): Array<[number, number, Direction]> {
  const result: Array<[number, number, Direction]> = [];
  // North: r - 1
  if (r > 0 && !cells[c][r - 1].visited) result.push([c, r - 1, 'N']);
  // East: c + 1
  if (c < w - 1 && !cells[c + 1][r].visited) result.push([c + 1, r, 'E']);
  // South: r + 1
  if (r < h - 1 && !cells[c][r + 1].visited) result.push([c, r + 1, 'S']);
  // West: c - 1
  if (c > 0 && !cells[c - 1][r].visited) result.push([c - 1, r, 'W']);
  return result;
}

function removeWall(a: Cell, b: Cell, dir: Direction): void {
  const opposite: Record<Direction, Direction> = { N: 'S', E: 'W', S: 'N', W: 'E' };
  a.walls[dir] = false;
  b.walls[opposite[dir]] = false;
}

/**
 * Extract all wall segments from the maze for rendering.
 * To avoid duplicates, we only collect:
 *   - North wall of every cell (horizontal segment at top)
 *   - West wall of every cell (vertical segment at left)
 *   - South wall of the last row (bottom border)
 *   - East wall of the last column (right border)
 */
export function extractWallSegments(maze: MazeData): WallSegment[] {
  const segments: WallSegment[] = [];
  const { width: w, height: h, cells } = maze;

  for (let c = 0; c < w; c++) {
    for (let r = 0; r < h; r++) {
      const cell = cells[c][r];
      // North wall: horizontal segment from (c, r) to (c+1, r)
      if (cell.walls.N) {
        segments.push({ x1: c, z1: r, x2: c + 1, z2: r, orientation: 'H' });
      }
      // West wall: vertical segment from (c, r) to (c, r+1)
      if (cell.walls.W) {
        segments.push({ x1: c, z1: r, x2: c, z2: r + 1, orientation: 'V' });
      }
    }
  }

  // South border (bottom wall of last row)
  for (let c = 0; c < w; c++) {
    if (cells[c][h - 1].walls.S) {
      segments.push({ x1: c, z1: h, x2: c + 1, z2: h, orientation: 'H' });
    }
  }
  // East border (right wall of last column)
  for (let r = 0; r < h; r++) {
    if (cells[w - 1][r].walls.E) {
      segments.push({ x1: w, z1: r, x2: w, z2: r + 1, orientation: 'V' });
    }
  }

  return segments;
}

// ===== Collision Detection =====

/**
 * Distance from point (px, pz) to line segment (x1,z1)-(x2,z2).
 */
function distToSegment(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number {
  const dx = x2 - x1;
  const dz = z2 - z1;
  const lenSq = dx * dx + dz * dz;
  if (lenSq === 0) {
    const ddx = px - x1;
    const ddz = pz - z1;
    return Math.sqrt(ddx * ddx + ddz * ddz);
  }
  let t = ((px - x1) * dx + (pz - z1) * dz) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = x1 + t * dx;
  const cz = z1 + t * dz;
  const ddx = px - cx;
  const ddz = pz - cz;
  return Math.sqrt(ddx * ddx + ddz * ddz);
}

/**
 * Check if a position is valid (not colliding with any wall).
 * Only checks walls near the player for efficiency.
 *
 * NOTE: `px`, `pz`, `radius` are in world units. Internally we convert to
 * cell space (where each cell is 1×1) so the maze data structure stays
 * unscaled — only rendering scales cells by CELL_SCALE.
 */
export function canMove(
  px: number,
  pz: number,
  radius: number,
  maze: MazeData,
): boolean {
  // Convert world → cell space
  const cellPx = px / CELL_SCALE;
  const cellPz = pz / CELL_SCALE;
  const cellRadius = radius / CELL_SCALE;

  const col = Math.floor(cellPx);
  const row = Math.floor(cellPz);

  // Check the 3×3 neighborhood of cells around the player
  for (let dc = -1; dc <= 1; dc++) {
    for (let dr = -1; dr <= 1; dr++) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || c >= maze.width || r < 0 || r >= maze.height) continue;
      const cell = maze.cells[c][r];

      // North wall: segment (c, r) → (c+1, r)
      if (cell.walls.N && distToSegment(cellPx, cellPz, c, r, c + 1, r) < cellRadius) return false;
      // South wall: segment (c, r+1) → (c+1, r+1)
      if (cell.walls.S && distToSegment(cellPx, cellPz, c, r + 1, c + 1, r + 1) < cellRadius) return false;
      // West wall: segment (c, r) → (c, r+1)
      if (cell.walls.W && distToSegment(cellPx, cellPz, c, r, c, r + 1) < cellRadius) return false;
      // East wall: segment (c+1, r) → (c+1, r+1)
      if (cell.walls.E && distToSegment(cellPx, cellPz, c + 1, r, c + 1, r + 1) < cellRadius) return false;
    }
  }

  // Also check maze borders (in cell space)
  if (cellPx < cellRadius || cellPz < cellRadius) return false;
  if (cellPx > maze.width - cellRadius || cellPz > maze.height - cellRadius) return false;

  return true;
}
