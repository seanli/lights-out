// Pure grid geometry for the play view: which slot a point falls in, and where the arrow keys go. No DOM, no state.
import type { Shape } from '../../contracts';
import { isCell } from '../../lib/shape';

/** the board's box in px: its width/height (padding box), padding and the gap between cells */
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
