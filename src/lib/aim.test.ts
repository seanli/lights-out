// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { attachAim, type AimMode } from './aim';

function setup(mode: AimMode, markAt?: (i: number) => Node | null) {
  const grid = document.createElement('div');
  document.body.append(grid);
  const pressed: number[] = [];
  const aims: number[] = [];
  // a 4-wide grid of 10px cells starting at 0,0
  const handle = attachAim(grid, {
    mode: () => mode,
    cellAt: (x, y) => (x >= 0 && y >= 0 && x < 40 && y < 40 ? Math.floor(y / 10) * 4 + Math.floor(x / 10) : -1),
    litAt: (i) => (i >= 0 && i < 16 ? i % 2 === 0 : null),
    cols: () => 4,
    ...(markAt ? { markAt } : {}),
    press: (i) => pressed.push(i),
    onAim: (i) => aims.push(i),
  });
  const fire = (type: string, x: number, y: number) =>
    grid.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, isPrimary: true, button: 0, bubbles: true, cancelable: true }));
  return { grid, pressed, aims, handle, fire };
}

describe('attachAim', () => {
  test('tap: a press lands on release', () => {
    const { pressed, fire, handle } = setup('tap');
    fire('pointerdown', 15, 5);
    expect(handle.active()).toBe(true);
    expect(pressed).toEqual([]);
    fire('pointerup', 15, 5);
    expect(pressed).toEqual([1]);
    expect(handle.active()).toBe(false);
  });
  test('tap: a swipe or a cancelled touch presses nothing', () => {
    const { pressed, fire } = setup('tap');
    fire('pointerdown', 15, 5); fire('pointermove', 15, 30); fire('pointerup', 15, 30);
    fire('pointerdown', 15, 5); fire('pointercancel', 15, 5);
    expect(pressed).toEqual([]);
  });
  test('aim: the bubble follows the finger and the cell under it at release is pressed', () => {
    const { pressed, aims, fire } = setup('aim');
    fire('pointerdown', 5, 5);
    const bubble = document.querySelector<HTMLElement>('[data-aim-bubble]')!;
    expect(bubble.dataset.open).toBe('true');
    expect([...bubble.children].map((t) => (t as HTMLElement).dataset.state)).toEqual(['none', 'none', 'none', 'none', 'on', 'off', 'none', 'on', 'off']);
    fire('pointermove', 25, 15);
    fire('pointerup', 25, 15);
    expect(pressed).toEqual([6]);
    expect(aims).toEqual([0, 6, -1]);
    expect(bubble.dataset.open).toBe('false');
  });
  test('aim: the bubble copies each cell\'s marks (a stuck plate, wiring) and redraws them when the aim moves', () => {
    // cell 5 carries a mark; the copy is a clone, so the board keeps its own
    const mark = document.createElement('span');
    mark.className = 'cell__mark';
    const { fire, handle } = setup('aim', (i) => (i === 5 ? mark : null));
    fire('pointerdown', 5, 5); // aim at 0: cell 5 sits bottom-right of the bubble
    const bubble = [...document.querySelectorAll<HTMLElement>('[data-aim-bubble]')].at(-1)!;
    const marked = () => [...bubble.children].map((t) => (t.querySelector('.cell__mark') ? 1 : 0));
    expect(marked()).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(bubble.querySelector('.cell__mark')).not.toBe(mark);
    fire('pointermove', 15, 15); // aim at 5: its mark moves to the middle
    expect(marked()).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
    fire('pointerup', 15, 15);
    handle.destroy();
  });
  test('aim: lifting off the board presses nothing', () => {
    const { pressed, fire } = setup('aim');
    fire('pointerdown', 5, 5); fire('pointermove', 80, 80); fire('pointerup', 80, 80);
    expect(pressed).toEqual([]);
  });
});
