// Shared inline icons (24×24, stroke = currentColor), so every view draws the same picture.
import { WIRE_DIRS } from './shape';

/** a boss level: a small skull. Styled by `.skull` in components.css. */
export const SKULL_SVG =
  '<svg class="skull" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M12 3a7.5 7.5 0 0 0-7.5 7.5v3.2c0 .8.5 1.5 1.2 1.8l1.3.6V19a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2.9l1.3-.6c.7-.3 1.2-1 1.2-1.8v-3.2A7.5 7.5 0 0 0 12 3z"/>'
  + '<circle cx="9" cy="11.5" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="11.5" r="1.7" fill="currentColor" stroke="none"/>'
  + '<path d="M11 15.4l1-1.4 1 1.4M10.5 20v-2M13.5 20v-2"/></svg>';

/** a fresh skull element */
export function skull(): Element {
  const span = document.createElement('span');
  span.innerHTML = SKULL_SVG;
  return span.firstElementChild!;
}

const SVG = 'http://www.w3.org/2000/svg';

/**
 * A wired switch, drawn like a circuit board: a hub ring in the middle and a trace toward each cell its press also
 * flips, ending in a solder pad at the cell's edge. Drawn opaque in currentColor; the whole mark fades as one layer
 * (CSS opacity on the svg), so crossing strokes never darken where they overlap.
 */
export function wireIcon(bits: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-12 -12 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'cell__wires');
  const traces = document.createElementNS(SVG, 'path');
  let d = '';
  const pads: [number, number][] = [];
  WIRE_DIRS.forEach(([dr, dc], k) => {
    if (!(bits & (1 << k))) return;
    // a diagonal runs to the corner; a straight one to the middle of the edge
    const reach = dr && dc ? 8.2 : 10;
    const from = dr && dc ? 2.4 : 3.4;
    d += `M${dc * from} ${dr * from}L${dc * reach} ${dr * reach}`;
    pads.push([dc * reach, dr * reach]);
  });
  traces.setAttribute('d', d);
  traces.setAttribute('class', 'cell__trace');
  svg.append(traces);
  for (const [x, y] of pads) {
    const pad = document.createElementNS(SVG, 'circle');
    pad.setAttribute('cx', String(x));
    pad.setAttribute('cy', String(y));
    pad.setAttribute('r', '1.9');
    pad.setAttribute('class', 'cell__pad');
    svg.append(pad);
  }
  const hub = document.createElementNS(SVG, 'circle');
  hub.setAttribute('r', '3.1');
  hub.setAttribute('class', 'cell__hub');
  svg.append(hub);
  return svg;
}

/** half a honeycomb tile's height in the stuck icon's units: the tile is 24 wide, pointy-top, 24 × 2/√3 tall */
const HEX_H = 13.856;
/** a pointy-top hexagon's corners, scaled about the centre (scale 1 = the honeycomb tile itself) */
const hexCorners = (scale: number): [number, number][] =>
  [[0, -HEX_H], [12, -HEX_H / 2], [12, HEX_H / 2], [0, HEX_H], [-12, HEX_H / 2], [-12, -HEX_H / 2]].map(([x, y]) => [x! * scale, y! * scale]);

/** the stripes (lines x + y = k, `step` apart) cut to a convex polygon, as one path: no clip path, so no ids to clash */
function stripesIn(poly: readonly [number, number][], step: number): string {
  let d = '';
  for (let k = -4 * step; k <= 4 * step + 1e-9; k += step) {
    const hits: number[] = [];
    poly.forEach(([ax, ay], n) => {
      const [bx, by] = poly[(n + 1) % poly.length]!;
      const den = bx - ax + (by - ay);
      if (Math.abs(den) < 1e-9) return;
      const s = (k - ax - ay) / den;
      if (s >= 0 && s <= 1) hits.push(ax + s * (bx - ax));
    });
    if (hits.length < 2) continue;
    const x1 = Math.min(...hits), x2 = Math.max(...hits);
    if (x2 - x1 > 0.5) d += `M${x1.toFixed(2)} ${(k - x1).toFixed(2)}L${x2.toFixed(2)} ${(k - x2).toFixed(2)}`;
  }
  return d;
}

const el = (name: string, attrs: Record<string, string>) => {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
};

/**
 * A stuck switch: a hazard-striped cover held down by rivets. Opaque in currentColor; the mark fades as one layer (CSS),
 * so nothing doubles up where shapes meet. On a square tile, a rounded square with a rivet at each corner; on a
 * honeycomb tile (`hex`), a hexagon with a rivet at each of its four side corners, all inside the tile.
 */
export function stuckIcon(grid: 'square' | 'hex' = 'square'): SVGSVGElement {
  const hex = grid === 'hex';
  const svg = el('svg', { viewBox: hex ? `-12 ${-HEX_H} 24 ${2 * HEX_H}` : '-12 -12 24 24', 'aria-hidden': 'true', class: 'cell__stuck' }) as SVGSVGElement;
  if (hex) {
    const points = (scale: number) => hexCorners(scale).map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    svg.append(
      el('path', { d: stripesIn(hexCorners(0.56), 4.8), class: 'cell__stripes' }),
      el('polygon', { points: points(0.68), class: 'cell__rim' }),
    );
    for (const [x, y] of hexCorners(0.82).filter(([x]) => x !== 0)) svg.append(el('circle', { cx: x.toFixed(2), cy: y.toFixed(2), r: '1.5', class: 'cell__rivet' }));
    return svg;
  }
  // the stripes: parallel bars (x + y = k) cut to the cover square, so no two strokes cross; the rim rounds the corners
  const square: [number, number][] = [[-6.8, -6.8], [6.8, -6.8], [6.8, 6.8], [-6.8, 6.8]];
  svg.append(
    el('path', { d: stripesIn(square, 6.4), class: 'cell__stripes' }),
    el('rect', { x: '-8', y: '-8', width: '16', height: '16', rx: '2.6', class: 'cell__rim' }),
  );
  for (const [x, y] of [[-10.2, -10.2], [10.2, -10.2], [-10.2, 10.2], [10.2, 10.2]] as const) svg.append(el('circle', { cx: String(x), cy: String(y), r: '1.5', class: 'cell__rivet' }));
  return svg;
}

/**
 * A honeycomb tile's outline (keyboard focus, a lesson's outlined lights, Assist's ring, the aimed light), drawn as a
 * hexagon a little larger than the tile: the tile's face is clipped to its hexagon, so an outline on the tile itself
 * would be cut off or come out square. Styled by `.hex-ring` in components.css (hidden until a state shows it).
 */
export function hexRing(): SVGSVGElement {
  const svg = el('svg', { viewBox: '0 0 86.6 100', preserveAspectRatio: 'none', class: 'hex-ring', 'aria-hidden': 'true' }) as SVGSVGElement;
  svg.append(el('polygon', { points: '43.3,0 86.6,25 86.6,75 43.3,100 0,75 0,25' }));
  return svg;
}
