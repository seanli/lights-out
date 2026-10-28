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

/**
 * A stuck switch: a hazard-striped cover held down by four rivets. Opaque in currentColor; the mark fades as one
 * layer (CSS), so nothing doubles up where shapes meet.
 */
export function stuckIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-12 -12 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'cell__stuck');
  // the stripes: parallel bars (x + y = k) cut to the cover square, so no two strokes cross; the rim rounds the corners
  const cover = document.createElementNS(SVG, 'rect');
  for (const [k, v] of [['x', '-8'], ['y', '-8'], ['width', '16'], ['height', '16'], ['rx', '2.6']]) cover.setAttribute(k!, v!);
  cover.setAttribute('class', 'cell__rim');
  const stripes = document.createElementNS(SVG, 'path');
  let d = '';
  for (let k = -12.8; k <= 12.8; k += 6.4) {
    const x1 = Math.max(-6.8, k - 6.8), x2 = Math.min(6.8, k + 6.8);
    if (x2 - x1 > 0.5) d += `M${x1.toFixed(2)} ${(k - x1).toFixed(2)}L${x2.toFixed(2)} ${(k - x2).toFixed(2)}`;
  }
  stripes.setAttribute('d', d);
  stripes.setAttribute('class', 'cell__stripes');
  svg.append(stripes, cover);
  for (const [x, y] of [[-10.2, -10.2], [10.2, -10.2], [-10.2, 10.2], [10.2, 10.2]] as const) {
    const rivet = document.createElementNS(SVG, 'circle');
    rivet.setAttribute('cx', String(x));
    rivet.setAttribute('cy', String(y));
    rivet.setAttribute('r', '1.5');
    rivet.setAttribute('class', 'cell__rivet');
    svg.append(rivet);
  }
  return svg;
}
