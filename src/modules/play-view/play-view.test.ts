// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest';
import { bootModule, createFakeView } from '../../../test/fake-ctx';
import type { BoardState, Cells, HintsState, LearnState, LevelsState, ProgressState, State, TutorialState } from '../../contracts';
import { SEL } from '../../contracts';
import playView from './index';

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

  test('max stars and tiers follow hints used; no scoring hides them', () => {
    const { t, q } = boot({ board: board({ moves: 6 }), progress: progress(1) });
    const max = q('.play-max');
    expect(max.querySelectorAll('.star[data-state="on"]')).toHaveLength(2);
    expect(max.textContent).toBe('Up toHint used');
    expect(max.getAttribute('aria-label')).toBe('At most 2 of 3 stars still possible');
    const chips = [...document.querySelectorAll<HTMLElement>('.play-tiers .chip')];
    expect(chips.map((c) => c.firstChild!.textContent)).toEqual(['≤5', '≤8', '9+']);
    expect(chips.map((c) => c.dataset.state)).toEqual(['lost', 'now', undefined]);
    expect(chips.map((c) => c.querySelectorAll('.star[data-state="on"]').length)).toEqual([2, 1, 1]);

    const used = max.querySelector<HTMLElement>('.caption:last-child')!;
    expect(used.hidden).toBe(false);
    t.kernel.seed('progress', progress());
    expect(used.hidden).toBe(true);
    t.kernel.seed('progress', { ...progress(), scoring: undefined });
    expect(max.hidden).toBe(true);
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

  test('a solve ripples from the winning tap, then the sweep class is removed', () => {
    const view = { ...createFakeView(), reducedMotion: () => false };
    const t = bootModule(playView, { state: { board: board(), hints: IDLE, levels, progress: progress() }, services: { view } });
    const el = document.querySelector<HTMLElement>(SEL.board)!;
    t.kernel.seed('board', board({ status: 'solved', cells: cellsFrom('0'.repeat(25)), moves: 5, history: [1, 2, 3, 4, 24] }));
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
