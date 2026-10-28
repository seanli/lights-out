// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest';
import type { LevelDef, LevelsState, ModuleDef, Pack, State } from '../../contracts';
import { CLASSIC_SHAPE, SEL } from '../../contracts';
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
const DELAY = 640;

function boot(state: Partial<State> = {}, reduced = false) {
  const view = createFakeView();
  view.reducedMotion = () => reduced;
  return bootModule(solvedSheet, { services: { view }, state: { levels, progress, nav: { screen: 'play', sheet: null }, variety: { room: null }, ...state } });
}
const sheet = () => document.querySelector<HTMLElement>(SEL.sheet('solved'))!;
const q = <T extends HTMLElement = HTMLElement>(sel: string) => sheet().querySelector<T>(sel)!;
const completed = (o: Partial<{ levelId: number; stars: 1 | 2 | 3; moves: number; par: number; hintsUsed: number; unlocked: number | null; allSolved: boolean; firstSolve: boolean; pack: string }> = {}) => ({
  levelId: 7, stars: 2 as const, moves: 6, par: 5, hintsUsed: 0, improved: true, unlocked: 8, allSolved: false, firstSolve: true, ...o,
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
    expect(q('.eyebrow').textContent).toBe('Level 7');
    expect(q('.sheet__title').textContent).toBe('Lights out.');
    expect(q('[data-stars-earned]').dataset.starsEarned).toBe('2');
    expect(q('[data-stars-earned]').querySelectorAll('.star[data-state="on"]').length).toBe(2);
    expect(q('[data-result]').textContent).toBe('6 moves · par 5');
    expect(q('.sheet__note').textContent).toBe('Par 5 is the shortest way. Replay for more stars.');
    expect(q(SEL.action('next')).textContent).toBe('Next·Level 8');
    expect(sheet().querySelector('.sheet__handle')).toBeNull(); // nothing to drag
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
      // 3★ without a hint: the stars say it all, no note
      expect(q('.sheet__note').hidden).toBe(true);
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
    expect(q('.sheet__note').hidden).toBe(true);
  });

  test('next, replay and levels emit the right events; levels opens this board', () => {
    const t = boot();
    t.emit('board:solved', { levelId: 7, moves: 6, par: 5 });
    t.clock.advance(DELAY);
    q<HTMLButtonElement>(SEL.action('next')).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 8 });
    q<HTMLButtonElement>(SEL.action('replay')).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 7 });
    q<HTMLButtonElement>(SEL.action('levels')).click();
    expect(t.seen('variety:open')).toEqual({ room: 'classic' });
    expect(t.all('nav:go')).toEqual([]);
  });

  test('without the variety module (no board screen), levels goes to the menu', () => {
    const t = boot({ variety: undefined });
    t.emit('board:solved', { levelId: 7, moves: 6, par: 5 });
    t.clock.advance(DELAY);
    q<HTMLButtonElement>(SEL.action('levels')).click();
    expect(t.seen('nav:go')).toEqual({ screen: 'home' });
    expect(t.all('variety:open')).toEqual([]);
  });

  test('the last level shows the all-done copy and the primary action goes to the levels', () => {
    const t = boot();
    t.emit('board:solved', { levelId: COUNT, moves: 15, par: 15 });
    t.emit('progress:level_completed', completed({ levelId: COUNT, stars: 3, moves: 15, par: 15, unlocked: null, allSolved: true, firstSolve: true }));
    t.clock.advance(DELAY);
    expect(q('.sheet__title').textContent).toBe('All 50 levels solved.');
    expect(q('.sheet__note').textContent).toBe('Replay any level to collect the stars you missed.');
    expect(q(SEL.action('next')).hidden).toBe(true);
    const levelsBtn = q<HTMLButtonElement>(SEL.action('levels'));
    expect(levelsBtn.classList.contains('btn--primary')).toBe(true);
    expect(levelsBtn.hasAttribute('data-autofocus')).toBe(true);
    expect(levelsBtn.textContent).toBe('Back to the levels');
    levelsBtn.click();
    expect(t.seen('variety:open')).toEqual({ room: 'classic' });
    expect(t.all('levels:start')).toEqual([]);
  });

  test('the last level with gaps left still has no next level', () => {
    const t = boot();
    t.emit('board:solved', { levelId: COUNT, moves: 16, par: 15 });
    t.emit('progress:level_completed', completed({ levelId: COUNT, stars: 2, moves: 16, par: 15, unlocked: null, allSolved: false, firstSolve: true }));
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

  test('with reduced motion the sheet opens without waiting for a sweep', () => {
    const t = boot({}, true);
    t.emit('board:solved', { levelId: 7, moves: 6, par: 5 });
    t.clock.advance(150);
    expect(t.all('nav:open_sheet')).toEqual([{ sheet: 'solved' }]);
  });

  test('replaying the last level after finishing the set shows the normal note, not the celebration', () => {
    const t = boot();
    t.emit('board:solved', { levelId: COUNT, moves: 19, par: 15 });
    t.emit('progress:level_completed', completed({ levelId: COUNT, stars: 1, moves: 19, par: 15, unlocked: null, allSolved: true, firstSolve: false }));
    t.clock.advance(DELAY);
    expect(q('[data-result]').textContent).toMatch(/19 moves/);
    expect(sheet().textContent).toMatch(/Par 15 is the shortest way/);
    expect(sheet().textContent).not.toMatch(/All \d+ levels solved/);
  });

  test('a hot reload with the sheet open rebuilds it from the slices; without a solved board it closes', () => {
    const off = Array(25).fill(false);
    const solvedBoard = { status: 'solved' as const, levelId: 7, start: off, cells: off, par: 5, moves: 6, history: [1, 2, 3, 4, 5, 6] };
    const withResult = { ...progress, save: { ...progress.save, results: { '7': { stars: 2 as const, bestMoves: 6, solvedAt: 1 } } } };
    const t = boot({ board: solvedBoard, progress: withResult, nav: { screen: 'play', sheet: 'solved' } });
    t.emit('kernel:state_loaded', { restored: true });
    expect(q('[data-result]').textContent).toMatch(/6 moves/);
    expect(q('[data-stars-earned]').dataset.starsEarned).toBe('2');

    const u = boot({ board: { ...solvedBoard, status: 'playing' }, nav: { screen: 'play', sheet: 'solved' } });
    u.emit('kernel:state_loaded', { restored: true });
    expect(u.seen('nav:close_sheet')).toBeTruthy();
  });

  test('a list that also holds room levels still treats level 50 as the end of the classic path', () => {
    const t = boot({ levels: withRooms });
    t.emit('levels:started', { levelId: COUNT, par: 15, count: COUNT, pack: 'classic', index: COUNT, next: null });
    t.emit('board:solved', { levelId: COUNT, moves: 15, par: 15 });
    t.emit('progress:level_completed', completed({ levelId: COUNT, stars: 3, moves: 15, par: 15, unlocked: null, allSolved: true, firstSolve: true }));
    t.clock.advance(DELAY);
    expect(q('.sheet__title').textContent).toBe('All 50 levels solved.');
    expect(q(SEL.action('next')).hidden).toBe(true);
    q<HTMLButtonElement>(SEL.action('levels')).click();
    expect(t.seen('variety:open')).toEqual({ room: 'classic' });
  });

  test('a room level: eyebrow names the room, Next goes to levels:started.next, Levels opens the room', () => {
    const t = boot({ levels: withRooms });
    t.emit('levels:started', { levelId: 1003, par: 3, count: 12, pack: '4x4', index: 3, next: 1004 });
    t.emit('board:solved', { levelId: 1003, moves: 3, par: 3 });
    t.emit('progress:level_completed', completed({ levelId: 1003, stars: 3, moves: 3, par: 3, unlocked: 1004, pack: '4x4' }));
    t.clock.advance(DELAY);
    expect(q('.eyebrow').textContent).toBe('Small room · Level 3');
    expect(q(SEL.action('next')).hidden).toBe(false);
    expect(q(SEL.action('next')).textContent).toBe('Next·Level 4');
    q<HTMLButtonElement>(SEL.action('next')).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 1004 });
    q<HTMLButtonElement>(SEL.action('levels')).click();
    expect(t.seen('variety:open')).toEqual({ room: '4x4' });
    expect(t.all('nav:go')).toEqual([]);
  });

  test('the last level in a room: no Next; "Back to the levels" is the primary action and opens the room', () => {
    const t = boot({ levels: withRooms });
    t.emit('levels:started', { levelId: 1012, par: 6, count: 12, pack: '4x4', index: 12, next: null });
    t.emit('board:solved', { levelId: 1012, moves: 7, par: 6 });
    t.emit('progress:level_completed', completed({ levelId: 1012, stars: 2, moves: 7, par: 6, unlocked: null, allSolved: false, pack: '4x4' }));
    t.clock.advance(DELAY);
    expect(q('.eyebrow').textContent).toBe('Small room · Level 12');
    expect(q(SEL.action('next')).hidden).toBe(true);
    const back = q<HTMLButtonElement>(SEL.action('levels'));
    expect(back.textContent).toBe('Back to the levels');
    expect(back.classList.contains('btn--primary')).toBe(true);
    expect(back.hasAttribute('data-autofocus')).toBe(true);
    expect(q('.sheet__title').textContent).toBe('Lights out.'); // the classic all-done copy never shows for a room
    expect(sheet().textContent).toContain('That was the last level in this room.');
    back.click();
    expect(t.seen('variety:open')).toEqual({ room: '4x4' });
    expect(t.all('levels:start')).toEqual([]);
  });

  test('levels:started and board:solved in any order; without levels:started the slice gives the place', () => {
    const t = boot({ levels: withRooms });
    // a hot reload loses levels:started: the room still comes from the level's def
    t.emit('board:solved', { levelId: 1005, moves: 5, par: 5 });
    t.clock.advance(DELAY);
    expect(q('.eyebrow').textContent).toBe('Small room · Level 5');
    q<HTMLButtonElement>(SEL.action('next')).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 1006 });
  });

  test('after a boss: the skull, data-boss and "Boss beaten."; the stars follow the same rules; the next level is plain again', () => {
    const t = boot({ levels: withRooms });
    t.emit('levels:started', { levelId: 1010, par: 10, count: 12, pack: '4x4', index: 10, next: 1011, boss: true });
    t.emit('board:solved', { levelId: 1010, moves: 12, par: 10 });
    t.emit('progress:level_completed', completed({ levelId: 1010, stars: 2, moves: 12, par: 10, unlocked: 1011, pack: '4x4' }));
    t.clock.advance(DELAY);
    expect(sheet().dataset.boss).toBe('true');
    expect(q('.sheet__title').textContent).toBe('Boss beaten.');
    expect(q<HTMLElement>('.solved__boss').hidden).toBe(false);
    expect(q('.solved__boss .skull')).not.toBeNull();
    expect(q('.eyebrow').textContent).toBe('Small room · Level 10');
    expect(q('[data-stars-earned]').dataset.starsEarned).toBe('2');
    expect(q('[data-result]').textContent).toBe('12 moves · par 10');
    q<HTMLButtonElement>(SEL.action('next')).click();
    t.emit('levels:started', { levelId: 1011, par: 7, count: 12, pack: '4x4', index: 11, next: 1012 });
    t.emit('board:solved', { levelId: 1011, moves: 7, par: 7 });
    t.clock.advance(DELAY);
    expect(sheet().hasAttribute('data-boss')).toBe(false);
    expect(q('.sheet__title').textContent).toBe('Lights out.');
    expect(q<HTMLElement>('.solved__boss').hidden).toBe(true);
  });

  test('a boss known only from the levels slice (after a hot reload) still gets its skull', () => {
    const t = boot({ levels: { ...levels, list: levels.list.map((l) => (l.id === 10 ? { ...l, boss: true as const } : l)) } });
    t.emit('board:solved', { levelId: 10, moves: 5, par: 5 });
    t.clock.advance(DELAY);
    expect(sheet().dataset.boss).toBe('true');
    expect(q('.sheet__title').textContent).toBe('Boss beaten.');
  });
});

const small: Pack = { id: '4x4', name: 'Small room', kind: 'size', shape: { cols: 4, rows: 4, mask: null }, first: 1001, count: 12 };
const roomLevels: LevelDef[] = Array.from({ length: 12 }, (_, i) => ({
  id: 1001 + i, cells: Array(16).fill(false), par: i + 1, pack: '4x4', index: i + 1, shape: small.shape,
}));
const withRooms: LevelsState = {
  ...levels,
  list: [...levels.list, ...roomLevels],
  packs: [{ id: 'classic', name: 'Classic', kind: 'classic', shape: CLASSIC_SHAPE, first: 1, count: COUNT }, small],
};
