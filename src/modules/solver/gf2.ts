// Pure GF(2) maths for the square board, using 25-bit masks (bit i = cell i, row-major).
// createGf2() eliminates the press matrix once; after that a solve is a few table lookups
// and popcounts: a particular solution, then the lightest of it XOR each null-space vector.
import { CELL_COUNT, SIZE, type Cells } from '../../contracts';

const N = SIZE;
const C = CELL_COUNT;
/** bit-widths of the lookup chunks for the particular solution; they sum to C */
const CHUNKS = [7, 6, 6, 6];

export function pressMask(i: number): number {
  const r = Math.floor(i / N), c = i % N;
  let m = 1 << i;
  if (r > 0) m |= 1 << (i - N);
  if (r < N - 1) m |= 1 << (i + N);
  if (c > 0) m |= 1 << (i - 1);
  if (c < N - 1) m |= 1 << (i + 1);
  return m;
}

export function popcount(m: number): number {
  m = m - ((m >>> 1) & 0x55555555);
  m = (m & 0x33333333) + ((m >>> 2) & 0x33333333);
  return Math.imul((m + (m >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
}

function checkCells(cells: Cells): void {
  if (!Array.isArray(cells) || cells.length !== C) {
    throw new Error(`A board has ${C} cells, but this one has ${Array.isArray(cells) ? cells.length : 'none'}`);
  }
}

export function toMask(cells: Cells): number {
  checkCells(cells);
  let m = 0;
  for (let i = 0; i < C; i++) if (cells[i]) m |= 1 << i;
  return m;
}

export function fromMask(m: number): boolean[] {
  const out = new Array<boolean>(C);
  for (let i = 0; i < C; i++) out[i] = ((m >>> i) & 1) === 1;
  return out;
}

/** set bits of m, ascending */
export function indexes(m: number): number[] {
  const out: number[] = [];
  while (m) {
    const low = m & -m;
    out.push(31 - Math.clz32(low));
    m ^= low;
  }
  return out;
}

export interface Gf2 {
  rank: number;
  /** every vector of the null space, including 0 (pressing one changes nothing) */
  nulls: readonly number[];
  /** lightest press mask that clears `board`, or -1 if none does */
  solveMask(board: number): number;
  press(cells: Cells, index: number): Cells;
  solve(cells: Cells): number[] | null;
  isSolvable(cells: Cells): boolean;
}

export function createGf2(): Gf2 {
  // Gauss-Jordan on [A | I]. A is symmetric, so row i of A is pressMask(i).
  const left = Array.from({ length: C }, (_, i) => pressMask(i));
  const right = Array.from({ length: C }, (_, i) => 1 << i);
  const pivots: number[] = [];
  for (let col = 0; col < C; col++) {
    const rank = pivots.length;
    let p = -1;
    for (let r = rank; r < C; r++) if ((left[r]! >>> col) & 1) { p = r; break; }
    if (p < 0) continue;
    [left[rank], left[p]] = [left[p]!, left[rank]!];
    [right[rank], right[p]] = [right[p]!, right[rank]!];
    for (let r = 0; r < C; r++) {
      if (r !== rank && (left[r]! >>> col) & 1) { left[r]! ^= left[rank]!; right[r]! ^= right[rank]!; }
    }
    pivots.push(col);
  }
  const rank = pivots.length;

  // b is solvable iff it is orthogonal to every row that eliminated to zero
  const checks = right.slice(rank);
  // particular solution (free presses = 0): x[pivot r] = parity(right[r] & b); linear in b, so per lit bit:
  const colOf = new Array<number>(C).fill(0);
  for (let r = 0; r < rank; r++) for (let i = 0; i < C; i++) if ((right[r]! >>> i) & 1) colOf[i]! |= 1 << pivots[r]!;
  // null basis: one vector per free column
  const free = [...Array(C).keys()].filter((c) => !pivots.includes(c));
  const basis = free.map((f) => {
    let x = 1 << f;
    for (let r = 0; r < rank; r++) if ((left[r]! >>> f) & 1) x |= 1 << pivots[r]!;
    return x;
  });
  const nulls = basis.reduce<number[]>((all, b) => [...all, ...all.map((n) => n ^ b)], [0]);
  const others = nulls.slice(1);

  // chunked lookup tables so the particular solution is 4 lookups instead of 25 steps
  const tables: Int32Array[] = [];
  const shifts: number[] = [];
  let base = 0;
  for (const width of CHUNKS) {
    const t = new Int32Array(1 << width);
    for (let v = 1; v < t.length; v++) {
      const low = v & -v;
      t[v] = t[v ^ low]! ^ colOf[base + 31 - Math.clz32(low)]!;
    }
    tables.push(t);
    shifts.push(base);
    base += width;
  }
  const [t0, t1, t2, t3] = tables as [Int32Array, Int32Array, Int32Array, Int32Array];
  const [, s1, s2, s3] = shifts as [number, number, number, number];
  const m1 = t1.length - 1, m2 = t2.length - 1, m3 = t3.length - 1, m0 = t0.length - 1;

  const solvable = (b: number) => {
    for (const c of checks) if (popcount(c & b) & 1) return false;
    return true;
  };

  function solveMask(b: number): number {
    if (!solvable(b)) return -1;
    const x0 = t0[b & m0]! ^ t1[(b >>> s1) & m1]! ^ t2[(b >>> s2) & m2]! ^ t3[(b >>> s3) & m3]!;
    let best = x0, weight = popcount(x0);
    for (const n of others) {
      const x = x0 ^ n, w = popcount(x);
      if (w < weight) { best = x; weight = w; }
    }
    return best;
  }

  return {
    rank,
    nulls,
    solveMask,
    press(cells, index) {
      if (!Number.isInteger(index) || index < 0 || index >= C) throw new Error(`Cell ${index} is not on the board (0–${C - 1})`);
      return fromMask(toMask(cells) ^ pressMask(index));
    },
    solve(cells) {
      const x = solveMask(toMask(cells));
      return x < 0 ? null : indexes(x);
    },
    isSolvable: (cells) => solvable(toMask(cells)),
  };
}
