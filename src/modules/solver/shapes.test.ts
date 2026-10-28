// Shaped boards: cross-checked against an independent BigInt reference (and plain brute force on 4×4).
import { describe, expect, test } from 'vitest';
import { bootModule, fixtureData } from '../../../test/fake-ctx';
import { createRng } from '../../kernel';
import { CLASSIC_SHAPE, type Cells, type Shape, type SolverService } from '../../contracts';
import { cellIndexes, emptyCells, gridSize, isCell, parseShape, pressTargets } from '../../lib/shape';
import solverModule from './index';
import { createShaped } from './shaped';

type Room = { id: string; cols?: number; rows?: number; picture?: string[] };
const rooms = (fixtureData.rules as { levels: { rooms: Room[] } }).levels.rooms;
const shapeOfRoom = (r: Room): Shape => (r.picture ? parseShape(r.picture) : { cols: r.cols!, rows: r.rows!, mask: null });
const SHAPES: [string, Shape][] = rooms.map((r) => [r.id, shapeOfRoom(r)]);

// ---- independent reference: BigInt rows over grid positions, full null-space search ----
function refSolve(shape: Shape, cells: readonly boolean[]): number[] | null {
  const vars = cellIndexes(shape);
  for (let g = 0; g < gridSize(shape); g++) if (cells[g] && !isCell(shape, g)) return null;
  const n = vars.length;
  const pos = new Map(vars.map((g, j) => [g, j]));
  const B = BigInt(n);
  // row r (equation for cell vars[r]): bit j when pressing vars[j] toggles it; bit n = lit
  const rows = vars.map((g, r) => {
    let row = cells[g] ? 1n << B : 0n;
    for (const t of pressTargets(shape, g)) row |= 1n << BigInt(pos.get(t)!); // symmetric
    return row;
  });
  const pivotCol: number[] = [];
  let rank = 0;
  for (let col = 0; col < n; col++) {
    const bit = 1n << BigInt(col);
    const p = rows.findIndex((row, i) => i >= rank && (row & bit) !== 0n);
    if (p < 0) continue;
    [rows[rank], rows[p]] = [rows[p]!, rows[rank]!];
    for (let r = 0; r < n; r++) if (r !== rank && rows[r]! & bit) rows[r]! ^= rows[rank]!;
    pivotCol[rank++] = col;
  }
  for (let r = rank; r < n; r++) if (rows[r]! >> B) return null;
  const free = [...Array(n).keys()].filter((c) => !pivotCol.includes(c));
  let best: bigint | null = null, bestW = Infinity;
  const weight = (x: bigint) => x.toString(2).split('').filter((c) => c === '1').length;
  for (let combo = 0; combo < 1 << free.length; combo++) {
    let x = 0n;
    free.forEach((f, k) => { if (combo & (1 << k)) x |= 1n << BigInt(f); });
    for (let r = 0; r < rank; r++) {
      let bit = (rows[r]! >> B) & 1n;
      for (const f of free) if (rows[r]! & (1n << BigInt(f)) && x & (1n << BigInt(f))) bit ^= 1n;
      if (bit) x |= 1n << BigInt(pivotCol[r]!);
    }
    const w = weight(x);
    if (w < bestW) { best = x; bestW = w; }
  }
  return vars.filter((_, j) => best! & (1n << BigInt(j)));
}

const pressRef = (shape: Shape, cells: readonly boolean[], i: number) => {
  const out = cells.slice();
  for (const t of pressTargets(shape, i)) out[t] = !out[t];
  return out;
};

/** 300 boards per shape: half built from random presses (solvable), half random lights on real cells */
function boards(shape: Shape, seed: number, count = 300): Cells[] {
  const rng = createRng(seed);
  const real = cellIndexes(shape);
  const out: Cells[] = [];
  for (let k = 0; k < count / 2; k++) {
    let b: boolean[] = emptyCells(shape);
    const presses = rng.int(real.length + 1);
    for (let p = 0; p < presses; p++) b = pressRef(shape, b, rng.pick(real));
    out.push(b);
  }
  for (let k = 0; k < count / 2; k++) {
    const b: boolean[] = emptyCells(shape);
    for (const g of real) b[g] = rng.next() < 0.5;
    out.push(b);
  }
  return out;
}

const boot = () => bootModule(solverModule, { bare: true }).kernel.service('solver') as SolverService;

describe('solver on every room shape', () => {
  test('null-space dimensions are small enough to search fully', () => {
    const dims = Object.fromEntries(SHAPES.map(([id, s]) => [id, createShaped(s).nullDim]));
    console.log('solver: null-space dimension per room', JSON.stringify(dims));
    expect(dims).toEqual({ '5x6': 0, '6x6': 0, '7x7': 0, cross: 2, ring: 2, diamond: 0, '8x8': 0, '10x10': 0, tower: 0 });
    for (const [, s] of SHAPES) expect(createShaped(s).approximate).toBe(false);
  });

  test.each(SHAPES)('%s: press equals pressTargets and never crosses a gap', (_, shape) => {
    const s = boot();
    for (let g = 0; g < gridSize(shape); g++) {
      if (!isCell(shape, g)) {
        expect(() => s.press(emptyCells(shape), g, shape)).toThrow(/not on this/);
        continue;
      }
      const after = s.press(emptyCells(shape), g, shape);
      expect(after.flatMap((on, i) => (on ? [i] : []))).toEqual([...pressTargets(shape, g)].sort((a, b) => a - b));
      for (let i = 0; i < after.length; i++) if (!isCell(shape, i)) expect(after[i]).toBe(false);
    }
    expect(() => s.press(emptyCells(shape), gridSize(shape), shape)).toThrow(/not on this/);
  });

  test.each(SHAPES)('%s: matches the reference on 300 random boards; solutions clear the board and avoid gaps', (_, shape) => {
    const s = boot();
    let solvable = 0;
    for (const b of boards(shape, 5)) {
      const mine = s.solve(b, shape);
      const ref = refSolve(shape, b);
      expect(mine === null).toBe(ref === null);
      expect(s.isSolvable(b, shape)).toBe(ref !== null);
      if (!mine || !ref) continue;
      solvable++;
      expect(mine.length).toBe(ref.length);
      expect(mine).toEqual([...mine].sort((a, z) => a - z));
      for (const i of mine) expect(isCell(shape, i)).toBe(true);
      expect(mine.reduce((c, i) => s.press(c, i, shape), b)).toEqual(emptyCells(shape));
    }
    expect(solvable).toBeGreaterThanOrEqual(150);
  });

  test('4×4: plain brute force over all 65536 press sets agrees on the minimum', () => {
    const shape: Shape = { cols: 4, rows: 4, mask: null };
    const s = boot();
    // best[board mask] = fewest presses reaching it from empty
    const press = Array.from({ length: 16 }, (_, i) => pressTargets(shape, i).reduce((m, t) => m | (1 << t), 0));
    const best = new Int8Array(1 << 16).fill(-1);
    for (let set = 0; set < 1 << 16; set++) {
      let m = 0, w = 0;
      for (let i = 0; i < 16; i++) if (set & (1 << i)) { m ^= press[i]!; w++; }
      if (best[m] === -1 || w < best[m]!) best[m] = w;
    }
    for (let m = 0; m < 1 << 16; m += 7) {
      const cells = Array.from({ length: 16 }, (_, i) => !!(m & (1 << i)));
      const mine = s.solve(cells, shape);
      if (best[m] === -1) expect(mine).toBeNull();
      else expect(mine?.length).toBe(best[m]);
    }
  });

  test('a lit gap or a wrong-size board is refused plainly', () => {
    const s = boot();
    const ring = SHAPES.find(([id]) => id === 'ring')![1];
    const b: boolean[] = emptyCells(ring);
    b[24] = true; // centre of the ring is a gap
    expect(s.solve(b, ring)).toBeNull();
    expect(s.isSolvable(b, ring)).toBe(false);
    expect(() => s.solve(emptyCells(CLASSIC_SHAPE), ring)).toThrow(/49 grid positions/);
  });

  test('absent shape and an explicit 5×5 both mean the classic board', () => {
    const s = boot();
    const five: Shape = { cols: 5, rows: 5, mask: null };
    for (const b of boards(CLASSIC_SHAPE, 9, 100)) {
      expect(s.solve(b, five)).toEqual(s.solve(b));
      expect(s.solve(b, CLASSIC_SHAPE)).toEqual(s.solve(b));
    }
  });

  test('solves fast on every shape', () => {
    const s = boot();
    const timings: Record<string, number> = {};
    for (const [id, shape] of [['classic', undefined], ...SHAPES] as [string, Shape | undefined][]) {
      const list = boards(shape ?? CLASSIC_SHAPE, 11, 1000);
      for (const b of list) s.solve(b, shape); // warm up
      const rounds = 10;
      const t0 = performance.now();
      for (let r = 0; r < rounds; r++) for (const b of list) s.solve(b, shape);
      timings[id] = Number((((performance.now() - t0) * 1000) / (rounds * list.length)).toFixed(2));
    }
    console.log('solver: µs per solve', JSON.stringify(timings));
    for (const us of Object.values(timings)) expect(us).toBeLessThan(100);
  });
});

describe('large boards (more than 64 cells, several mask words)', () => {
  const rect = (cols: number, rows: number): Shape => ({ cols, rows, mask: null });
  test.each([[8, 8, 0], [10, 10, 0], [5, 16, 0], [9, 9, 8], [7, 16, 0]])('%i×%i: null space %i, solve clears and agrees with the reference', (cols, rows, nullDim) => {
    const shape = rect(cols, rows);
    const s = createShaped(shape);
    expect(s.cells).toBe(cols * rows);
    expect(s.nullDim).toBe(nullDim);
    const rng = createRng(cols * 100 + rows);
    for (let t = 0; t < 12; t++) {
      let cells = emptyCells(shape) as Cells;
      const taps = new Set<number>();
      while (taps.size < 3 + t * 2) taps.add(rng.int(cols * rows));
      for (const i of taps) cells = s.press(cells, i);
      const sol = s.solve(cells)!;
      expect(sol).not.toBeNull();
      let after = cells;
      for (const i of sol) after = s.press(after, i);
      expect(after.every((on) => !on)).toBe(true);
      // invertible boards: the solution is unique, so par is exactly the taps that built the board
      if (nullDim === 0) expect([...sol].sort((a, b) => a - b)).toEqual([...taps].sort((a, b) => a - b));
      else expect(sol.length).toBe(refSolve(shape, cells)!.length);
    }
  });
});
