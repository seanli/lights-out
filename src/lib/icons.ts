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

/** a wired switch: a spoke toward each cell its press reaches, round a hub (drawn in currentColor) */
export function wireIcon(bits: number): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-12 -12 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'cell__wires');
  WIRE_DIRS.forEach(([dr, dc], k) => {
    if (!(bits & (1 << k))) return;
    const len = dr && dc ? 7.4 : 9.5;
    const line = document.createElementNS(SVG, 'line');
    line.setAttribute('x1', String(dc * 3));
    line.setAttribute('y1', String(dr * 3));
    line.setAttribute('x2', String(dc * len));
    line.setAttribute('y2', String(dr * len));
    svg.append(line);
  });
  const hub = document.createElementNS(SVG, 'circle');
  hub.setAttribute('r', '2.2');
  svg.append(hub);
  return svg;
}
/** a stuck switch: a screw head (a ring with a slot), drawn in currentColor */
export function stuckIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '-12 -12 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'cell__stuck');
  const ring = document.createElementNS(SVG, 'circle');
  ring.setAttribute('r', '6.5');
  const slot = document.createElementNS(SVG, 'line');
  slot.setAttribute('x1', '-4');
  slot.setAttribute('y1', '4');
  slot.setAttribute('x2', '4');
  slot.setAttribute('y2', '-4');
  svg.append(ring, slot);
  return svg;
}
