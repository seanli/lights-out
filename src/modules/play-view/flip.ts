// FLIP: animate elements from where they were to where a layout change put them (transform + scale only).

export type Boxes = DOMRect[];

export function measure(els: readonly HTMLElement[]): Boxes {
  return els.map((el) => el.getBoundingClientRect());
}

/** call after the layout changed; `before` comes from measure() taken just before the change */
export function flip(els: readonly HTMLElement[], before: Boxes, durationMs: number): void {
  if (!(durationMs > 0) || typeof Element.prototype.animate !== 'function') return;
  els.forEach((el, k) => {
    const a = before[k]!, b = el.getBoundingClientRect();
    if (!a.width || !b.width || el.hidden) return;
    const dx = a.left - b.left, dy = a.top - b.top, s = a.width / b.width;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.01) return;
    el.animate(
      [{ transformOrigin: 'top left', transform: `translate(${dx}px, ${dy}px) scale(${s})` }, { transformOrigin: 'top left', transform: 'none' }],
      { duration: durationMs, easing: 'cubic-bezier(.2, .8, .2, 1)' },
    );
  });
}
