// Honeycombs, cubes, wiring and stuck cells: the general solver against plain brute force on small boards,
// and against "the presses that made it" on the real ones.
import { describe, expect, test } from 'vitest';
import { createRng } from '../../kernel';
import { type Shape } from '../../contracts';
import { cubeShape } from '../../lib/cube';
import { cellIndexes, emptyCells, hexagonShape, isPressable, pressTargets, WIRE_DIRS } from '../../lib/shape';
import { createShaped } from './shaped';

const pressAll = (s: Shape, ps: number[]) => {
  const b = emptyCells(s);
  for (const p of ps) for (const t of pressTargets(s, p)) b[t] = !b[t];
  return b;
};
const same = (a: readonly boolean[], b: readonly boolean[]) => a.every((x, i) => x === b[i]);

/** every subset of the pressable cells: the lightest that clears the board, or null */
function brute(s: Shape, cells: readonly boolean[]): number[] | null {
  const vars = cellIndexes(s).filter((g) => isPressable(s, g));
  let best: number[] | null = null;
  for (let m = 0; m < 1 << vars.length; m++) {
    const ps = vars.filter((_, k) => m & (1 << k));
    if (best && ps.length >= best.length) continue;
    if (same(pressAll(s, ps), cells)) best = ps;
  }
  return best;
}

const randomWires = (s: Shape, seed: number): Shape => {
  const rng = createRng(seed);
  return { ...s, wires: Array.from({ length: s.cols * s.rows }, () => rng.int(256)) };
};

describe('general solver: brute force on small boards', () => {
  const small: [string, Shape][] = [
    ['wired 3×3', randomWires({ cols: 3, rows: 3, mask: null }, 1)],
    ['wired 4×3', randomWires({ cols: 4, rows: 3, mask: null }, 2)],
    ['stuck 4×4', { cols: 4, rows: 4, mask: null, stuck: [5, 10] }],
    ['wired + stuck 3×4', { ...randomWires({ cols: 3, rows: 4, mask: null }, 3), stuck: [4] }],
    ['honeycomb 4×3', { cols: 4, rows: 3, mask: null, grid: 'hex' }],
    ['honeycomb 3×4, one stuck', { cols: 3, rows: 4, mask: null, grid: 'hex', stuck: [4] }],
  ];
  test.each(small)('%s: solve finds the fewest presses, and only pressable ones', (_, s) => {
    const engine = createShaped(s);
    const rng = createRng(9);
    const vars = cellIndexes(s).filter((g) => isPressable(s, g));
    for (let t = 0; t < 40; t++) {
      const ps = vars.filter(() => rng.int(3) === 0);
      const board = pressAll(s, ps);
      const got = engine.solve(board);
      const want = brute(s, board);
      expect(got === null).toBe(want === null);
      if (!got || !want) continue;
      expect(got.length).toBe(want.length);
      expect(same(pressAll(s, got), board)).toBe(true);
      for (const g of got) expect(isPressable(s, g)).toBe(true);
    }
  });

  test('a board that needs a stuck cell pressed is unsolvable', () => {
    // 1×3-ish: on a 3×3 with the middle stuck and every other cell wired to flip only itself, the middle can't change
    const s: Shape = { cols: 3, rows: 3, mask: null, wires: new Array(9).fill(0), stuck: [4] };
    const board = emptyCells(s);
    board[4] = true;
    expect(createShaped(s).solve(board)).toBeNull();
  });
});

describe('general solver: the real boards', () => {
  const real: [string, Shape, number][] = [
    ['cube 3', cubeShape(3), 6],
    ['cube 4', cubeShape(4), 0],
    ['hexagon 4', hexagonShape(4), 4],
    ['hexagon 5', hexagonShape(5), 0],
  ];
  test.each(real)('%s: %#', (_, s, nullDim) => {
    const engine = createShaped(s);
    expect(engine.nullDim).toBe(nullDim);
    expect(engine.approximate).toBe(false);
    const rng = createRng(4);
    const vars = cellIndexes(s);
    for (let t = 0; t < 30; t++) {
      const ps = vars.filter(() => rng.int(4) === 0);
      const board = pressAll(s, ps);
      const got = engine.solve(board)!;
      expect(got).not.toBeNull();
      expect(got.length).toBeLessThanOrEqual(ps.length);
      expect(same(pressAll(s, got), board)).toBe(true);
    }
  });

  test('wired 5×5 and stuck 6×6 boards built from presses are always solved, never with a stuck press', () => {
    const rng = createRng(12);
    for (let t = 0; t < 30; t++) {
      const wired = randomWires({ cols: 5, rows: 5, mask: null }, 100 + t);
      const stuck: Shape = { cols: 6, rows: 6, mask: null, stuck: [rng.int(36), 36 + 0].filter((x) => x < 36) };
      for (const s of [wired, stuck]) {
        const vars = cellIndexes(s).filter((g) => isPressable(s, g));
        const ps = vars.filter(() => rng.int(4) === 0);
        const board = pressAll(s, ps);
        const got = createShaped(s).solve(board)!;
        expect(same(pressAll(s, got), board)).toBe(true);
        expect(got.length).toBeLessThanOrEqual(ps.length);
        for (const g of got) expect(isPressable(s, g)).toBe(true);
      }
    }
    expect(WIRE_DIRS).toHaveLength(8);
  });
});
