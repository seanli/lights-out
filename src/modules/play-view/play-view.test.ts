// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest';
import { bootModule, createFakeView } from '../../../test/fake-ctx';
import type { BoardState, Cells, HintsState, LearnState, LevelsState, ProgressState, Shape, State, TutorialState } from '../../contracts';
import { SEL } from '../../contracts';
import { parseShape } from '../../lib/shape';
import playView from './index';
import { cellAt } from './grid';

const cellsFrom = (bits: string): Cells => Array.from(bits, (c) => c === '1');
const START = cellsFrom('0001010111110101000100011');

const board = (over: Partial<BoardState> = {}): BoardState => ({
  status: 'playing', levelId: 7, start: START, cells: START, par: 5, moves: 0, history: [], ...over,
});
const levels: LevelsState = {
  status: 'ready', list: [],
  chapters: [{ id: 'a', name: 'First light', from: 1, to: 5 }, { id: 'b', name: 'Crossfade', from: 6, to: 10 }],
};
const progress = (pending = 0): ProgressState => ({
  status: 'ready', unlockedUpTo: 7,
  save: { version: 1, results: {}, pendingHints: pending ? { '7': pending } : {}, lastLevel: 7 },
  scoring: { threeStarsWithin: 0, twoStarsWithin: 3, hintCost: 1, minStars: 1 },
});
const RING = parseShape(['XXXXXXX', 'XXXXXXX', 'XX...XX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXXXXX']);
const square = (n: number) => ({ cols: n, rows: n, mask: null });
/** a board of any shape: cell 0 lit (every shape here has a real cell at 0) */
const shaped = (shape: Shape, over: Partial<BoardState> = {}): BoardState => {
  const cells = new Array<boolean>(shape.cols * shape.rows).fill(false);
  cells[0] = true;
  return board({ levelId: 5001, start: cells, cells, shape, ...over });
};
const roomLevels: LevelsState = {
  ...levels,
  packs: [
    { id: 'classic', name: 'Classic', kind: 'classic', shape: square(5), first: 1, count: 50 },
    { id: 'ring', name: 'Ring', kind: 'shape', shape: RING, first: 5001, count: 12 },
  ],
};
const IDLE: HintsState = { status: 'idle', levelId: null, cell: null };
const LEARN: LearnState = { status: 'ready', lessonId: null, step: 0, completed: [], practice: null, assist: false };

function boot(state: Partial<State> = {}, services = {}) {
  const t = bootModule(playView, { state: { board: board(), hints: IDLE, levels, progress: progress(), ...state }, services });
  const q = <E extends Element = HTMLElement>(sel: string) => document.querySelector<E>(`${SEL.screen('play')} ${sel}`)!;
  const cell = (i: number) => q<HTMLButtonElement>(SEL.cell(i));
  const presses = () => t.all('board:press').map((p) => p.index);
  return { t, q, cell, presses };
}

const pointer = (el: Element, init: PointerEventInit = {}) =>
  el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'touch', ...init }));
const click = (el: Element, detail: number) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }));

beforeEach(() => document.body.replaceChildren());

describe('play-view', () => {
  test('renders 25 cells, stats and labels from the slices', () => {
    const { q, cell } = boot({ board: board({ moves: 2 }) });
    expect(document.querySelectorAll(SEL.cells)).toHaveLength(25);
    expect(cell(3).dataset.lit).toBe('true');
    expect(cell(0).dataset.lit).toBe('false');
    expect(cell(3).getAttribute('aria-pressed')).toBe('true');
    expect(cell(3).getAttribute('aria-label')).toBe('Light 1, 4: on');
    expect(cell(5).getAttribute('aria-label')).toBe('Light 2, 1: on');
    expect(q(SEL.moves).textContent).toBe('2');
    expect(q(SEL.par).textContent).toBe('5');
    expect(q('[data-level-label]').textContent).toBe('Level 7');
    expect(q('.screen-header__title .eyebrow').textContent).toBe('Chapter 2');
    expect(q(SEL.board).dataset.status).toBe('playing');
  });

  test('pointerdown presses at once; the click that follows does not press again', () => {
    const { cell, presses } = boot();
    pointer(cell(12));
    click(cell(12), 1);
    expect(presses()).toEqual([12]);
    // rapid taps are never dropped
    pointer(cell(4)); pointer(cell(4)); click(cell(4), 1);
    expect(presses()).toEqual([12, 4, 4]);
    // non-primary mouse buttons do nothing
    pointer(cell(6), { button: 2, pointerType: 'mouse' });
    expect(presses()).toEqual([12, 4, 4]);
  });

  test('keyboard Enter/Space (click with detail 0) presses; arrows move focus', () => {
    const { cell, presses } = boot();
    click(cell(7), 0);
    expect(presses()).toEqual([7]);
    cell(0).focus();
    cell(0).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(document.activeElement).toBe(cell(1));
    cell(1).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(cell(6));
    expect(cell(6).tabIndex).toBe(0);
    expect(cell(0).tabIndex).toBe(-1);
  });

  test('cells follow board changes; a solved board takes no taps', () => {
    const { t, cell, q, presses } = boot();
    t.kernel.seed('board', board({ cells: cellsFrom('1'.repeat(25)), moves: 1, history: [3] }));
    expect(cell(0).dataset.lit).toBe('true');
    expect(q(SEL.moves).textContent).toBe('1');
    t.kernel.seed('board', board({ status: 'solved', cells: cellsFrom('0'.repeat(25)), moves: 2, history: [3, 3] }));
    expect(q(SEL.board).dataset.status).toBe('solved');
    pointer(cell(0));
    expect(presses()).toEqual([]);
  });

  test('hint and tutorial pointer attributes follow the slices', () => {
    const { t, cell, q } = boot();
    expect(q('.tutorial-line[data-tone="hint"]').hidden).toBe(true);
    t.kernel.seed('hints', { status: 'showing', levelId: 7, cell: 8 } satisfies HintsState);
    expect(cell(8).dataset.hint).toBe('true');
    expect(document.querySelectorAll('[data-hint="true"][data-cell]')).toHaveLength(1);
    expect(q('.tutorial-line[data-tone="hint"]').hidden).toBe(false);
    t.kernel.seed('hints', IDLE);
    expect(cell(8).hasAttribute('data-hint')).toBe(false);

    const tut: TutorialState = { status: 'active', levelId: 7, step: 0, target: 12, copyKey: '1' };
    t.kernel.seed('tutorial', tut);
    expect(cell(12).dataset.pointer).toBe('true');
    t.kernel.seed('tutorial', { ...tut, target: 2 });
    expect(cell(12).hasAttribute('data-pointer')).toBe(false);
    expect(cell(2).dataset.pointer).toBe('true');
    t.kernel.seed('tutorial', { ...tut, status: 'done', target: null });
    expect(document.querySelectorAll('[data-pointer="true"]')).toHaveLength(0);
  });

  test('the coach slot sits under the board', () => {
    const { t, q } = boot();
    const coach = t.view!.region('slot:coach');
    expect(q('.board-slot').contains(coach)).toBe(true);
  });

  test('undo, restart and hint enable and disable with the state', () => {
    const { t, q } = boot();
    const off = (name: string) => q(SEL.action(name)).getAttribute('aria-disabled') === 'true';
    expect(off('undo')).toBe(true);
    expect(off('restart')).toBe(true);
    expect(off('hint')).toBe(false);
    t.kernel.seed('board', board({ moves: 1, history: [4] }));
    expect(off('undo')).toBe(false);
    expect(off('restart')).toBe(false);
    q(SEL.action('undo')).click();
    q(SEL.action('restart')).click();
    q(SEL.action('hint')).click();
    expect(t.all('board:undo')).toHaveLength(1);
    expect(t.all('board:restart')).toHaveLength(1);
    expect(t.all('hints:request')).toHaveLength(1);

    t.kernel.seed('hints', { status: 'showing', levelId: 7, cell: 1 } satisfies HintsState);
    expect(off('hint')).toBe(true);
    q(SEL.action('hint')).click();
    expect(t.all('hints:request')).toHaveLength(1);

    t.kernel.seed('hints', IDLE);
    t.kernel.seed('board', board({ status: 'solved', moves: 3, history: [1, 2, 3] }));
    expect(off('undo')).toBe(true);
    expect(off('hint')).toBe(true);
    q(SEL.action('undo')).click();
    expect(t.all('board:undo')).toHaveLength(1);
  });

  test('the hint button is gone when there is no hints slice', () => {
    const t = bootModule(playView, { state: { board: board(), levels, progress: progress() } });
    expect(document.querySelector<HTMLElement>(SEL.action('hint'))!.hidden).toBe(true);
    expect(t.state('board').levelId).toBe(7);
  });

  test('tiers follow hints used, with a hint chip; no scoring hides them; no "Up to" box in the header', () => {
    const { t, q } = boot({ board: board({ moves: 6 }), progress: progress(1) });
    expect(document.querySelector('.play-max')).toBeNull();
    const chips = [...document.querySelectorAll<HTMLElement>('.play-tiers .chip:not([data-state="hint"])')];
    expect(chips.map((c) => c.firstChild!.textContent)).toEqual(['≤5', '≤8', '9+']);
    expect(chips.map((c) => c.dataset.state)).toEqual(['lost', 'now', undefined]);
    expect(chips.map((c) => c.querySelectorAll('.star[data-state="on"]').length)).toEqual([2, 1, 1]);
    expect(q('.play-tiers').getAttribute('aria-label')).toBe('At most 2 of 3 stars still possible');

    const hint = q('.play-tiers .chip[data-state="hint"]');
    expect(hint.hidden).toBe(false);
    expect(hint.textContent).toBe('−1★hint');
    expect(hint.getAttribute('aria-label')).toBe('Hint used: 1 star fewer');
    t.kernel.seed('progress', progress(2));
    expect(hint.textContent).toBe('−2★hints');
    t.kernel.seed('progress', progress());
    expect(hint.hidden).toBe(true);
    t.kernel.seed('progress', { ...progress(), scoring: undefined });
    expect(q('.play-tiers').hidden).toBe(true);
  });

  test('back goes home', () => {
    const { t, q } = boot();
    q(SEL.action('back')).click();
    expect(t.seen('nav:go')).toEqual({ screen: 'home' });
  });

  test('the hint button is disabled while the tutorial coaches; its ring wins over a hint mark', () => {
    const tut: TutorialState = { status: 'active', levelId: 7, step: 0, target: 12, copyKey: '1' };
    const { t, q, cell } = boot({ tutorial: tut });
    expect(q(SEL.action('hint')).getAttribute('aria-disabled')).toBe('true');
    t.kernel.seed('hints', { status: 'showing', levelId: 7, cell: 12 } satisfies HintsState);
    expect(cell(12).dataset.pointer).toBe('true');
    expect(document.querySelectorAll('[data-cell][data-hint]')).toHaveLength(0);
    t.kernel.seed('tutorial', { ...tut, status: 'done', target: null });
    expect(cell(12).dataset.hint).toBe('true');
    t.kernel.seed('hints', IDLE);
    expect(q(SEL.action('hint')).getAttribute('aria-disabled')).toBeNull();
  });

  describe('pattern reference', () => {
    const screen = () => document.querySelector<HTMLElement>(SEL.screen('play'))!;

    test('no learn slice: no button', () => {
      const { q } = boot();
      expect(q(SEL.action('reference')).hidden).toBe(true);
    });

    test('the button toggles the panel; Escape closes it; the slot is placed once', () => {
      const { t, q } = boot({ learn: LEARN });
      const btn = q(SEL.action('reference'));
      expect(btn.hidden).toBe(false);
      expect(screen().dataset.reference).toBe('closed');
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      const slot = t.view!.region('slot:reference');
      expect(document.getElementById(btn.getAttribute('aria-controls')!)!.contains(slot)).toBe(true);

      btn.click();
      expect(screen().dataset.reference).toBe('open');
      expect(btn.getAttribute('aria-expanded')).toBe('true');
      expect(screen().querySelectorAll('[data-slot="reference"]')).toHaveLength(1);
      btn.click();
      expect(screen().dataset.reference).toBe('closed');
      btn.click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(screen().dataset.reference).toBe('closed');
      expect(btn.getAttribute('aria-expanded')).toBe('false');
    });

    test('board presses still work while it is open, and it stays open on the next level', () => {
      const { t, q, cell, presses } = boot({ learn: LEARN });
      q(SEL.action('reference')).click();
      pointer(cell(6));
      click(cell(6), 1);
      click(cell(7), 0);
      expect(presses()).toEqual([6, 7]);
      t.kernel.seed('board', board({ levelId: 8 }));
      expect(screen().dataset.reference).toBe('open');
    });

    test('a toggle during a press waits for the finger to lift', () => {
      const { q, cell } = boot({ learn: LEARN });
      pointer(cell(3));
      q(SEL.action('reference')).click();
      expect(screen().dataset.reference).toBe('closed');
      document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
      expect(screen().dataset.reference).toBe('open');
    });
  });

  describe('any board shape', () => {
    test.each([[4, 16], [6, 36], [7, 49]])('%i×%i renders %i real cells', (n, count) => {
      boot({ board: shaped(square(n)) });
      const el = document.querySelector<HTMLElement>(SEL.board)!;
      expect(document.querySelectorAll(SEL.cells)).toHaveLength(count);
      expect(document.querySelectorAll('[data-gap]')).toHaveLength(0);
      expect([el.dataset.n, el.dataset.cols, el.dataset.rows]).toEqual([String(n), String(n), String(n)]);
    });

    test('the Ring: 40 cells and 9 gaps that are not buttons and take no focus', () => {
      boot({ board: shaped(RING) });
      expect(document.querySelectorAll(SEL.cells)).toHaveLength(40);
      const gaps = [...document.querySelectorAll<HTMLElement>(`${SEL.board} > [data-gap]`)];
      expect(gaps).toHaveLength(9);
      for (const g of gaps) {
        expect(g.tagName).not.toBe('BUTTON');
        expect(g.hasAttribute('data-cell')).toBe(false);
        expect(g.getAttribute('aria-hidden')).toBe('true');
        expect(g.hasAttribute('tabindex')).toBe(false);
      }
      // grid order is kept: slot 16 (row 3, col 3) is a gap, 14 and 20 are cells
      const slots = [...document.querySelector(SEL.board)!.children] as HTMLElement[];
      expect(slots).toHaveLength(49);
      expect(slots[16]!.hasAttribute('data-gap')).toBe(true);
      expect(slots[14]!.dataset.index).toBe('14');
      expect(slots[20]!.dataset.index).toBe('20');
    });

    test('the grid is rebuilt only when the shape changes; a press updates in place', () => {
      const { t, cell } = boot({ board: shaped(RING) });
      const before = cell(0);
      t.kernel.seed('board', shaped(RING, { cells: shaped(RING).cells.map((_, i) => i === 1), moves: 1, history: [0] }));
      expect(cell(0)).toBe(before);
      expect(cell(1).dataset.lit).toBe('true');
      t.kernel.seed('board', board());
      expect(document.querySelectorAll(SEL.cells)).toHaveLength(25);
      expect(document.querySelectorAll('[data-gap]')).toHaveLength(0);
      expect(document.querySelector<HTMLElement>(SEL.board)!.dataset.n).toBe('5');
    });

    test('a press on a gap slot emits nothing; a press in the gutter presses the cell whose slot holds it', () => {
      const { presses } = boot({ board: shaped(RING) });
      const el = document.querySelector<HTMLElement>(SEL.board)!;
      const gap = el.querySelector('[data-gap]')!;
      pointer(gap);
      click(gap, 1);
      expect(presses()).toEqual([]);
      // happy-dom has no layout: give the board a 7×7 box of 350px (pad 6, gap 4) and press between cells
      el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 350, height: 350, right: 350, bottom: 350, x: 0, y: 0, toJSON() {} }) as DOMRect;
      el.style.padding = '6px';
      el.style.columnGap = '4px';
      el.style.rowGap = '4px';
      pointer(el, { clientX: 2, clientY: 2 }); // the padding by the top-left corner → cell 0
      pointer(el, { clientX: 54, clientY: 30 }); // the gutter just right of cell 0 → cell 1 (slots are 48.3px)
      pointer(el, { clientX: 175, clientY: 175 }); // the hole in the middle → nothing
      expect(presses()).toEqual([0, 1]);
    });

    test('gutter geometry: each slot owns half the gap on each side; gap slots press nothing', () => {
      const box = { width: 350, height: 350, padX: 6, padY: 6, gapX: 4, gapY: 4 };
      const pitch = (350 - 12 + 4) / 7;
      expect(cellAt(RING, 0, 0, box)).toBe(0);
      expect(cellAt(RING, 6 + pitch - 2.5, 10, box)).toBe(0); // left half of the gap after cell 0
      expect(cellAt(RING, 6 + pitch - 1.5, 10, box)).toBe(1); // right half
      expect(cellAt(RING, 349, 349, box)).toBe(48);
      expect(cellAt(RING, 175, 175, box)).toBe(-1);
      expect(cellAt(RING, 400, 10, box)).toBe(-1);
    });

    test('arrow keys skip gaps', () => {
      const { cell } = boot({ board: shaped(RING) });
      const key = (i: number, k: string) => cell(i).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      cell(15).focus();
      key(15, 'ArrowRight'); // 16, 17, 18 are gaps
      expect(document.activeElement).toBe(cell(19));
      key(19, 'ArrowLeft');
      expect(document.activeElement).toBe(cell(15));
      cell(9).focus();
      key(9, 'ArrowDown'); // 16, 23, 30 are gaps
      expect(document.activeElement).toBe(cell(37));
      key(37, 'End');
      expect(document.activeElement).toBe(cell(41));
      expect(cell(41).tabIndex).toBe(0);
      expect(cell(37).tabIndex).toBe(-1);
    });

    test('a room level: the header shows the room name and the level within it', () => {
      const { q } = boot({ board: shaped(RING, { levelId: 5003 }), levels: roomLevels });
      expect(q('.screen-header__title .eyebrow').textContent).toBe('Ring');
      expect(q('[data-level-label]').textContent).toBe('Level 3');
    });

    test('the Patterns button stays on every board', () => {
      const { q } = boot({ board: shaped(RING), levels: roomLevels, learn: LEARN });
      expect(q(SEL.action('reference')).hidden).toBe(false);
    });

    test('a solve on the Ring sweeps over real cells only', async () => {
      const view = { ...createFakeView(), reducedMotion: () => false };
      const t = bootModule(playView, { state: { board: shaped(RING), hints: IDLE, levels: roomLevels, progress: progress() }, services: { view } });
      const off = new Array<boolean>(49).fill(false);
      t.kernel.seed('board', shaped(RING, { status: 'solved', cells: off, moves: 1, history: [0] }));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const delay = (i: number) => Number(document.querySelector<HTMLElement>(SEL.cell(i))!.style.getPropertyValue('--i'));
      expect(delay(0)).toBe(0);
      expect(delay(48)).toBeGreaterThan(delay(8));
      expect(document.querySelectorAll('[data-gap][style]')).toHaveLength(0);
    });
  });

  describe('feel', () => {
    test('flip markers on the changed cells: the pressed cell at 0ms, its neighbours staggered', () => {
      const { t, cell } = boot();
      const after = START.slice();
      for (const i of [12, 7, 17, 11, 13]) after[i] = !after[i];
      t.kernel.seed('board', board({ cells: after, moves: 1, history: [12] }));
      const flipped = [...document.querySelectorAll<HTMLElement>('[data-cell][data-flip]')].map((c) => Number(c.dataset.index)).sort((a, b) => a - b);
      expect(flipped).toEqual([7, 11, 12, 13, 17]);
      expect(cell(12).style.getPropertyValue('--flip-delay')).toBe('0ms');
      expect(cell(7).style.getPropertyValue('--flip-delay')).toBe('var(--flip-stagger)');
      // undo changes the same cells all at once
      t.kernel.seed('board', board({ cells: START, moves: 0, history: [] }));
      expect(cell(7).style.getPropertyValue('--flip-delay')).toBe('0ms');
      // a level load sets no flip markers (the intro covers it)
      t.kernel.seed('board', board({ levelId: 8, cells: after }));
      expect(document.querySelectorAll('[data-cell][data-flip]')).toHaveLength(0);
    });

    test('the moves numeral bumps on a change', () => {
      const { t, q } = boot();
      expect(q(SEL.moves).classList.contains('stat__value--bump')).toBe(false);
      t.kernel.seed('board', board({ moves: 1, history: [3] }));
      expect(q(SEL.moves).classList.contains('stat__value--bump')).toBe(true);
    });

    test('coaching hides the tiers and the hint (data-coaching on the screen)', () => {
      const tut: TutorialState = { status: 'active', levelId: 7, step: 0, target: 12, copyKey: '1' };
      const { t } = boot({ tutorial: tut });
      const screen = document.querySelector<HTMLElement>(SEL.screen('play'))!;
      expect(screen.dataset.coaching).toBe('true');
      t.kernel.seed('tutorial', { ...tut, status: 'done', target: null });
      expect(screen.hasAttribute('data-coaching')).toBe(false);
    });

    test('a new level lights up with the intro; the first press ends it', () => {
      const view = { ...createFakeView(), reducedMotion: () => false };
      const t = bootModule(playView, { state: { board: board(), hints: IDLE, levels, progress: progress() }, services: { view } });
      const el = document.querySelector<HTMLElement>(SEL.board)!;
      expect(el.classList.contains('board--intro')).toBe(true);
      const cell3 = document.querySelector<HTMLElement>(SEL.cell(3))!;
      expect(cell3.style.getPropertyValue('--i')).toBe('3');
      t.kernel.seed('board', board({ moves: 1, history: [0] }));
      expect(el.classList.contains('board--intro')).toBe(false);
      t.kernel.seed('board', board({ levelId: 8 }));
      expect(el.classList.contains('board--intro')).toBe(true);
      t.clock.advance(1000);
      expect(el.classList.contains('board--intro')).toBe(false);
    });
  });

  test('a solve ripples from the winning tap (starting on the next frame), then the sweep class is removed', async () => {
    const view = { ...createFakeView(), reducedMotion: () => false };
    const t = bootModule(playView, { state: { board: board(), hints: IDLE, levels, progress: progress() }, services: { view } });
    const el = document.querySelector<HTMLElement>(SEL.board)!;
    t.kernel.seed('board', board({ status: 'solved', cells: cellsFrom('0'.repeat(25)), moves: 5, history: [1, 2, 3, 4, 24] }));
    expect(el.classList.contains('board--sweep')).toBe(false); // the tap itself stays light
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(el.classList.contains('board--sweep')).toBe(true);
    expect(el.dataset.status).toBe('solved');
    const delay = (i: number) => Number(document.querySelector<HTMLElement>(SEL.cell(i))!.style.getPropertyValue('--i'));
    expect(delay(24)).toBe(0);
    expect(delay(0)).toBeGreaterThan(delay(18));
    // a new level clears the sweep
    t.kernel.seed('board', board({ levelId: 8 }));
    expect(el.classList.contains('board--sweep')).toBe(false);
    expect(el.dataset.status).toBe('playing');
  });
});
