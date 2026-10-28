// The probe's own Lights Out solver (5×5), independent of the game's.
// Boards are 25-bit masks, bit i = cell i (row-major), 1 = lit. Pressing i flips i and its 4 neighbours.
// Solve A·x = b over GF(2): Gauss–Jordan once at load, then each solve is a few bit operations.
// The 5×5 matrix has rank 23, so every solvable board has 4 solutions; we return the shortest.

export const CELLS = 25;

export function pressMask(i) {
  const r = Math.floor(i / 5), c = i % 5;
  let m = 1 << i;
  if (r > 0) m |= 1 << (i - 5);
  if (r < 4) m |= 1 << (i + 5);
  if (c > 0) m |= 1 << (i - 1);
  if (c < 4) m |= 1 << (i + 1);
  return m;
}

export const toMask = (cells) => cells.reduce((m, on, i) => (on ? m | (1 << i) : m), 0);
export const toCells = (mask) => Array.from({ length: CELLS }, (_, i) => ((mask >> i) & 1) === 1);
export const popcount = (m) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
const parity = (m) => popcount(m) & 1;

// Row k of A is pressMask(k) (A is symmetric). `t` tracks which original equations a row is made of.
const rows = Array.from({ length: CELLS }, (_, k) => ({ a: pressMask(k), t: 1 << k }));
const pivots = [];
let rank = 0;
for (let col = 0; col < CELLS; col++) {
  let p = -1;
  for (let k = rank; k < CELLS; k++) if ((rows[k].a >> col) & 1) { p = k; break; }
  if (p < 0) continue;
  [rows[rank], rows[p]] = [rows[p], rows[rank]];
  for (let k = 0; k < CELLS; k++) {
    if (k !== rank && (rows[k].a >> col) & 1) { rows[k].a ^= rows[rank].a; rows[k].t ^= rows[rank].t; }
  }
  pivots.push({ col, row: rows[rank] });
  rank++;
}
/** a board b is solvable iff parity(t & b) == 0 for every zero row */
const conditions = rows.slice(rank).map((r) => r.t);
const pivotCols = pivots.reduce((m, p) => m | (1 << p.col), 0);
const nullBasis = [];
for (let f = 0; f < CELLS; f++) {
  if ((pivotCols >> f) & 1) continue;
  let x = 1 << f;
  for (const { col, row } of pivots) if ((row.a >> f) & 1) x |= 1 << col;
  nullBasis.push(x);
}

/** fewest presses that turn every light off, as a press mask, or null if unsolvable */
export function solveMask(b) {
  for (const t of conditions) if (parity(t & b)) return null;
  let x0 = 0;
  for (const { col, row } of pivots) if (parity(row.t & b)) x0 |= 1 << col;
  let best = x0;
  for (let k = 1; k < 1 << nullBasis.length; k++) {
    let x = x0;
    nullBasis.forEach((n, j) => { if ((k >> j) & 1) x ^= n; });
    if (popcount(x) < popcount(best)) best = x;
  }
  return best;
}

/** fewest-presses solution as sorted cell indexes (cells: 25 booleans or a mask), or null */
export function solve(cells) {
  const x = solveMask(typeof cells === 'number' ? cells : toMask(cells));
  if (x === null) return null;
  const out = [];
  for (let i = 0; i < CELLS; i++) if ((x >> i) & 1) out.push(i);
  return out;
}

export function applyPresses(mask, presses) {
  return presses.reduce((m, i) => m ^ pressMask(i), mask);
}
