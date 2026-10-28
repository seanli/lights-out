// Pure helpers for board shapes (any cols × rows grid, with optional gaps) and how a press spreads on them: square
// grids (the plus, or per-cell wiring), honeycombs and cubes, with or without stuck cells. No state beyond caches.
import { CLASSIC_SHAPE, type Cells, type Grid, type Shape } from '../contracts/entities';
import { cubeNeighbours, cubeSide, isCubeNet } from './cube';

/** absent = the classic 5×5 board */
export const shapeOf = (s?: Shape | null): Shape => s ?? CLASSIC_SHAPE;

export const gridOf = (s: Shape): Grid => s.grid ?? 'square';

/** grid positions, gaps included */
export const gridSize = (s: Shape): number => s.cols * s.rows;

/** true when grid position i is a real cell (not a gap, not off the grid) */
export const isCell = (s: Shape, i: number): boolean =>
  Number.isInteger(i) && i >= 0 && i < gridSize(s) && (!s.mask || s.mask[i] === true);

/** a stuck cell is a light that can't be pressed (a neighbour's press still flips it) */
export const isStuck = (s: Shape, i: number): boolean => !!s.stuck && s.stuck.includes(i);

/** a real cell that can be pressed */
export const isPressable = (s: Shape, i: number): boolean => isCell(s, i) && !isStuck(s, i);

/** the real cells' indexes, ascending */
export function cellIndexes(s: Shape): number[] {
  const out: number[] = [];
  for (let i = 0; i < gridSize(s); i++) if (isCell(s, i)) out.push(i);
  return out;
}

export const cellCount = (s: Shape): number => (s.mask ? s.mask.filter(Boolean).length : gridSize(s));

/** wiring directions, bit k: [row step, column step] (0 up, then clockwise) */
export const WIRE_DIRS: readonly (readonly [number, number])[] = [[-1, 0], [-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1]];
/** the plain plus as wiring: up, right, down, left */
export const PLUS_WIRES = 0b01010101;

/** a honeycomb's six neighbours, [row step, column step], for even and odd rows (odd rows sit half a cell right) */
const HEX_EVEN: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [-1, -1], [-1, 0], [1, -1], [1, 0]];
const HEX_ODD: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [-1, 0], [-1, 1], [1, 0], [1, 1]];

/** the cells around i (never i itself, never a gap), however this grid connects them; wiring is per cell */
function around(s: Shape, i: number, cube: number[][] | null): number[] {
  if (cube) return cube[i] ?? [];
  const r = Math.floor(i / s.cols), c = i % s.cols;
  const out: number[] = [];
  const add = (dr: number, dc: number) => {
    const rr = r + dr, cc = c + dc;
    if (rr >= 0 && rr < s.rows && cc >= 0 && cc < s.cols && isCell(s, rr * s.cols + cc)) out.push(rr * s.cols + cc);
  };
  if (gridOf(s) === 'hex') {
    for (const [dr, dc] of r & 1 ? HEX_ODD : HEX_EVEN) add(dr, dc);
    return out;
  }
  if (s.wires) {
    const w = s.wires[i] ?? 0;
    WIRE_DIRS.forEach(([dr, dc], k) => { if (w & (1 << k)) add(dr, dc); });
    return out;
  }
  // the classic order (up, down, left, right): the classic solver and its tests were written against it
  add(-1, 0); add(1, 0); add(0, -1); add(0, 1);
  return out;
}

/** press tables, built once per shape (shapes in the store are frozen objects; data-built ones are keyed by value) */
const tables = new WeakMap<Shape, number[][]>();
const tablesByKey = new Map<string, number[][]>();

function pressTable(s: Shape): number[][] {
  const hit = tables.get(s);
  if (hit) return hit;
  const key = shapeKey(s);
  let t = tablesByKey.get(key);
  if (!t) {
    const n = gridOf(s) === 'cube' ? cubeSide(s) : 0;
    const cube = n ? cubeNeighbours(n) : null;
    t = Array.from({ length: gridSize(s) }, (_, i) => (isPressable(s, i) ? [i, ...around(s, i, cube)] : []));
    if (tablesByKey.size > 256) tablesByKey.clear(); // custom boards come and go: keep the cache small
    tablesByKey.set(key, t);
  }
  tables.set(s, t);
  return t;
}

/** what a press at i toggles: i and the cells it reaches on this grid (none for a gap or a stuck cell) */
export const pressTargets = (s: Shape, i: number): number[] => (Number.isInteger(i) && i >= 0 && i < gridSize(s) ? pressTable(s)[i]! : []);

/** the cells that touch i on this grid, wiring aside (a hex cell's six, a cube light's four, a square cell's plus) */
export function touching(s: Shape, i: number): number[] {
  if (!isCell(s, i)) return [];
  const plain: Shape = { cols: s.cols, rows: s.rows, mask: s.mask, ...(s.grid ? { grid: s.grid } : {}) };
  return pressTargets(plain, i).slice(1);
}

export const emptyCells = (s: Shape): Cells => new Array<boolean>(gridSize(s)).fill(false);

/** a board fits a shape: one boolean per grid position and nothing lit in a gap */
export function fitsShape(s: Shape, cells: readonly boolean[]): boolean {
  if (cells.length !== gridSize(s)) return false;
  if (s.mask && s.mask.length !== gridSize(s)) return false;
  for (let i = 0; i < cells.length; i++) if (cells[i] && !isCell(s, i)) return false;
  return true;
}

/** what's wrong with a shape that passed the schema (lengths, a cube that isn't a net, rules on the wrong grid), or null */
export function shapeProblem(s: Shape): string | null {
  const size = gridSize(s);
  if (s.mask && s.mask.length !== size) return `A ${s.cols}×${s.rows} board needs ${size} mask entries, not ${s.mask.length}`;
  if (gridOf(s) === 'cube' && !isCubeNet(s)) return 'A cube board must be the cube\'s net (lib/cube.ts)';
  if (s.wires && gridOf(s) !== 'square') return 'Wired switches only work on a square grid';
  if (s.wires && s.wires.length !== size) return `Wiring needs one entry per grid position (${size}), not ${s.wires.length}`;
  if (s.stuck && s.stuck.some((i) => !isCell(s, i))) return 'A stuck cell must be a real cell';
  if (s.stuck && new Set(s.stuck).size !== s.stuck.length) return 'A stuck cell is listed twice';
  if (s.stuck && s.stuck.length >= cellCount(s)) return 'At least one cell must be pressable';
  return null;
}

export function sameShape(a?: Shape | null, b?: Shape | null): boolean {
  return shapeKey(shapeOf(a)) === shapeKey(shapeOf(b));
}

/** a stable string for caching per shape, e.g. "5x5", "7x7:..XXX..|...", "7x7 hex:...", "5x5 w:..." or "6x6 s:3,17" */
export function shapeKey(s: Shape): string {
  let key = `${s.cols}x${s.rows}`;
  if (s.grid && s.grid !== 'square') key += ` ${s.grid}`;
  if (s.mask && !s.mask.every(Boolean)) {
    const rows: string[] = [];
    for (let r = 0; r < s.rows; r++) rows.push(s.mask.slice(r * s.cols, (r + 1) * s.cols).map((m) => (m ? 'X' : '.')).join(''));
    key += `:${rows.join('|')}`;
  }
  if (s.wires) key += ` w:${s.wires.map((w) => w.toString(16).padStart(2, '0')).join('')}`;
  if (s.stuck?.length) key += ` s:${[...s.stuck].sort((x, y) => x - y).join(',')}`;
  return key;
}

/** from data: one string per row, "X" = cell, "." = gap; throws with a plain message on a bad picture */
export function parseShape(rows: readonly string[]): Shape {
  if (rows.length < 3) throw new Error(`A board shape needs at least 3 rows (got ${rows.length})`);
  const cols = rows[0]!.length;
  if (rows.some((r) => r.length !== cols)) throw new Error('Every row of a board shape must be the same length');
  if (!rows.every((r) => /^[X.]+$/.test(r))) throw new Error('A board shape uses only "X" (cell) and "." (gap)');
  const mask = rows.join('').split('').map((ch) => ch === 'X');
  return { cols, rows: rows.length, mask: mask.every(Boolean) ? null : mask };
}

/**
 * A hexagon of hexagons with `side` cells along each edge (3 → 19 lights, 4 → 37, 5 → 61), on a honeycomb grid
 * (odd rows half a cell right): 2·side − 1 rows, the middle one 2·side − 1 cells wide.
 */
export function hexagonShape(side: number): Shape {
  const rows = 2 * side - 1;
  const pts: [number, number][] = [];
  for (let q = -side + 1; q < side; q++) {
    for (let r = -side + 1; r < side; r++) {
      if (Math.abs(q + r) > side - 1) continue;
      const row = r + side - 1;
      // axial (q, r) → this grid's column: odd rows are the shifted ones
      pts.push([row, q + (row - (row & 1)) / 2]);
    }
  }
  const min = Math.min(...pts.map(([, c]) => c));
  const cols = Math.max(...pts.map(([, c]) => c)) - min + 1;
  const mask = new Array<boolean>(cols * rows).fill(false);
  for (const [r, c] of pts) mask[r * cols + c - min] = true;
  return { cols, rows, mask, grid: 'hex' };
}
