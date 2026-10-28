// GF(2) maths for a board of any shape and grid (gaps, honeycombs, cubes, wiring, stuck cells; up to MAX_CELLS).
// Equations are the real cells (cell e = the e-th real cell, row-major); variables are the cells that can be pressed
// (variable j = the j-th pressable cell). Masks are W 32-bit words (bit k%32 of word k>>5). The press map need not be
// symmetric (wiring) or square (stuck cells): row e of the matrix = the presses that flip cell e.
// createShaped() eliminates once per shape; a solve is one pass over the board (building the board mask and its
// particular solution together), the parity checks, then the lightest of that solution XOR each null-space vector.
import { type Cells, type Shape } from '../../contracts';
import { cellIndexes, gridSize, isPressable, pressTargets, shapeKey } from '../../lib/shape';
import { popcount } from './gf2';

/** above this many free presses the null space (2^dim vectors) is too big to search fully */
export const MAX_NULL_DIM = 12;

export interface Shaped {
  key: string;
  /** real cells (the number of equations) */
  cells: number;
  /** cells that can be pressed (the number of variables) */
  presses: number;
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

/** n masks of w words each, stored flat: mask r is words [r*w, r*w + w) */
function masks(n: number, w: number) {
  const a = new Int32Array(n * w);
  return {
    a,
    has: (r: number, j: number) => (a[r * w + (j >> 5)]! & bitOf(j)) !== 0,
    set: (r: number, j: number) => { a[r * w + (j >> 5)]! |= bitOf(j); },
    xorInto: (dst: number, src: number) => { for (let k = 0; k < w; k++) a[dst * w + k]! ^= a[src * w + k]!; },
    swap: (r: number, s: number) => { for (let k = 0; k < w; k++) { const t = a[r * w + k]!; a[r * w + k] = a[s * w + k]!; a[s * w + k] = t; } },
    row: (r: number) => a.slice(r * w, r * w + w),
  };
}

export function createShaped(shape: Shape): Shaped {
  const size = gridSize(shape);
  const key = shapeKey(shape);
  const realCells = cellIndexes(shape);
  const pressCells = realCells.filter((g) => isPressable(shape, g));
  const n = realCells.length; // equations
  const m = pressCells.length; // variables
  const Wn = Math.max(1, Math.ceil(n / 32));
  const Wm = Math.max(1, Math.ceil(m / 32));
  /** grid index → equation (real cell), or -1 for a gap */
  const eqOf = new Int32Array(size).fill(-1);
  realCells.forEach((g, e) => { eqOf[g] = e; });
  const targets = Array.from({ length: size }, (_, g) => pressTargets(shape, g));

  // Gauss-Jordan on [M | I]: row e of M = the presses that flip cell e; I tracks which cells each row combines
  const L = masks(n, Wm), R = masks(n, Wn);
  pressCells.forEach((g, j) => { for (const t of targets[g]!) L.set(eqOf[t]!, j); });
  for (let e = 0; e < n; e++) R.set(e, e);
  const pivots: number[] = [];
  for (let col = 0; col < m; col++) {
    const rank = pivots.length;
    let p = -1;
    for (let r = rank; r < n; r++) if (L.has(r, col)) { p = r; break; }
    if (p < 0) continue;
    L.swap(rank, p); R.swap(rank, p);
    for (let r = 0; r < n; r++) {
      if (r !== rank && L.has(r, col)) { L.xorInto(r, rank); R.xorInto(r, rank); }
    }
    pivots.push(col);
  }
  const rank = pivots.length;
  const nullDim = m - rank;

  // b is solvable iff it is orthogonal to every row of R whose M part eliminated to zero
  const checks: Int32Array[] = [];
  for (let r = rank; r < n; r++) checks.push(R.row(r));
  // particular solution (free presses = 0) is linear in b: one press mask (Wm words) per lit cell
  const col = masks(n, Wm);
  for (let r = 0; r < rank; r++) {
    const pv = pivots[r]!;
    for (let e = 0; e < n; e++) if (R.has(r, e)) col.set(e, pv);
  }
  // null basis: one vector per free column
  const isPivot = new Uint8Array(m);
  for (const p of pivots) isPivot[p] = 1;
  const free = [...Array(m).keys()].filter((c) => !isPivot[c]);
  const basis = masks(free.length, Wm);
  free.forEach((f, k) => {
    basis.set(k, f);
    for (let r = 0; r < rank; r++) if (L.has(r, f)) basis.set(k, pivots[r]!);
  });
  const approximate = nullDim > MAX_NULL_DIM;
  const W = Wm;
  // every null vector (index 0 = zero) when the space is small enough to search; otherwise just the basis
  let nulls: Int32Array;
  let nullCount: number;
  if (!approximate) {
    nullCount = 1 << nullDim;
    nulls = new Int32Array(nullCount * W);
    for (let k = 0; k < free.length; k++) {
      const half = 1 << k;
      for (let v = 0; v < half; v++) for (let i = 0; i < W; i++) nulls[(half + v) * W + i] = nulls[v * W + i]! ^ basis.a[k * W + i]!;
    }
  } else {
    nullCount = free.length;
    nulls = basis.a;
  }

  function check(cells: Cells): void {
    if (!Array.isArray(cells) || cells.length !== size) {
      throw new Error(`A ${shape.cols}×${shape.rows} board has ${size} grid positions, but this one has ${Array.isArray(cells) ? cells.length : 'none'}`);
    }
  }

  const weightOf = (x: Int32Array) => { let w = 0; for (let i = 0; i < W; i++) w += popcount(x[i]!); return w; };

  /** lightest press mask (Wm words) that clears the board, or null (also when a gap is lit) */
  function solveMask(cells: Cells): Int32Array | null {
    check(cells);
    const b = new Int32Array(Wn), x = new Int32Array(W);
    for (let g = 0; g < size; g++) {
      if (!cells[g]) continue;
      const e = eqOf[g]!;
      if (e < 0) return null; // a lit gap can never be switched off
      b[e >> 5]! ^= bitOf(e);
      for (let i = 0; i < W; i++) x[i]! ^= col.a[e * W + i]!;
    }
    for (const c of checks) {
      let parity = 0;
      for (let i = 0; i < Wn; i++) parity += popcount(c[i]! & b[i]!);
      if (parity & 1) return null;
    }
    let weight = weightOf(x);
    const trial = new Int32Array(W);
    const tryVector = (k: number, into: Int32Array): boolean => {
      let w = 0;
      for (let i = 0; i < W; i++) { trial[i] = x[i]! ^ nulls[k * W + i]!; w += popcount(trial[i]!); }
      if (w >= weight) return false;
      weight = w;
      into.set(trial);
      return true;
    };
    if (!approximate) {
      const best = x.slice();
      for (let k = 1; k < nullCount; k++) tryVector(k, best);
      return best;
    }
    // sound fallback: keep applying any basis vector that makes the solution lighter (still a solution)
    for (let improved = true; improved;) {
      improved = false;
      for (let k = 0; k < nullCount; k++) if (tryVector(k, x)) improved = true;
    }
    return x;
  }

  return {
    key,
    cells: n,
    presses: m,
    rank,
    nullDim,
    approximate,
    press(cells, index) {
      check(cells);
      if (!Number.isInteger(index) || index < 0 || index >= size || eqOf[index]! < 0) {
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
      for (let w = 0; w < W; w++) {
        let mm = x[w]!;
        while (mm) {
          const low = mm & -mm;
          out.push(pressCells[w * 32 + 31 - Math.clz32(low)]!);
          mm ^= low;
        }
      }
      return out;
    },
    isSolvable: (cells) => solveMask(cells) !== null,
  };
}
