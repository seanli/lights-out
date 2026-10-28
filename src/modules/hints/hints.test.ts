import { describe, expect, test } from 'vitest';
import type { BoardState, Cells, SolverService } from '../../contracts';
import { bootModule, fixtureData } from '../../../test/fake-ctx';
import { refPress, refSolve } from '../../../test/ref-solver';
import hints from './index';

const off = (): Cells => new Array(25).fill(false);
const levelFrom = (presses: number[]) => presses.reduce<boolean[]>((c, i) => refPress(c, i), off());
const refSolver: SolverService = { press: refPress, solve: refSolve, isSolvable: (c) => refSolve(c) !== null };

const boardState = (cells: Cells, over: Partial<BoardState> = {}): BoardState =>
  ({ status: 'playing', levelId: 4, start: cells, cells, par: 3, moves: 0, history: [], ...over });

type Choice = 'random' | 'first';
function boot(opts: { board?: BoardState | undefined; solver?: SolverService; choice?: Choice; enabled?: boolean; seed?: number } = {}) {
  const data = {
    ...fixtureData,
    rules: { ...fixtureData.rules, hints: { choice: opts.choice ?? 'random' } },
    flags: { ...fixtureData.flags, hints: { enabled: opts.enabled ?? true } },
  };
  const state = 'board' in opts ? (opts.board ? { board: opts.board } : {}) : { board: boardState(levelFrom([2, 12, 20])) };
  return bootModule(hints, { services: { solver: opts.solver ?? refSolver }, state, data, seed: opts.seed });
}

/** show a hint, then make sure it is showing */
function shown(t: ReturnType<typeof boot>) {
  t.emit('hints:request', {});
  expect(t.state('hints').status).toBe('showing');
  return t;
}

describe('hints', () => {
  test('refused while the tutorial already points at a cell (it would only cost a star)', () => {
    const t = boot();
    t.kernel.seed('tutorial', { status: 'active', levelId: 4, step: 0, target: 2, copyKey: '1.0' });
    t.emit('hints:request', {});
    expect(t.seen('hints:refused')).toEqual({ reason: 'tutorial_active' });
    expect(t.all('hints:shown')).toEqual([]);
  });

  test('starts idle', () => {
    expect(boot().state('hints')).toEqual({ status: 'idle', levelId: null, cell: null });
  });

  test('switched off in flags: writes nothing and answers nothing', () => {
    const t = boot({ enabled: false });
    expect(t.state('hints')).toBeUndefined();
    t.emit('hints:request', {});
    expect(t.events().filter((e) => e.type.startsWith('hints:') && e.type !== 'hints:request')).toEqual([]);
  });

  test('shows one cell of a fewest-presses solution', () => {
    const t = boot({ board: boardState(levelFrom([2, 12, 20]), { levelId: 6 }) });
    t.emit('hints:request', {});
    const s = t.state('hints');
    expect(s.status).toBe('showing');
    expect(s.levelId).toBe(6);
    expect([2, 12, 20]).toContain(s.cell);
    expect(t.seen('hints:shown')).toEqual({ levelId: 6, index: s.cell });
  });

  test('"first" picks the lowest index', () => {
    const t = boot({ choice: 'first', board: boardState(levelFrom([20, 7, 13])) });
    t.emit('hints:request', {});
    expect(t.state('hints').cell).toBe(7);
  });

  test('"random" uses the seeded rng: same seed same cell, and seeds spread across the solution', () => {
    const cells = levelFrom([0, 6, 12, 18, 24]);
    const pick = (seed: number) => { const t = boot({ seed, board: boardState(cells) }); t.emit('hints:request', {}); return t.state('hints').cell!; };
    expect(pick(5)).toBe(pick(5));
    const picks = new Set(Array.from({ length: 30 }, (_, k) => pick(k + 1)));
    expect(picks.size).toBeGreaterThan(1);
    for (const c of picks) expect([0, 6, 12, 18, 24]).toContain(c);
  });

  test('property: the hinted cell is in a minimal solution and pressing it shortens the solution by one', () => {
    let seed = 99;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let round = 0; round < 60; round++) {
      const cells = off().map(() => rand() < 0.5) as Cells;
      const solution = refSolve(cells);
      if (!solution || solution.length === 0) continue;
      const t = boot({ seed: round + 1, choice: round % 2 ? 'first' : 'random', board: boardState(cells) });
      t.emit('hints:request', {});
      const cell = t.state('hints').cell!;
      expect(solution).toContain(cell);
      expect(refSolve(refPress(cells, cell))!.length).toBe(solution.length - 1);
    }
  });

  describe('refusals', () => {
    test('not_playing: no board, an empty board or a solved board', () => {
      for (const board of [undefined, boardState(off(), { status: 'empty', levelId: null }), boardState(off(), { status: 'solved' })]) {
        const t = boot({ board });
        t.emit('hints:request', {});
        expect(t.seen('hints:refused')).toEqual({ reason: 'not_playing' });
        expect(t.state('hints').status).toBe('idle');
      }
    });

    test('already_showing: a second request shows nothing new', () => {
      const t = shown(boot());
      const cell = t.state('hints').cell;
      t.emit('hints:request', {});
      expect(t.seen('hints:refused')).toEqual({ reason: 'already_showing' });
      expect(t.all('hints:shown')).toHaveLength(1);
      expect(t.state('hints').cell).toBe(cell);
    });

    test('unsolvable: the solver finds no solution', () => {
      const t = boot({ solver: { ...refSolver, solve: () => null } });
      t.emit('hints:request', {});
      expect(t.seen('hints:refused')).toEqual({ reason: 'unsolvable' });
      expect(t.state('hints').status).toBe('idle');
      expect(t.all('hints:shown')).toEqual([]);
    });
  });

  describe('clearing', () => {
    const cells = levelFrom([2, 12, 20]);
    const cases: [string, (t: ReturnType<typeof boot>) => void, string][] = [
      ['a press', (t) => t.emit('board:pressed', { levelId: 4, index: 0, cells, moves: 1, litCount: 7 }), 'pressed'],
      ['an undo', (t) => t.emit('board:undone', { levelId: 4, index: 0, cells, moves: 0 }), 'undone'],
      ['a restart', (t) => t.emit('board:restarted', { levelId: 4, cells }), 'restarted'],
      ['a new level', (t) => t.emit('board:loaded', { levelId: 5, cells, par: 3 }), 'level_changed'],
      ['the winning press', (t) => {
        t.emit('board:pressed', { levelId: 4, index: 2, cells: off(), moves: 3, litCount: 0 });
        t.emit('board:solved', { levelId: 4, moves: 3, par: 3 });
      }, 'solved'],
      ['a solve on its own', (t) => t.emit('board:solved', { levelId: 4, moves: 3, par: 3 }), 'solved'],
    ];

    test.each(cases)('%s clears a showing hint once', (_, act, reason) => {
      const t = shown(boot());
      act(t);
      expect(t.state('hints')).toEqual({ status: 'idle', levelId: null, cell: null });
      expect(t.all('hints:cleared')).toEqual([{ reason }]);
    });

    test.each(cases)('%s emits nothing when no hint is showing', (_, act) => {
      const t = boot();
      act(t);
      expect(t.all('hints:cleared')).toEqual([]);
    });

    test('a new hint can be asked for after a clear', () => {
      const t = shown(boot());
      t.emit('board:restarted', { levelId: 4, cells });
      t.emit('hints:request', {});
      expect(t.all('hints:shown')).toHaveLength(2);
    });
  });
});
