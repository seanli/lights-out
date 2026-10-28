// GF(2) maths for a board of any shape (up to 7×7, with gaps). Only real cells are variables:
// variable j is the j-th real cell in row-major order, held as a two-word mask (bit j of [lo, hi], 32 bits each).
// createShaped() eliminates the press matrix once per shape; a solve is one pass over the board
// (building the board mask and its particular solution together), the parity checks, then the
// lightest of that solution XOR each null-space vector.
import { type Cells, type Shape } from '../../contracts';
import { cellIndexes, gridSize, pressTargets, shapeKey } from '../../lib/shape';
import { popcount } from './gf2';

/** above this many free presses the null space (2^dim vectors) is too big to search fully */
export const MAX_NULL_DIM = 12;

export interface Shaped {
  key: string;
  /** real cells (the number of variables) */
  cells: number;
  rank: number;
  /** dimension of the null space: every solvable board has 2^dim solutions */
  nullDim: number;
  /** true when the null space was too big to search and solve returns a short (not always shortest) solution */
  approximate: boolean;
  press(cells: Cells, index: number): Cells;
  solve(cells: Cells): number[] | null;
  isSolvable(cells: Cells): boolean;
}

const bitOf = (j: number) => 1 << (j & 31);

export function createShaped(shape: Shape): Shaped {
  const size = gridSize(shape);
  const key = shapeKey(shape);
  const realCells = cellIndexes(shape);
  const n = realCells.length;
  if (n > 64) throw new Error(`A board can have at most 64 cells, but this one has ${n}`);
  /** grid index → variable, or -1 for a gap */
  const varOf = new Int32Array(size).fill(-1);
  realCells.forEach((g, j) => { varOf[g] = j; });
  const targets = Array.from({ length: size }, (_, g) => pressTargets(shape, g));

  // Gauss-Jordan on [A | I], two words per row. A is symmetric: row j = what pressing variable j toggles.
  const lLo = new Int32Array(n), lHi = new Int32Array(n), rLo = new Int32Array(n), rHi = new Int32Array(n);
  for (let j = 0; j < n; j++) {
    for (const g of targets[realCells[j]!]!) {
      const t = varOf[g]!;
      if (t < 32) lLo[j]! |= bitOf(t); else lHi[j]! |= bitOf(t);
    }
    if (j < 32) rLo[j] = bitOf(j); else rHi[j] = bitOf(j);
  }
  const has = (lo: Int32Array, hi: Int32Array, r: number, col: number) => ((col < 32 ? lo[r]! : hi[r]!) & bitOf(col)) !== 0;
  const swap = (a: Int32Array, i: number, k: number) => { const t = a[i]!; a[i] = a[k]!; a[k] = t; };
  const pivots: number[] = [];
  for (let col = 0; col < n; col++) {
    const rank = pivots.length;
    let p = -1;
    for (let r = rank; r < n; r++) if (has(lLo, lHi, r, col)) { p = r; break; }
    if (p < 0) continue;
    for (const a of [lLo, lHi, rLo, rHi]) swap(a, rank, p);
    for (let r = 0; r < n; r++) {
      if (r !== rank && has(lLo, lHi, r, col)) {
        lLo[r]! ^= lLo[rank]!; lHi[r]! ^= lHi[rank]!; rLo[r]! ^= rLo[rank]!; rHi[r]! ^= rHi[rank]!;
      }
    }
    pivots.push(col);
  }
  const rank = pivots.length;
  const nullDim = n - rank;

  // b is solvable iff it is orthogonal to every row that eliminated to zero
  const checks: [number, number][] = [];
  for (let r = rank; r < n; r++) checks.push([rLo[r]!, rHi[r]!]);
  // particular solution (free presses = 0) is linear in b: one press mask per lit variable
  const colLo = new Int32Array(n), colHi = new Int32Array(n);
  for (let r = 0; r < rank; r++) {
    const pv = pivots[r]!;
    for (let j = 0; j < n; j++) {
      if (!has(rLo, rHi, r, j)) continue;
      if (pv < 32) colLo[j]! |= bitOf(pv); else colHi[j]! |= bitOf(pv);
    }
  }
  // null basis: one vector per free column
  const free = [...Array(n).keys()].filter((c) => !pivots.includes(c));
  const basis: [number, number][] = free.map((f) => {
    let lo = f < 32 ? bitOf(f) : 0, hi = f < 32 ? 0 : bitOf(f);
    for (let r = 0; r < rank; r++) {
      if (!has(lLo, lHi, r, f)) continue;
      const pv = pivots[r]!;
      if (pv < 32) lo |= bitOf(pv); else hi |= bitOf(pv);
    }
    return [lo, hi];
  });
  const approximate = nullDim > MAX_NULL_DIM;
  // every non-zero null vector when the space is small enough to search; otherwise just the basis
  let nullLo: Int32Array, nullHi: Int32Array;
  if (!approximate) {
    const count = 1 << nullDim;
    nullLo = new Int32Array(count); nullHi = new Int32Array(count);
    basis.forEach(([lo, hi], k) => {
      const half = 1 << k;
      for (let v = 0; v < half; v++) { nullLo[half + v] = nullLo[v]! ^ lo; nullHi[half + v] = nullHi[v]! ^ hi; }
    });
  } else {
    nullLo = Int32Array.from(basis, (b) => b[0]);
    nullHi = Int32Array.from(basis, (b) => b[1]);
  }

  function check(cells: Cells): void {
    if (!Array.isArray(cells) || cells.length !== size) {
      throw new Error(`A ${shape.cols}×${shape.rows} board has ${size} grid positions, but this one has ${Array.isArray(cells) ? cells.length : 'none'}`);
    }
  }

  /** lightest press mask [lo, hi] that clears the board, or null (also when a gap is lit) */
  function solveMask(cells: Cells): [number, number] | null {
    check(cells);
    let bLo = 0, bHi = 0, xLo = 0, xHi = 0;
    for (let g = 0; g < size; g++) {
      if (!cells[g]) continue;
      const j = varOf[g]!;
      if (j < 0) return null; // a lit gap can never be switched off
      if (j < 32) bLo ^= bitOf(j); else bHi ^= bitOf(j);
      xLo ^= colLo[j]!; xHi ^= colHi[j]!;
    }
    for (const [cLo, cHi] of checks) if ((popcount(cLo & bLo) + popcount(cHi & bHi)) & 1) return null;
    let weight = popcount(xLo) + popcount(xHi);
    if (!approximate) {
      let bestLo = xLo, bestHi = xHi;
      for (let k = 1; k < nullLo.length; k++) {
        const lo = xLo ^ nullLo[k]!, hi = xHi ^ nullHi[k]!;
        const w = popcount(lo) + popcount(hi);
        if (w < weight) { bestLo = lo; bestHi = hi; weight = w; }
      }
      return [bestLo, bestHi];
    }
    // sound fallback: keep applying any basis vector that makes the solution lighter (still a solution)
    for (let improved = true; improved;) {
      improved = false;
      for (let k = 0; k < nullLo.length; k++) {
        const lo = xLo ^ nullLo[k]!, hi = xHi ^ nullHi[k]!;
        const w = popcount(lo) + popcount(hi);
        if (w < weight) { xLo = lo; xHi = hi; weight = w; improved = true; }
      }
    }
    return [xLo, xHi];
  }

  return {
    key,
    cells: n,
    rank,
    nullDim,
    approximate,
    press(cells, index) {
      check(cells);
      if (!Number.isInteger(index) || index < 0 || index >= size || varOf[index]! < 0) {
        throw new Error(`Cell ${index} is not on this ${shape.cols}×${shape.rows} board`);
      }
      const out = cells.slice();
      for (const g of targets[index]!) out[g] = !out[g];
      return out;
    },
    solve(cells) {
      const x = solveMask(cells);
      if (!x) return null;
      const out: number[] = [];
      for (let w = 0; w < 2; w++) {
        let m = x[w]!;
        while (m) {
          const low = m & -m;
          out.push(realCells[w * 32 + 31 - Math.clz32(low)]!);
          m ^= low;
        }
      }
      return out;
    },
    isSolvable: (cells) => solveMask(cells) !== null,
  };
}
