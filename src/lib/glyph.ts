// A board's shape as a small dot picture (gaps stay empty), for menus and lists. Styled by `.room-glyph` in
// src/shell/styles/components.css; size it with --glyph-box. Pure DOM helper: no state, no events.
import type { Pack } from '../contracts';
import { cellIndexes, gridSize } from './shape';
import { h } from './dom';

/**
 * `solved` of `pack.count` levels light the same share of its dots, nearest the centre first,
 * so a finished board glows and an untouched one is a dark outline.
 */
export function roomGlyph(pack: Pick<Pack, 'shape' | 'count'>, solved: number): HTMLElement {
  const { cols, rows } = pack.shape;
  const g = h('span', { class: 'room-glyph', 'aria-hidden': 'true', style: `--cols:${cols}` });
  const real = cellIndexes(pack.shape);
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const order = [...real].sort((a, b) =>
    Math.hypot((a % cols) - cx, Math.floor(a / cols) - cy) - Math.hypot((b % cols) - cx, Math.floor(b / cols) - cy) || a - b);
  const lit = new Set(order.slice(0, Math.round((real.length * Math.min(Math.max(0, solved), pack.count)) / Math.max(1, pack.count))));
  const isReal = new Set(real);
  for (let i = 0; i < gridSize(pack.shape); i++) g.append(h('i', isReal.has(i) ? { 'data-lit': String(lit.has(i)) } : { 'data-gap': '' }));
  return g;
}
