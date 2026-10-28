// Pure grid geometry for the play view: which slot a point falls in, and where the arrow keys go. No DOM, no state.
import type { Shape } from '../../contracts';
import { isCell } from '../../lib/shape';

/**
 * a tall board (the Tower, 8×16): it fits its width and scrolls instead of shrinking into the screen. Only up to 8
 * across: wider, the lights would be under the tap minimum, and a scrolling board can't use the magnifier, so a wide
 * tall board (Custom) fits the screen and aims instead.
 */
export const isTall = (shape: Shape): boolean => shape.rows >= 2 * shape.cols && shape.cols <= 8;

/** the board's box in px: its width/height (padding box; a scrolling board's whole content), padding and the gap between cells */
export interface Box { width: number; height: number; padX: number; padY: number; gapX: number; gapY: number }

const clamp = (n: number, max: number) => Math.min(max, Math.max(0, n));

/** one axis: slots are the cells plus half the gap on each side; the padding belongs to the edge slots */
function axis(p: number, size: number, pad: number, gap: number, n: number): number {
  const pitch = (size - 2 * pad + gap) / n;
  if (!(pitch > 0)) return 0;
  return clamp(Math.floor((p - pad + gap / 2) / pitch), n - 1);
}

/** the real cell whose grid slot holds the point (board-local px), or -1 for a gap's slot or a point off the board */
export function cellAt(shape: Shape, x: number, y: number, box: Box): number {
  if (!(x >= 0 && y >= 0 && x <= box.width && y <= box.height)) return -1;
  const i = axis(y, box.height, box.padY, box.gapY, shape.rows) * shape.cols + axis(x, box.width, box.padX, box.gapX, shape.cols);
  return isCell(shape, i) ? i : -1;
}

/** a honeycomb tile's first half-column: two per tile, odd rows start half a tile right */
export const hexHalf = (shape: Shape, i: number): number => 2 * (i % shape.cols) + (Math.floor(i / shape.cols) & 1);

/** the half-columns a honeycomb's tiles use: the first, and how many (so the picture sits centred, no empty half) */
export function hexSpan(shape: Shape): { first: number; halves: number } {
  let first = Infinity, last = -Infinity;
  for (let i = 0; i < shape.cols * shape.rows; i++) {
    if (!isCell(shape, i)) continue;
    first = Math.min(first, hexHalf(shape, i));
    last = Math.max(last, hexHalf(shape, i) + 2);
  }
  return first === Infinity ? { first: 0, halves: 2 } : { first, halves: last - first };
}

/** a honeycomb's row pitch and a tile slot's height, as shares of the tile pitch (pointy-top regular hexagons) */
export const HEX_ROW = Math.sqrt(3) / 2;
export const HEX_TALL = 2 / Math.sqrt(3);

/**
 * A honeycomb: the real tile whose centre is nearest the point (board-local px), or -1 off the board. The nearest
 * centre of a hex lattice is exactly the hexagon around it, so this is the tile under the finger, gaps included.
 */
export function hexCellAt(shape: Shape, x: number, y: number, box: { width: number; padX: number; padY: number }): number {
  const { first, halves } = hexSpan(shape);
  const pitch = (box.width - 2 * box.padX) / (halves / 2);
  if (!(pitch > 0)) return -1;
  let best = -1, bestD = Infinity;
  for (let i = 0; i < shape.cols * shape.rows; i++) {
    if (!isCell(shape, i)) continue;
    const cx = box.padX + ((hexHalf(shape, i) - first) / 2 + 0.5) * pitch;
    const cy = box.padY + (Math.floor(i / shape.cols) * HEX_ROW + HEX_TALL / 2) * pitch;
    const d = Math.hypot(x - cx, y - cy);
    if (d < bestD) { bestD = d; best = i; }
  }
  return bestD <= pitch * 0.6 ? best : -1;
}

/** the next real cell from i in a direction, skipping gaps; i itself when nothing lies that way */
export function stepFrom(shape: Shape, i: number, dr: number, dc: number): number {
  let r = Math.floor(i / shape.cols) + dr, c = (i % shape.cols) + dc;
  while (r >= 0 && r < shape.rows && c >= 0 && c < shape.cols) {
    const j = r * shape.cols + c;
    if (isCell(shape, j)) return j;
    r += dr; c += dc;
  }
  return i;
}

/** the first (dir -1) or last (dir 1) real cell in i's row */
export function rowEdge(shape: Shape, i: number, dir: -1 | 1): number {
  const start = Math.floor(i / shape.cols) * shape.cols;
  for (let k = 0; k < shape.cols; k++) {
    const j = dir < 0 ? start + k : start + shape.cols - 1 - k;
    if (isCell(shape, j)) return j;
  }
  return i;
}
