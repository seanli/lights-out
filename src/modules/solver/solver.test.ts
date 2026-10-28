import { describe, expect, test } from 'vitest';
import { bootModule } from '../../../test/fake-ctx';
import { refPress, refSolve } from '../../../test/ref-solver';
import { createRng } from '../../kernel';
import type { Cells, SolverService } from '../../contracts';
import solverModule from './index';
import { createGf2 } from './gf2';

const empty = (): Cells => Array(25).fill(false);
const boot = () => bootModule(solverModule, { bare: true }).kernel.service('solver') as SolverService;

/** 2000 boards: half built from random presses (always solvable), half arbitrary */
function boards(seed: number): Cells[] {
  const rng = createRng(seed);
  const out: Cells[] = [];
  for (let k = 0; k < 1000; k++) {
    let b = empty();
    const presses = rng.int(26);
    for (let p = 0; p < presses; p++) b = refPress(b, rng.int(25));
    out.push(b);
  }
  for (let k = 0; k < 1000; k++) out.push(Array.from({ length: 25 }, () => rng.next() < 0.5));
  return out;
}

describe('solver', () => {
  test('provides the service; the press matrix has rank 23 and 4 solutions per board', () => {
    expect(boot()).toBeDefined();
    const g = createGf2();
    expect(g.rank).toBe(23);
    expect(g.nulls.length).toBe(4);
  });

  test('press toggles the cell and its 4 neighbours, without wrapping', () => {
    const s = boot();
    const lit = (c: Cells) => c.flatMap((on, i) => (on ? [i] : []));
    expect(lit(s.press(empty(), 12))).toEqual([7, 11, 12, 13, 17]);
    expect(lit(s.press(empty(), 0))).toEqual([0, 1, 5]);
    expect(lit(s.press(empty(), 4))).toEqual([3, 4, 9]);
    expect(lit(s.press(empty(), 24))).toEqual([19, 23, 24]);
    expect(lit(s.press(s.press(empty(), 9), 9))).toEqual([]);
    for (let i = 0; i < 25; i++) expect(s.press(empty(), i)).toEqual(refPress(empty(), i));
  });

  test('an empty board needs no presses; bad input fails loudly', () => {
    const s = boot();
    expect(s.solve(empty())).toEqual([]);
    expect(() => s.solve([true, false])).toThrow(/25 cells/);
    expect(() => s.press(empty(), 25)).toThrow(/not on the board/);
  });

  test('matches the reference solver on 2000 random boards, and its presses clear the board', () => {
    const s = boot();
    let solvable = 0;
    for (const b of boards(7)) {
      const mine = s.solve(b);
      const ref = refSolve(b);
      expect(mine === null).toBe(ref === null);
      expect(s.isSolvable(b)).toBe(ref !== null);
      if (!mine || !ref) continue;
      solvable++;
      expect(mine.length).toBe(ref.length);
      expect(mine).toEqual([...mine].sort((a, z) => a - z));
      expect(new Set(mine).size).toBe(mine.length);
      expect(mine.reduce(s.press, b)).toEqual(empty());
    }
    // 1000 built boards are solvable; about 1 in 4 arbitrary ones are
    expect(solvable).toBeGreaterThan(1150);
    expect(solvable).toBeLessThan(1400);
  });

  test('solves fast', () => {
    const s = boot();
    const list = boards(11);
    for (const b of list) s.solve(b); // warm up
    const rounds = 10;
    const t0 = performance.now();
    for (let r = 0; r < rounds; r++) for (const b of list) s.solve(b);
    const us = ((performance.now() - t0) * 1000) / (rounds * list.length);
    console.log(`solver: ${us.toFixed(2)} µs per solve (cells in, sorted presses out)`);
    expect(us).toBeLessThan(100); // target is < 20µs; generous for slow CI
  });
});
