// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import type { Cells, SolverService } from '../../contracts';
import { createMemoryStorage, bootModule } from '../../../test/fake-ctx';
import { refPress, refSolve } from '../../../test/ref-solver';
import learn from './index';
import { BOTTOM, blank, bottomColumns, bottomRowTable, chase, chaseSuggest, isClear, lit, methodTaps, onlyBottom, pressAll, quietPatterns } from './method';

const solver: SolverService = {
  press: (cells, i) => refPress(cells, i),
  solve: (cells) => refSolve(cells),
  isSolvable: (cells) => refSolve(cells) !== null,
};
const boot = (opts: Parameters<typeof bootModule>[1] = {}) => {
  document.body.replaceChildren();
  return bootModule(learn, { ...opts, services: { solver, ...opts.services } });
};
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

describe('learn: the maths', () => {
  const table = bottomRowTable(solver);

  test('the bottom-row table has exactly 7 entries, each clearing its board by chase → top taps → chase', () => {
    expect(table).toHaveLength(7);
    for (const e of table) {
      const board = lit(e.bottom.map((c) => BOTTOM + c));
      const afterTop = pressAll(solver, board, e.top);
      expect(isClear(chase(solver, afterTop).cells), `bottom ${e.bottom}`).toBe(true);
    }
    // every other non-empty bottom row is unsolvable
    for (let p = 1; p < 32; p++) {
      const cols = [0, 1, 2, 3, 4].filter((c) => (p >> c) & 1);
      const listed = table.some((e) => e.bottom.join() === cols.join());
      expect(refSolve(lit(cols.map((c) => BOTTOM + c))) !== null).toBe(listed);
    }
  });

  test('quiet patterns: 3 non-empty tap sets that leave every board unchanged', () => {
    const quiet = quietPatterns(solver);
    expect(quiet).toHaveLength(3);
    const some = pressAll(solver, blank(), [3, 7, 11, 19]);
    for (const set of quiet) {
      expect(set.length).toBeGreaterThan(0);
      expect(pressAll(solver, blank(), set)).toEqual(blank());
      expect(pressAll(solver, some, set)).toEqual(some);
    }
  });

  test('a chase leaves only the bottom row, and the full method clears random solvable boards', () => {
    for (let k = 0; k < 200; k++) {
      const taps = [...Array(25).keys()].filter((i) => ((k * 2654435761 + i * 40503) >>> 7) % 3 === 0);
      const board = pressAll(solver, blank(), taps);
      expect(onlyBottom(chase(solver, board).cells)).toBe(true);
      const set = methodTaps(solver, table, board);
      expect(set).not.toBeNull();
      expect(isClear(pressAll(solver, board, set!))).toBe(true);
    }
  });
});

describe('learn: module', () => {
  test('learn:open shows the lesson and asks nav for the learn screen', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'chase' });
    expect(t.state('learn')).toMatchObject({ lessonId: 'chase', step: 0 });
    expect(t.seen('learn:lesson_opened', { lessonId: 'chase' })).toBeTruthy();
    expect(t.seen('nav:go', { screen: 'learn' })).toBeTruthy();
    expect(q('[data-lesson-view="chase"][data-step="0"]')).toBeTruthy();
    t.emit('learn:open', {});
    expect(t.state('learn').lessonId).toBeNull();
    expect(qa('[data-lesson-tile]').map((e) => e.dataset.lesson)).toEqual(['shapes', 'order', 'chase', 'bottom-row', 'shortest']);
  });

  test('an unknown lesson is refused and nothing changes', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'nope' });
    expect(t.seen('learn:refused', { command: 'learn:open', reason: 'unknown_lesson' })).toBeTruthy();
    expect(t.seen('nav:go')).toBeUndefined();
    expect(t.state('learn').lessonId).toBeNull();
  });

  test('back on the list emits nav:back', () => {
    const t = boot();
    t.emit('learn:open', {});
    q('[data-action="learn-back"]')!.click();
    expect(t.seen('nav:back')).toEqual({});
  });

  test('finishing every step completes the lesson, and it stays completed after a reboot', () => {
    const storage = createMemoryStorage();
    const t = boot({ services: { storage } });
    t.emit('learn:open', { lessonId: 'order' });
    for (let k = 0; k < 10 && t.state('learn').lessonId; k++) q('[data-action="learn-next"]')!.click();
    expect(t.seen('learn:lesson_completed', { lessonId: 'order' })).toBeTruthy();
    expect(t.state('learn').lessonId).toBeNull();
    expect(q('[data-lesson-tile][data-lesson="order"]')!.dataset.completed).toBe('true');

    const again = boot({ services: { storage } });
    expect(again.state('learn').completed).toEqual(['order']);
    expect(q('[data-lesson-tile][data-lesson="order"]')!.dataset.completed).toBe('true');
    expect(q('[data-lesson-tile][data-lesson="shapes"]')!.dataset.completed).toBe('false');
  });

  test.each(['shapes', 'order', 'chase', 'bottom-row', 'shortest'])('%s: practice boards are solvable and solving one fires practice_solved', (id) => {
    const t = boot();
    t.emit('learn:open', { lessonId: id });
    for (let k = 0; k < 5; k++) {
      t.emit('learn:new_practice', {});
      const p = t.state('learn').practice!;
      expect(p.status).toBe('playing');
      expect(isClear(p.cells)).toBe(false);
      const answer = refSolve(p.cells);
      expect(answer).not.toBeNull();
      for (const i of answer!) t.emit('learn:press', { index: i });
      expect(t.state('learn').practice!.status).toBe('solved');
      expect(t.seen('learn:practice_solved')).toEqual({ lessonId: id, moves: answer!.length, par: answer!.length });
    }
  });

  test('practice presses happen on pointerdown on the mini board', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'shapes' });
    t.emit('learn:new_practice', {});
    const before = t.state('learn').practice!.cells;
    const cell = q('[data-mini-board="practice"] [data-mini-cell][data-index="12"]')!;
    cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(t.state('learn').practice!.cells).toEqual(refPress(before, 12));
    expect(t.state('learn').practice!.moves).toBe(1);
  });

  test('assist suggests the chase tap under a lit light in the highest lit row', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'chase' });
    t.emit('learn:new_practice', {});
    expect(t.state('learn').practice!.suggest).toBeNull();
    t.emit('learn:set_assist', { on: true });
    for (let k = 0; k < 40 && t.state('learn').practice!.status === 'playing'; k++) {
      const { cells, suggest } = t.state('learn').practice!;
      const chaseTap = chaseSuggest(cells as Cells);
      if (chaseTap !== null) {
        const row = Math.floor(suggest! / 5) - 1;
        expect(cells[suggest! - 5]).toBe(true);
        // every row above the suggested one is already dark
        expect(cells.slice(0, row * 5).some(Boolean)).toBe(false);
      }
      expect(q(`[data-mini-cell][data-index="${suggest}"]`)!.dataset.suggest).toBe('true');
      t.emit('learn:press', { index: suggest! });
    }
    expect(t.state('learn').practice!.status).toBe('solved');
  });

  test('the bottom-row lesson assist walks the full method to a dark board', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'bottom-row' });
    t.emit('learn:new_practice', {});
    t.emit('learn:set_assist', { on: true });
    for (let k = 0; k < 80 && t.state('learn').practice!.status === 'playing'; k++) t.emit('learn:press', { index: t.state('learn').practice!.suggest! });
    expect(t.state('learn').practice!.status).toBe('solved');
  });

  test('a press with no practice board or off the board is refused', () => {
    const t = boot();
    t.emit('learn:press', { index: 3 });
    expect(t.seen('learn:refused', { reason: 'no_practice' })).toBeTruthy();
    t.emit('learn:open', { lessonId: 'shapes' });
    t.emit('learn:new_practice', {});
    t.emit('learn:press', { index: 25 });
    expect(t.seen('learn:refused', { reason: 'bad_index' })).toBeTruthy();
  });

  test('the bottom-row lesson shows the 7-row table; the demo plays with the clock', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'bottom-row' });
    t.emit('learn:step', { delta: 1 });
    expect(qa('[data-table-row]')).toHaveLength(7);
    t.emit('learn:step', { delta: 1 });
    // the fake view reports reduced motion: the demo waits for taps on its button
    const button = q('[data-action="learn-demo"]')!;
    const lit = () => qa('[data-mini-board="demo"] [data-lit="true"]').length;
    expect(lit()).toBeGreaterThan(0);
    for (let k = 0; k < 40 && lit() > 0; k++) button.click();
    expect(lit()).toBe(0);
    expect(button.textContent).toBe('Replay');
  });

  test('console: table prints 7 patterns; open refuses unknown lessons', () => {
    const t = boot();
    const cmds = t.instance!.commands!;
    expect(String(cmds.table!([])).split('\n')).toHaveLength(8);
    expect(String(cmds.open!(['zzz']))).toMatch(/unknown lesson/);
    cmds.open!(['shortest']);
    expect(t.state('learn').lessonId).toBe('shortest');
  });

  test('chase helper agrees with the board: the bottom row it leaves is in the table', () => {
    const table = bottomRowTable(solver);
    const board = pressAll(solver, blank(), [1, 8, 12, 16, 24]);
    const left = bottomColumns(chase(solver, board).cells);
    expect(table.some((e) => e.bottom.join() === left.join())).toBe(true);
  });
});

describe('learn: in-game pattern reference', () => {
  const table = bottomRowTable(solver);
  const boardState = (cells: Cells, status: 'playing' | 'solved' | 'empty' = 'playing') =>
    ({ status, levelId: status === 'empty' ? null : 3, start: cells, cells, par: 5, moves: 0, history: [] });
  const panel = (t: ReturnType<typeof boot>) => t.view!.region('slot:reference');
  const statusOf = (t: ReturnType<typeof boot>) => panel(t).querySelector<HTMLElement>('[data-reference-status]')!;

  test('with no board: the static table and the chase line, status chase', () => {
    const t = boot();
    expect(panel(t).querySelectorAll('[data-reference]')).toHaveLength(1);
    expect(panel(t).querySelectorAll('[data-pattern-row]')).toHaveLength(7);
    expect(statusOf(t).dataset.referenceStatus).toBe('chase');
  });

  test('chase while rows 1–4 have lights, naming the highest lit row', () => {
    const cells = pressAll(solver, blank(), [12, 17]);
    const t = boot({ state: { board: boardState(cells) } });
    expect(statusOf(t).dataset.referenceStatus).toBe('chase');
    expect(statusOf(t).textContent).toMatch(/Row 2/);
    expect(panel(t).querySelectorAll('[data-match="true"]')).toHaveLength(0);
  });

  test('match when only the bottom row is lit: the matched row is the computed table entry', () => {
    for (const entry of table) {
      const cells = lit(entry.bottom.map((c) => BOTTOM + c));
      const t = boot({ state: { board: boardState(cells) } });
      expect(statusOf(t).dataset.referenceStatus).toBe('match');
      const matched = panel(t).querySelectorAll<HTMLElement>('[data-pattern-row][data-match="true"]');
      expect(matched).toHaveLength(1);
      expect(matched[0]!.dataset.pattern).toBe(entry.bottom.join(','));
      const ringed = [...matched[0]!.querySelectorAll<HTMLElement>('[data-suggest="true"]')].map((e) => Number(e.dataset.index));
      expect(ringed).toEqual(entry.top);
      const live = [...panel(t).querySelectorAll<HTMLElement>('[data-reference-bottom] [data-mini-cell]')].map((e) => e.dataset.lit === 'true');
      expect(live).toEqual([0, 1, 2, 3, 4].map((c) => entry.bottom.includes(c)));
    }
  });

  test('the panel follows the board slice tap by tap through to clear, and never marks the main board', () => {
    const entry = table.find((e) => e.top.length === 2)!;
    const start = lit(entry.bottom.map((c) => BOTTOM + c));
    const t = boot({ state: { board: boardState(start) } });
    // tap one of the ringed top-row lights: still matched (part-way), then the second
    let cells = solver.press(start, entry.top[0]!);
    t.kernel.seed('board', boardState(cells));
    t.emit('learn:set_assist', { on: false }); // any event flushes watchers
    expect(statusOf(t).dataset.referenceStatus).toBe('match');
    expect(panel(t).querySelector('[data-match="true"]')!.getAttribute('data-pattern')).toBe(entry.bottom.join(','));
    cells = solver.press(cells, entry.top[1]!);
    t.kernel.seed('board', boardState(cells));
    t.emit('learn:set_assist', { on: false });
    expect(statusOf(t).dataset.referenceStatus).toBe('chase');
    cells = chase(solver, cells).cells;
    t.kernel.seed('board', boardState(cells, 'solved'));
    t.emit('learn:set_assist', { on: false });
    expect(statusOf(t).dataset.referenceStatus).toBe('clear');
    expect(document.querySelectorAll('[data-cell]')).toHaveLength(0);
  });

  test('nomatch is handled in words', () => {
    const cells = lit([BOTTOM]); // a single bottom-left light can't be solved
    const t = boot({ state: { board: boardState(cells) } });
    expect(statusOf(t).dataset.referenceStatus).toBe('nomatch');
    expect(statusOf(t).textContent!.length).toBeGreaterThan(10);
  });

  test('"All lessons" opens the lesson list', () => {
    const t = boot();
    panel(t).querySelector<HTMLElement>('[data-action="learn"]')!.click();
    expect(t.seen('learn:open')).toEqual({});
    expect(t.seen('nav:go', { screen: 'learn' })).toBeTruthy();
  });
});
