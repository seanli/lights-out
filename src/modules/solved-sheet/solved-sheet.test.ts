// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest';
import type { LevelsState, ModuleDef, State } from '../../contracts';
import { SEL } from '../../contracts';
import { bootModule, createFakeView, fixtureData } from '../../../test/fake-ctx';
import { createFakeClock, createKernel } from '../../kernel';
import solvedSheet from './index';

const COUNT = 50;
const cells = Array.from({ length: 25 }, (_, i) => i === 12);
const levels: LevelsState = {
  status: 'ready',
  list: Array.from({ length: COUNT }, (_, i) => ({ id: i + 1, cells, par: 5 })),
  chapters: [{ id: 'all', name: 'All', from: 1, to: COUNT }],
};
const scoring = { threeStarsWithin: 0, twoStarsWithin: 3, hintCost: 1, minStars: 1 };
const progress: State['progress'] = { status: 'ready', save: { version: 1, results: {}, pendingHints: {}, lastLevel: 7 }, unlockedUpTo: 8, scoring };
const DELAY = 800;

function boot(state: Partial<State> = {}) {
  return bootModule(solvedSheet, { state: { levels, progress, nav: { screen: 'play', sheet: null }, ...state } });
}
const sheet = () => document.querySelector<HTMLElement>(SEL.sheet('solved'))!;
const q = <T extends HTMLElement = HTMLElement>(sel: string) => sheet().querySelector<T>(sel)!;
const completed = (o: Partial<{ levelId: number; stars: 1 | 2 | 3; moves: number; par: number; hintsUsed: number; unlocked: number | null; allSolved: boolean }> = {}) => ({
  levelId: 7, stars: 2 as const, moves: 6, par: 5, hintsUsed: 0, improved: true, unlocked: 8, allSolved: false, ...o,
});

/** a module that reacts to board:solved by emitting progress's verdict, to put both in one drain */
function relay(): ModuleDef {
  return {
    manifest: { name: 'relay', emits: ['progress:level_completed'], listens: ['board:solved'], owns: [] },
    init(ctx) {
      ctx.on('board:solved', (p) => ctx.emit('progress:level_completed', completed({ levelId: p.levelId, moves: p.moves, par: p.par })));
    },
  };
}

beforeEach(() => document.body.replaceChildren());

describe('solved-sheet', () => {
  test('opens after delayMs, with stars, result and a nudge to par', () => {
    const t = boot();
    t.emit('board:solved', { levelId: 7, moves: 6, par: 5 });
    t.emit('progress:level_completed', completed());
    expect(t.all('nav:open_sheet')).toEqual([]);
    t.clock.advance(DELAY - 1);
    expect(t.all('nav:open_sheet')).toEqual([]);
    t.clock.advance(1);
    expect(t.all('nav:open_sheet')).toEqual([{ sheet: 'solved' }]);
    expect(q('.eyebrow').textContent).toBe('Level 7 · solved');
    expect(q('.sheet__title').textContent).toBe('Lights out.');
    expect(q('[data-stars-earned]').dataset.starsEarned).toBe('2');
    expect(q('[data-stars-earned]').querySelectorAll('.star[data-state="on"]').length).toBe(2);
    expect(q('[data-result]').textContent).toBe('6 moves · par 5');
    expect(q('.sheet__note').textContent).toBe('1 over par. Replay in 5 for three stars.');
    expect(q(SEL.action('next')).textContent).toBe('Next level·8');
  });

  test('progress before or after board:solved in the same drain gives the same sheet', () => {
    for (const first of [true, false]) {
      document.body.replaceChildren();
      const t = boot();
      if (first) t.emit('progress:level_completed', completed({ stars: 3, moves: 5 }));
      t.emit('board:solved', { levelId: 7, moves: 5, par: 5 });
      if (!first) t.emit('progress:level_completed', completed({ stars: 3, moves: 5 }));
      t.clock.advance(DELAY);
      expect(q('[data-stars-earned]').dataset.starsEarned).toBe('3');
      expect(q('.sheet__note').textContent).toBe('Solved in par.');
    }
  });

  test('a verdict emitted inside the board:solved drain is picked up, whatever the handler order', () => {
    // a stand-in progress module registered before or after this one: its verdict lands in the same drain
    for (const relayFirst of [true, false]) {
      document.body.replaceChildren();
      const clock = createFakeClock();
      const k = createKernel({ data: fixtureData, clock });
      k.provide('view', createFakeView());
      for (const [slice, value] of Object.entries({ levels, progress, nav: { screen: 'play', sheet: null } })) k.seed(slice, value);
      if (relayFirst) { k.register(relay()); k.register(solvedSheet); } else { k.register(solvedSheet); k.register(relay()); }
      k.boot();
      k.emit('board:solved', { levelId: 7, moves: 6, par: 5 });
      clock.advance(DELAY);
      expect(k.debug.events().some((e) => e.type === 'nav:open_sheet')).toBe(true);
      expect(q('[data-stars-earned]').dataset.starsEarned).toBe('2');
    }
  });

  test('a stale verdict for another level is ignored', () => {
    const t = boot();
    t.emit('progress:level_completed', completed({ levelId: 3, stars: 3 }));
    t.emit('board:solved', { levelId: 7, moves: 9, par: 5 });
    t.clock.advance(DELAY);
    expect(q('.stars').hidden).toBe(true);
    expect(q('.stars').hasAttribute('data-stars-earned')).toBe(false);
  });

  test('hinted solve says so and shows the lost star as an outline', () => {
    const t = boot();
    t.emit('board:solved', { levelId: 7, moves: 5, par: 5 });
    t.emit('progress:level_completed', completed({ stars: 2, moves: 5, hintsUsed: 1 }));
    t.clock.advance(DELAY);
    expect(q('.sheet__note').textContent).toBe('Solve it without a hint for more stars.');
    const states = [...q('.stars').querySelectorAll<HTMLElement>('.star')].map((s) => s.dataset.state);
    expect(states).toEqual(['on', 'on', 'lost']);
  });

  test('without progress: moves vs par and no stars', () => {
    const t = boot({ progress: undefined });
    t.emit('board:solved', { levelId: 4, moves: 3, par: 3 });
    t.clock.advance(DELAY);
    expect(t.seen('nav:open_sheet')).toEqual({ sheet: 'solved' });
    expect(q('.stars').hidden).toBe(true);
    expect(q('[data-result]').textContent).toBe('3 moves · par 3');
    expect(q('.sheet__note').textContent).toBe('Solved in par.');
  });

  test('next, replay and levels emit the right events', () => {
    const t = boot();
    t.emit('board:solved', { levelId: 7, moves: 6, par: 5 });
    t.clock.advance(DELAY);
    q<HTMLButtonElement>(SEL.action('next')).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 8 });
    q<HTMLButtonElement>(SEL.action('replay')).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 7 });
    q<HTMLButtonElement>(SEL.action('levels')).click();
    expect(t.seen('nav:go')).toEqual({ screen: 'home' });
  });

  test('the last level shows the all-done copy and the primary action goes to the levels', () => {
    const t = boot();
    t.emit('board:solved', { levelId: COUNT, moves: 15, par: 15 });
    t.emit('progress:level_completed', completed({ levelId: COUNT, stars: 3, moves: 15, par: 15, unlocked: null, allSolved: true }));
    t.clock.advance(DELAY);
    expect(q('.sheet__title').textContent).toBe('All 50 levels solved.');
    expect(q('.sheet__note').textContent).toBe('Replay any level to collect the stars you missed.');
    expect(q(SEL.action('next')).hidden).toBe(true);
    const levelsBtn = q<HTMLButtonElement>(SEL.action('levels'));
    expect(levelsBtn.classList.contains('btn--primary')).toBe(true);
    expect(levelsBtn.hasAttribute('data-autofocus')).toBe(true);
    levelsBtn.click();
    expect(t.seen('nav:go')).toEqual({ screen: 'home' });
    expect(t.all('levels:start')).toEqual([]);
  });

  test('the last level with gaps left still has no next level', () => {
    const t = boot();
    t.emit('board:solved', { levelId: COUNT, moves: 16, par: 15 });
    t.emit('progress:level_completed', completed({ levelId: COUNT, stars: 2, moves: 16, par: 15, unlocked: null, allSolved: false }));
    t.clock.advance(DELAY);
    expect(q('.sheet__title').textContent).toBe('Lights out.');
    expect(q(SEL.action('next')).hidden).toBe(true);
    expect(sheet().textContent).toContain('That was the last level.');
  });

  test('a new level start before the delay cancels the sheet', () => {
    const t = boot();
    t.emit('board:solved', { levelId: 7, moves: 6, par: 5 });
    t.clock.advance(DELAY / 2);
    t.emit('levels:started', { levelId: 8, par: 5, count: COUNT });
    t.clock.advance(DELAY);
    expect(t.all('nav:open_sheet')).toEqual([]);
    expect(t.clock.pending()).toBe(0);
  });

  test('leaving the play screen before the delay cancels the sheet', () => {
    const t = boot();
    t.emit('board:solved', { levelId: 7, moves: 6, par: 5 });
    t.kernel.seed('nav', { screen: 'home', sheet: null });
    t.clock.advance(DELAY);
    expect(t.all('nav:open_sheet')).toEqual([]);
  });

  test('tapping the backdrop does nothing', () => {
    const t = boot();
    t.emit('board:solved', { levelId: 7, moves: 6, par: 5 });
    t.clock.advance(DELAY);
    const before = t.events().length;
    sheet().click();
    q<HTMLElement>('.sheet__title').click();
    expect(t.events().length).toBe(before);
  });
});
