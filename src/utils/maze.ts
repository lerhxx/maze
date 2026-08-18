interface GenerateMazeProps {
  rows: number;
  cols: number;
}

interface Cell {
  visited: boolean;
  walls: boolean[];
  row: number;
  col: number;
}

const WALL_TOP = 0, WALL_RIGHT = 1, WALL_BOTTOM = 2, WALL_LEFT = 3;

export default function generateMaze({ rows, cols }: GenerateMazeProps) {
  const cells: Cell[][] = [];
  for (let r = 0; r < rows; r++) {
    cells[r] = [];
    for (let c = 0; c < cols; c++) {
      cells[r][c] = {
        walls: [true, true, true, true],
        visited: false, row: r, col: c
      };
    }
  }
  const stack = [];
  let current = cells[0][0];
  current.visited = true;
  stack.push(current);
  const getNeighbors = (cell: Cell) => {
    const neighbors = [];
    const { row, col } = cell;
    if (row > 0 && !cells[row - 1][col].visited) neighbors.push(cells[row - 1][col]);
    if (row < rows - 1 && !cells[row + 1][col].visited) neighbors.push(cells[row + 1][col]);
    if (col > 0 && !cells[row][col - 1].visited) neighbors.push(cells[row][col - 1]);
    if (col < cols - 1 && !cells[row][col + 1].visited) neighbors.push(cells[row][col + 1]);
    return neighbors;
  };
  const removeWall = (a: Cell, b: Cell) => {
    const dr = b.row - a.row, dc = b.col - a.col;
    if (dr === -1) { a.walls[WALL_TOP] = false; b.walls[WALL_BOTTOM] = false; }
    else if (dr === 1) { a.walls[WALL_BOTTOM] = false; b.walls[WALL_TOP] = false; }
    else if (dc === -1) { a.walls[WALL_LEFT] = false; b.walls[WALL_RIGHT] = false; }
    else if (dc === 1) { a.walls[WALL_RIGHT] = false; b.walls[WALL_LEFT] = false; }
  };
  while (stack.length > 0) {
    current = stack[stack.length - 1];
    const neighbors = getNeighbors(current);
    if (neighbors.length > 0) {
      const next = neighbors[Math.floor(Math.random() * neighbors.length)];
      removeWall(current, next);
      next.visited = true;
      stack.push(next);
    } else {
      stack.pop();
    }
  }
  return cells;
}