import { describe, expect, test } from 'vitest';
import type { Cells } from '../../contracts';
import { bootModule } from '../../../test/fake-ctx';
import { refPress, refSolve } from '../../../test/ref-solver';
import { parseShape, pressTargets } from '../../lib/shape';
import board from './index';

const off = (): Cells => new Array(25).fill(false);
const lit = (...idx: number[]): Cells => { const c = off(); for (const i of idx) c[i] = !c[i]; return c; };
const litSet = (cells: readonly boolean[]) => cells.flatMap((on, i) => (on ? [i] : []));
const refusals = (t: ReturnType<typeof bootModule>) => t.all('board:refused');

/** a level whose fewest-presses solution is exactly `presses` */
const levelFrom = (presses: number[]) => presses.reduce<boolean[]>((c, i) => refPress(c, i), off());

function playing(cells: Cells = lit(0, 7, 18), levelId = 3, par = 4) {
  const t = bootModule(board);
  t.emit('board:load', { levelId, cells, par });
  return t;
}

describe('board', () => {
  test('starts empty', () => {
    const t = bootModule(board);
    expect(t.state('board')).toEqual({ status: 'empty', levelId: null, start: off(), cells: off(), par: 0, moves: 0, history: [] });
  });

  test('loads a level', () => {
    const cells = lit(4, 12);
    const t = playing(cells, 7, 2);
    expect(t.state('board')).toMatchObject({ status: 'playing', levelId: 7, start: cells, cells, par: 2, moves: 0, history: [] });
    expect(t.seen('board:loaded')).toEqual({ levelId: 7, cells, par: 2 });
  });

  test.each([
    ['too short', new Array(24).fill(true)],
    ['too long', new Array(26).fill(true)],
    ['not booleans', [1, ...new Array(24).fill(false)]],
    ['no lit cell', new Array(25).fill(false)],
    ['not an array', 'x'],
  ])('refuses to load a bad board (%s) and stays as it was', (_, cells) => {
    const t = bootModule(board);
    t.emit('board:load', { levelId: 1, cells: cells as Cells, par: 1 });
    expect(t.seen('board:refused')).toEqual({ command: 'board:load', reason: 'bad_board' });
    expect(t.state('board').status).toBe('empty');
    expect(t.seen('board:loaded')).toBeUndefined();
  });

  test.each([
    ['top-left corner', 0, [0, 1, 5]],
    ['top-right corner', 4, [3, 4, 9]],
    ['bottom-left corner', 20, [15, 20, 21]],
    ['bottom-right corner', 24, [19, 23, 24]],
    ['top edge', 2, [1, 2, 3, 7]],
    ['left edge', 10, [5, 10, 11, 15]],
    ['right edge', 14, [9, 13, 14, 19]],
    ['bottom edge', 22, [17, 21, 22, 23]],
    ['centre', 12, [7, 11, 12, 13, 17]],
    ['row end does not wrap', 9, [4, 8, 9, 14]],
    ['row start does not wrap', 5, [0, 5, 6, 10]],
  ])('pressing the %s toggles it and its neighbours only', (_, index, toggled) => {
    const t = playing(lit(0, 1, 2, 3, 4, 20, 21, 22, 23, 24)); // keep the board unsolved by any single press
    const before = t.state('board').cells;
    t.emit('board:press', { index });
    const after = t.state('board').cells;
    const changed = after.flatMap((on, i) => (on !== before[i] ? [i] : []));
    expect(changed).toEqual(toggled);
    expect(after).toEqual(refPress(before, index));
  });

  test('a press counts a move, records history and reports the board', () => {
    const t = playing(lit(0, 7, 18), 3, 4);
    t.emit('board:press', { index: 12 });
    const b = t.state('board');
    expect(b.moves).toBe(1);
    expect(b.history).toEqual([12]);
    expect(t.seen('board:pressed')).toEqual({ levelId: 3, index: 12, cells: b.cells, moves: 1, litCount: litSet(b.cells).length });
    expect(Object.isFrozen(b.cells)).toBe(true);
    expect(b.start).toEqual(lit(0, 7, 18));
  });

  test('refuses presses with reasons', () => {
    const t = bootModule(board);
    t.emit('board:press', { index: 3 });
    expect(refusals(t).at(-1)).toEqual({ command: 'board:press', reason: 'not_playing' });
    t.emit('board:load', { levelId: 1, cells: lit(0), par: 1 });
    for (const index of [-1, 25, 2.5, NaN, '3' as unknown as number, undefined as unknown as number]) {
      t.emit('board:press', { index });
      expect(refusals(t).at(-1)).toEqual({ command: 'board:press', reason: 'bad_index' });
    }
    expect(t.state('board').moves).toBe(0);
  });

  test('undo takes back the last press and its move', () => {
    const start = lit(0, 7, 18);
    const t = playing(start);
    t.emit('board:press', { index: 12 });
    t.emit('board:press', { index: 3 });
    t.emit('board:undo', {});
    expect(t.seen('board:undone')).toEqual({ levelId: 3, index: 3, cells: refPress(start, 12), moves: 1 });
    expect(t.state('board')).toMatchObject({ moves: 1, history: [12], cells: refPress(start, 12) });
    t.emit('board:undo', {});
    expect(t.state('board')).toMatchObject({ moves: 0, history: [], cells: start, status: 'playing' });
    t.emit('board:undo', {});
    expect(refusals(t).at(-1)).toEqual({ command: 'board:undo', reason: 'nothing_to_undo' });
  });

  test('undo is refused when not playing', () => {
    const t = bootModule(board);
    t.emit('board:undo', {});
    expect(refusals(t).at(-1)).toEqual({ command: 'board:undo', reason: 'not_playing' });
    const s = playing(levelFrom([6]));
    s.emit('board:press', { index: 6 });
    s.emit('board:undo', {});
    expect(s.state('board').status).toBe('solved');
    expect(refusals(s).at(-1)).toEqual({ command: 'board:undo', reason: 'not_playing' });
  });

  test('restart goes back to the start, including after a solve', () => {
    const start = levelFrom([6, 18]);
    const t = playing(start, 5, 2);
    t.emit('board:press', { index: 0 });
    t.emit('board:restart', {});
    expect(t.state('board')).toMatchObject({ status: 'playing', cells: start, moves: 0, history: [], par: 2, levelId: 5 });
    expect(t.seen('board:restarted')).toEqual({ levelId: 5, cells: start });
    t.emit('board:press', { index: 6 });
    t.emit('board:press', { index: 18 });
    expect(t.state('board').status).toBe('solved');
    t.emit('board:restart', {});
    expect(t.state('board')).toMatchObject({ status: 'playing', cells: start, moves: 0 });
  });

  test('restart is refused before any level is loaded', () => {
    const t = bootModule(board);
    t.emit('board:restart', {});
    expect(refusals(t).at(-1)).toEqual({ command: 'board:restart', reason: 'not_playing' });
  });

  test('clearing the last light solves the level exactly once', () => {
    const t = playing(levelFrom([2, 12, 20]), 9, 3);
    t.emit('board:press', { index: 20 });
    t.emit('board:press', { index: 2 });
    expect(t.all('board:solved')).toEqual([]);
    t.emit('board:press', { index: 12 });
    expect(t.seen('board:pressed')).toMatchObject({ index: 12, moves: 3, litCount: 0 });
    expect(t.state('board').status).toBe('solved');
    t.emit('board:press', { index: 12 });
    t.emit('board:press', { index: 0 });
    expect(t.all('board:solved')).toEqual([{ levelId: 9, moves: 3, par: 3 }]);
    expect(refusals(t).at(-1)).toEqual({ command: 'board:press', reason: 'not_playing' });
    // the solved fact comes after the press that caused it
    const types = t.events().map((e) => e.type);
    expect(types.lastIndexOf('board:solved')).toBeGreaterThan(types.indexOf('board:pressed'));
  });

  test('property: 200 random presses, then the same 200 again, returns to the start', () => {
    let seed = 12345;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    let checked = 0;
    for (let round = 0; round < 20; round++) {
      // a dense random start, re-rolled if it happens to be cleared midway
      const start = off().map(() => rand() < 0.5) as Cells;
      start[(rand() * 25) | 0] = true;
      const seq = Array.from({ length: 200 }, () => (rand() * 25) | 0);
      const t = playing(start);
      for (const index of [...seq, ...seq]) {
        if (t.state('board').status !== 'playing') break;
        t.emit('board:press', { index });
      }
      if (t.state('board').status !== 'playing') continue; // hit a solve on the way: covered elsewhere
      expect(t.state('board').cells).toEqual(start);
      expect(t.state('board').moves).toBe(400);
      expect(t.state('board').history).toEqual([...seq, ...seq]);
      // and undoing every press also returns to the start
      for (let k = 0; k < 400; k++) t.emit('board:undo', {});
      expect(t.state('board')).toMatchObject({ cells: start, moves: 0, history: [] });
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(18);
  });

  test('a press stays well under 1ms', () => {
    const t = playing(lit(0, 1, 2, 3, 4, 20, 21, 22, 23, 24));
    const N = 2000;
    const t0 = performance.now();
    for (let k = 0; k < N; k++) {
      t.emit('board:press', { index: (k * 7) % 25 });
      if (t.state('board').status !== 'playing') t.emit('board:restart', {});
    }
    const perPress = (performance.now() - t0) / N;
    if (process.env.BOARD_PERF) console.log(`board:press ${(perPress * 1000).toFixed(1)}µs per press through the kernel`);
    expect(perPress).toBeLessThan(0.25);
  });

  describe('console', () => {
    const solver = { press: refPress, solve: refSolve, isSolvable: (c: Cells) => refSolve(c) !== null };

    test('show draws the grid', () => {
      const t = playing(lit(0, 24), 4, 2);
      const out = String(t.instance!.commands!.show!([]));
      expect(out.split('\n').slice(1)).toEqual(['# . . . .', '. . . . .', '. . . . .', '. . . . .', '. . . . #']);
      expect(out).toContain('level 4');
    });

    test('set loads a board under the current level with the solver par', () => {
      const t = bootModule(board, { services: { solver } });
      const text = '1100010000000000000000000';
      t.instance!.commands!.set!([text]);
      const cells = Array.from(text, (ch) => ch === '1');
      expect(t.state('board')).toMatchObject({ status: 'playing', levelId: 1, cells, par: refSolve(cells)!.length });
      t.emit('board:load', { levelId: 8, cells: lit(12), par: 5 });
      t.instance!.commands!.set!(['0000000000001000000000000']);
      expect(t.state('board')).toMatchObject({ levelId: 8, cells: lit(12) });
      expect(String(t.instance!.commands!.set!(['01']))).toMatch(/usage/);
    });

    test('set without a solver uses par 0', () => {
      const t = bootModule(board);
      t.instance!.commands!.set!(['0000000000001000000000000']);
      expect(t.state('board')).toMatchObject({ status: 'playing', levelId: 1, par: 0 });
    });

    test('win presses the solution', () => {
      const t = bootModule(board, { services: { solver } });
      t.emit('board:load', { levelId: 2, cells: levelFrom([1, 13, 22, 24]), par: 4 });
      t.instance!.commands!.win!([]);
      expect(t.state('board').status).toBe('solved');
      expect(t.all('board:solved')).toEqual([{ levelId: 2, moves: 4, par: 4 }]);
    });

    test('win without a solver says so', () => {
      const t = playing();
      expect(String(t.instance!.commands!.win!([]))).toMatch(/no solver/);
      expect(t.state('board').moves).toBe(0);
    });
  });

  describe('shaped boards', () => {
    const ring = parseShape(['XXXXXXX', 'XXXXXXX', 'XX...XX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXXXXX']);
    const four = { cols: 4, rows: 4, mask: null };
    const grid = (n: number, ...idx: number[]): Cells => { const c = new Array(n).fill(false); for (const i of idx) c[i] = true; return c; };

    test('loads a shaped board and stores its shape; the classic board stores none', () => {
      const t = bootModule(board);
      const cells = grid(49, 0, 8);
      t.emit('board:load', { levelId: 5001, cells, par: 1, shape: ring });
      expect(t.state('board')).toMatchObject({ status: 'playing', levelId: 5001, cells, shape: ring });
      expect(t.seen('board:loaded')).toEqual({ levelId: 5001, cells, par: 1, shape: ring });
      t.emit('board:load', { levelId: 3, cells: lit(0), par: 1, shape: { cols: 5, rows: 5, mask: null } });
      expect('shape' in t.state('board')).toBe(false);
      expect(t.seen('board:loaded')).toEqual({ levelId: 3, cells: lit(0), par: 1 });
    });

    test.each([
      ['wrong length for the shape', grid(25, 0), ring],
      ['a lit gap', grid(49, 24), ring],
      ['a shape that is too big', grid(104, 0), { cols: 13, rows: 8, mask: null }],
      ['a cube that isn\'t a cube\'s net', grid(108, 0), { cols: 9, rows: 12, mask: null, grid: 'cube' as const }],
      ['wiring on a honeycomb', grid(9, 0), { cols: 3, rows: 3, mask: null, grid: 'hex' as const, wires: Array(9).fill(1) }],
      ['a mask of the wrong length', grid(16, 0), { cols: 4, rows: 4, mask: [true, false] }],
    ])('refuses a bad shaped board (%s)', (_, cells, shape) => {
      const t = bootModule(board);
      t.emit('board:load', { levelId: 1, cells, par: 1, shape });
      expect(t.seen('board:refused')).toEqual({ command: 'board:load', reason: 'bad_board' });
      expect(t.state('board').status).toBe('empty');
    });

    test('presses follow the shape: never across a gap; gaps and off-grid presses are refused', () => {
      const t = bootModule(board);
      t.emit('board:load', { levelId: 5001, cells: grid(49, 0, 1, 2, 3, 4, 5, 6), par: 7, shape: ring });
      const before = t.state('board').cells;
      t.emit('board:press', { index: 15 }); // beside the hole: reaches up, down and left only
      const changed = t.state('board').cells.flatMap((on, i) => (on !== before[i] ? [i] : []));
      expect(changed).toEqual([...pressTargets(ring, 15)].sort((a, b) => a - b));
      expect(changed).not.toContain(16);
      for (const index of [16, 24, 49, -1, 2.5]) {
        t.emit('board:press', { index });
        expect(t.seen('board:refused')).toEqual({ command: 'board:press', reason: 'bad_index' });
      }
      expect(t.state('board').moves).toBe(1);
      t.emit('board:undo', {});
      expect(t.state('board').cells).toEqual(before);
    });

    test('a 4×4 board plays to a solve; restart keeps the shape', () => {
      const t = bootModule(board);
      t.emit('board:load', { levelId: 1001, cells: grid(16, ...pressTargets(four, 5)), par: 1, shape: four });
      t.emit('board:press', { index: 5 });
      expect(t.state('board').status).toBe('solved');
      expect(t.seen('board:solved')).toEqual({ levelId: 1001, moves: 1, par: 1 });
      t.emit('board:restart', {});
      expect(t.state('board')).toMatchObject({ status: 'playing', shape: four, moves: 0 });
      t.emit('board:press', { index: 16 });
      expect(t.seen('board:refused')).toEqual({ command: 'board:press', reason: 'bad_index' });
    });

    test('console show and set handle the shape', () => {
      const t = bootModule(board);
      t.emit('board:load', { levelId: 5001, cells: grid(49, 0), par: 1, shape: ring });
      const out = String(t.instance!.commands!.show!([]));
      expect(out.split('\n')[0]).toContain('7×7');
      expect(out.split('\n')[3]).toBe('. .       . .');
      expect(String(t.instance!.commands!.set!(['1'.repeat(25)]))).toMatch(/49 characters/);
      expect(String(t.instance!.commands!.set!(['1'.repeat(49)]))).toMatch(/gap/);
      t.instance!.commands!.set!(['1'.padEnd(49, '0')]);
      expect(t.state('board')).toMatchObject({ levelId: 5001, shape: ring });
    });
  });
});
