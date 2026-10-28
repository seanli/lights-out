// Shared inline icons (24×24, stroke = currentColor), so every view draws the same picture.

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
