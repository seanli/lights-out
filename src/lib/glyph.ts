// A board's shape as a small dot picture (gaps stay empty), for menus and lists. Styled by `.room-glyph` in
// src/shell/styles/components.css; size it with --glyph-box. The picture keeps the board's proportions inside that
// square box: its longer side fills the box, so a 10×10 draws fine dots and the 6×16 Tower a tall narrow sliver,
// while every glyph keeps the same footprint. Pure DOM helper: no state, no events.
import type { Pack } from '../contracts';
import { cellIndexes, gridSize } from './shape';
import { h } from './dom';

/** a board this many times taller than wide is a tower: its picture may reach above and below its box (`--glyph-tall`) */
const TALL = 2;

/**
 * `solved` of `pack.count` levels light the same share of its dots, nearest the centre first,
 * so a finished board glows and an untouched one is a dark outline.
 */
export function roomGlyph(pack: Pick<Pack, 'shape' | 'count'>, solved: number): HTMLElement {
  const { cols, rows } = pack.shape;
  // --n: dots along the longer side (it sets the dot size); --cols lays out the grid; a tower may reach above its box
  const g = h('span', {
    class: 'room-glyph', 'aria-hidden': 'true', 'data-tall': rows >= TALL * cols ? 'true' : null,
    style: `--cols:${cols};--n:${Math.max(cols, rows)}`,
  });
  const real = cellIndexes(pack.shape);
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const order = [...real].sort((a, b) =>
    Math.hypot((a % cols) - cx, Math.floor(a / cols) - cy) - Math.hypot((b % cols) - cx, Math.floor(b / cols) - cy) || a - b);
  const lit = new Set(order.slice(0, Math.round((real.length * Math.min(Math.max(0, solved), pack.count)) / Math.max(1, pack.count))));
  const isReal = new Set(real);
  for (let i = 0; i < gridSize(pack.shape); i++) g.append(h('i', isReal.has(i) ? { 'data-lit': String(lit.has(i)) } : { 'data-gap': '' }));
  return g;
}
