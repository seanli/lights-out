// A board's shape as a small dot picture (gaps stay empty), for menus and lists. Styled by `.room-glyph` in
// src/shell/styles/components.css; size it with --glyph-box. The picture keeps the board's proportions inside that
// square box: its longer side fills the box, so a 10×10 draws fine dots and the 6×16 Tower a tall narrow sliver,
// while every glyph keeps the same footprint. A honeycomb shifts its odd rows half a dot; a cube is drawn as a small
// isometric cube (three faces of dots); a stuck room shows hollow dots, a wired one diamond dots. Pure DOM helper.
import type { Pack } from '../contracts';
import { cellIndexes, gridOf, gridSize } from './shape';
import { cubeSide } from './cube';
import { h } from './dom';

/** a board this many times taller than wide is a tower: its picture may reach above and below its box (`--glyph-tall`) */
const TALL = 2;

/**
 * `solved` of `pack.count` levels light the same share of its dots, nearest the centre first,
 * so a finished board glows and an untouched one is a dark outline.
 */
export function roomGlyph(pack: Pick<Pack, 'shape' | 'count'> & { kind?: Pack['kind'] }, solved: number): HTMLElement {
  const share = Math.min(Math.max(0, solved), pack.count) / Math.max(1, pack.count);
  if (gridOf(pack.shape) === 'cube') return cubeGlyph(cubeSide(pack.shape), share);
  const { cols, rows } = pack.shape;
  const hex = gridOf(pack.shape) === 'hex';
  // --n: dots along the longer side (it sets the dot size); --cols lays out the grid; a tower may reach above its box
  const g = h('span', {
    class: 'room-glyph', 'aria-hidden': 'true', 'data-tall': rows >= TALL * cols ? 'true' : null,
    'data-grid': hex ? 'hex' : null, 'data-kind': pack.kind === 'stuck' || pack.kind === 'wired' ? pack.kind : null,
    style: `--cols:${cols};--n:${Math.max(cols, rows) + (hex ? 0.5 : 0)}`,
  });
  const real = cellIndexes(pack.shape);
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const order = [...real].sort((a, b) =>
    Math.hypot((a % cols) - cx, Math.floor(a / cols) - cy) - Math.hypot((b % cols) - cx, Math.floor(b / cols) - cy) || a - b);
  const lit = new Set(order.slice(0, Math.round(real.length * share)));
  const isReal = new Set(real);
  // a stuck room's picture: a few hollow dots, apart from each other, off the edges
  const stuck = pack.kind === 'stuck' ? new Set([cols + 1, 2 * cols + cols - 2, (rows - 2) * cols + 2].filter((i) => isReal.has(i))) : new Set<number>();
  for (let i = 0; i < gridSize(pack.shape); i++) {
    const odd = hex && Math.floor(i / cols) % 2 === 1 ? { 'data-odd': '' } : {};
    g.append(h('i', isReal.has(i) ? { 'data-lit': String(lit.has(i)), ...(stuck.has(i) ? { 'data-stuck': '' } : {}), ...odd } : { 'data-gap': '', ...odd }));
  }
  return g;
}

const SVG = 'http://www.w3.org/2000/svg';
/**
 * A cube of n×n per face, drawn isometric: the top and the two front faces, each light a small rhombus. `share` of
 * them are lit, the top face first.
 */
function cubeGlyph(n: number, share: number): HTMLElement {
  const c30 = Math.cos(Math.PI / 6), s30 = 0.5;
  // world (x right, y up, z toward the viewer) → picture; a cube of side n with its near top corner at the origin
  const at = (x: number, y: number, z: number): [number, number] => [(x - z) * c30, (x + z) * s30 - y];
  const faces: [number, number, number][][][] = [];
  const quad = (o: [number, number, number], u: [number, number, number], v: [number, number, number]) => {
    const cells: [number, number, number][][] = [];
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      const k = 0.16; // each light is inset from its slot
      const p = (da: number, db: number): [number, number, number] =>
        [o[0] + u[0] * (a + da) + v[0] * (b + db), o[1] + u[1] * (a + da) + v[1] * (b + db), o[2] + u[2] * (a + da) + v[2] * (b + db)];
      cells.push([p(k, k), p(1 - k, k), p(1 - k, 1 - k), p(k, 1 - k)]);
    }
    faces.push(cells);
  };
  quad([0, n, 0], [1, 0, 0], [0, 0, 1]); // top: x across, z toward the viewer
  quad([0, n, n], [1, 0, 0], [0, -1, 0]); // front: x across, down
  quad([n, n, n], [0, 0, -1], [0, -1, 0]); // right: back along z, down
  const all = faces.flat();
  const lit = Math.round(all.length * share);
  const svg = document.createElementNS(SVG, 'svg');
  const pts = all.flat().map(([x, y, z]) => at(x, y, z));
  const minX = Math.min(...pts.map((p) => p[0])), maxX = Math.max(...pts.map((p) => p[0]));
  const minY = Math.min(...pts.map((p) => p[1])), maxY = Math.max(...pts.map((p) => p[1]));
  svg.setAttribute('viewBox', `${minX - 0.3} ${minY - 0.3} ${maxX - minX + 0.6} ${maxY - minY + 0.6}`);
  svg.setAttribute('class', 'room-glyph room-glyph--cube');
  svg.setAttribute('aria-hidden', 'true');
  all.forEach((cell, k) => {
    const poly = document.createElementNS(SVG, 'polygon');
    poly.setAttribute('points', cell.map(([x, y, z]) => at(x, y, z).map((v) => v.toFixed(3)).join(',')).join(' '));
    poly.setAttribute('data-lit', String(k < lit));
    svg.append(poly);
  });
  return svg as unknown as HTMLElement;
}
