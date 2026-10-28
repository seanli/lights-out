// Pure helpers for board shapes (any cols × rows grid, with optional gaps). No state, no game rules beyond geometry.
import { CLASSIC_SHAPE, type Cells, type Shape } from '../contracts/entities';

/** absent = the classic 5×5 board */
export const shapeOf = (s?: Shape | null): Shape => s ?? CLASSIC_SHAPE;

/** grid positions, gaps included */
export const gridSize = (s: Shape): number => s.cols * s.rows;

/** true when grid position i is a real cell (not a gap, not off the grid) */
export const isCell = (s: Shape, i: number): boolean =>
  Number.isInteger(i) && i >= 0 && i < gridSize(s) && (!s.mask || s.mask[i] === true);

/** the real cells' indexes, ascending */
export function cellIndexes(s: Shape): number[] {
  const out: number[] = [];
  for (let i = 0; i < gridSize(s); i++) if (isCell(s, i)) out.push(i);
  return out;
}

export const cellCount = (s: Shape): number => (s.mask ? s.mask.filter(Boolean).length : gridSize(s));

/** what a press at i toggles: i and its up/down/left/right neighbours that are real cells (never across a gap) */
export function pressTargets(s: Shape, i: number): number[] {
  if (!isCell(s, i)) return [];
  const r = Math.floor(i / s.cols), c = i % s.cols;
  const out = [i];
  if (r > 0 && isCell(s, i - s.cols)) out.push(i - s.cols);
  if (r < s.rows - 1 && isCell(s, i + s.cols)) out.push(i + s.cols);
  if (c > 0 && isCell(s, i - 1)) out.push(i - 1);
  if (c < s.cols - 1 && isCell(s, i + 1)) out.push(i + 1);
  return out;
}

export const emptyCells = (s: Shape): Cells => new Array<boolean>(gridSize(s)).fill(false);

/** a board fits a shape: one boolean per grid position and nothing lit in a gap */
export function fitsShape(s: Shape, cells: readonly boolean[]): boolean {
  if (cells.length !== gridSize(s)) return false;
  if (s.mask && s.mask.length !== gridSize(s)) return false;
  for (let i = 0; i < cells.length; i++) if (cells[i] && !isCell(s, i)) return false;
  return true;
}

export function sameShape(a?: Shape | null, b?: Shape | null): boolean {
  return shapeKey(shapeOf(a)) === shapeKey(shapeOf(b));
}

/** a stable string for caching per shape, e.g. "5x5" or "7x7:..XXX..|..." */
export function shapeKey(s: Shape): string {
  const base = `${s.cols}x${s.rows}`;
  if (!s.mask || s.mask.every(Boolean)) return base;
  const rows: string[] = [];
  for (let r = 0; r < s.rows; r++) rows.push(s.mask.slice(r * s.cols, (r + 1) * s.cols).map((m) => (m ? 'X' : '.')).join(''));
  return `${base}:${rows.join('|')}`;
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
