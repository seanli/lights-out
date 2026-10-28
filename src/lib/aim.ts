// Pointer handling for boards whose cells are hard to hit or that scroll. Pure DOM helper: no state outside the
// returned handle, no events of its own; the caller decides what a press means.
//
//   'tap'  a board that scrolls (the Tower): a press lands on release, and only if the finger barely moved,
//          so a swipe scrolls and never presses.
//   'aim'  cells under the tap minimum (10×10, 8×8 on narrow phones): pressing shows a bubble above the finger
//          magnifying the target and its neighbours; slide to adjust; lift to press; cancel presses nothing.
//
// Styled by `.aim-bubble` in src/shell/styles/components.css. Mouse and pen work the same way as touch.

export type AimMode = 'tap' | 'aim';

export interface AimOptions {
  /** current mode, read on every pointerdown (the layout can change between presses) */
  mode: () => AimMode | null;
  /** the cell index at a client point, or -1 (a gap or outside the board) */
  cellAt: (x: number, y: number) => number;
  /** lit state of a grid index for the bubble: true/false, or null for a gap or off the board */
  litAt: (index: number) => boolean | null;
  /** what is drawn on a grid index (a stuck plate, wiring): a node the bubble copies, or null */
  markAt?: (index: number) => Node | null;
  /** grid columns (to find a cell's neighbours) */
  cols: () => number;
  press: (index: number) => void;
  /** called when the aimed cell changes (-1 = none), so the board can mark it */
  onAim?: (index: number) => void;
  /** movement in px after which a 'tap' becomes a scroll */
  slop?: number;
}

export interface AimHandle {
  /** true while a pointer is being handled (the caller should ignore its own pointerdown/click) */
  active(): boolean;
  destroy(): void;
}

const BUBBLE_GAP = 104; // px between the finger and the bubble's centre: clear of a thumb under a 156px bubble

export function attachAim(grid: HTMLElement, opts: AimOptions): AimHandle {
  const slop = opts.slop ?? 10;
  let pointer: number | null = null;
  let mode: AimMode | null = null;
  let startX = 0, startY = 0, moved = false, target = -1;
  let bubble: HTMLElement | null = null;
  const tiles: HTMLElement[] = [];

  function ensureBubble(): HTMLElement {
    if (bubble) return bubble;
    bubble = document.createElement('div');
    bubble.className = 'aim-bubble';
    bubble.setAttribute('data-aim-bubble', '');
    bubble.setAttribute('aria-hidden', 'true');
    for (let k = 0; k < 9; k++) { const t = document.createElement('i'); tiles.push(t); bubble.append(t); }
    document.body.append(bubble);
    return bubble;
  }

  function showBubble(x: number, y: number) {
    const b = ensureBubble();
    const cols = opts.cols();
    const r = target >= 0 ? Math.floor(target / cols) : 0, c = target >= 0 ? target % cols : 0;
    tiles.forEach((t, k) => {
      const dr = Math.floor(k / 3) - 1, dc = (k % 3) - 1;
      const rr = r + dr, cc = c + dc;
      const lit = target >= 0 && cc >= 0 && cc < cols && rr >= 0 ? opts.litAt(rr * cols + cc) : null;
      t.dataset.state = lit === null ? 'none' : lit ? 'on' : 'off';
      // the cell's marks, copied once per aimed cell (a stuck switch or its wiring must read in the bubble too)
      const index = lit === null ? -1 : rr * cols + cc;
      if (t.dataset.index !== String(index)) {
        t.dataset.index = String(index);
        const m = index >= 0 ? opts.markAt?.(index) : null;
        t.replaceChildren(...(m ? [m.cloneNode(true)] : []));
      }
      if (k === 4) t.dataset.target = target >= 0 ? 'true' : 'false';
    });
    // keep it on screen; above the finger, or below it near the top edge
    const half = b.offsetWidth / 2 || 60;
    const left = Math.min(Math.max(x, half + 4), window.innerWidth - half - 4);
    const top = y - BUBBLE_GAP < half + 4 ? y + BUBBLE_GAP : y - BUBBLE_GAP;
    b.style.transform = `translate(${left - half}px, ${top - half}px)`;
    b.dataset.open = 'true';
  }

  function hideBubble() {
    if (!bubble) return;
    bubble.dataset.open = 'false';
    for (const t of tiles) delete t.dataset.index; // the next level may draw other marks on the same cells
  }

  function aimAt(x: number, y: number) {
    const i = opts.cellAt(x, y);
    if (i !== target) { target = i; opts.onAim?.(i); }
    if (mode === 'aim') showBubble(x, y);
  }

  function end(commit: boolean) {
    if (pointer === null) return;
    try { grid.releasePointerCapture(pointer); } catch { /* already released */ }
    pointer = null;
    hideBubble();
    const i = target;
    target = -1;
    opts.onAim?.(-1);
    if (commit && i >= 0 && (mode === 'aim' || !moved)) opts.press(i);
    mode = null;
  }

  const down = (e: PointerEvent) => {
    if (pointer !== null || !e.isPrimary || e.button > 0) return;
    const m = opts.mode();
    if (!m) return;
    mode = m;
    pointer = e.pointerId;
    startX = e.clientX; startY = e.clientY; moved = false; target = -1;
    if (m === 'aim') {
      e.preventDefault(); // no scroll, no text selection, no synthetic click while aiming
      try { grid.setPointerCapture(e.pointerId); } catch { /* fine without */ }
    }
    aimAt(e.clientX, e.clientY);
  };
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > slop) moved = true;
    if (mode === 'aim') aimAt(e.clientX, e.clientY);
    else if (moved && target >= 0) { target = -1; opts.onAim?.(-1); }
  };
  const up = (e: PointerEvent) => { if (e.pointerId === pointer) end(true); };
  const cancel = (e: PointerEvent) => { if (e.pointerId === pointer) end(false); };

  grid.addEventListener('pointerdown', down);
  grid.addEventListener('pointermove', move);
  grid.addEventListener('pointerup', up);
  grid.addEventListener('pointercancel', cancel);
  grid.addEventListener('lostpointercapture', cancel);

  return {
    active: () => pointer !== null,
    destroy() {
      end(false);
      grid.removeEventListener('pointerdown', down);
      grid.removeEventListener('pointermove', move);
      grid.removeEventListener('pointerup', up);
      grid.removeEventListener('pointercancel', cancel);
      grid.removeEventListener('lostpointercapture', cancel);
      bubble?.remove();
      bubble = null;
      tiles.length = 0;
    },
  };
}
