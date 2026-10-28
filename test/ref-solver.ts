// Independent reference solver for tests (GF(2) elimination + null-space search).
// Deliberately separate from the solver module so the two cross-check each other.
const N = 5;
const C = N * N;

export function pressMask(i: number): number {
  const r = Math.floor(i / N), c = i % N;
  let m = 1 << i;
  if (r > 0) m |= 1 << (i - N);
  if (r < N - 1) m |= 1 << (i + N);
  if (c > 0) m |= 1 << (i - 1);
  if (c < N - 1) m |= 1 << (i + 1);
  return m;
}

export const toMask = (cells: readonly boolean[]) => cells.reduce((m, on, i) => (on ? m | (1 << i) : m), 0);
export const fromMask = (m: number) => Array.from({ length: C }, (_, i) => !!(m & (1 << i)));
export const popcount = (m: number) => { let n = 0; while (m) { m &= m - 1; n++; } return n; };

export function refPress(cells: readonly boolean[], i: number): boolean[] {
  return fromMask(toMask(cells) ^ pressMask(i));
}

/** fewest presses that clear the board, sorted, or null */
export function refSolve(cells: readonly boolean[]): number[] | null {
  // rows of A: row r has bit j set when pressing j toggles r (A is symmetric)
  const rows = Array.from({ length: C }, (_, r) => pressMask(r) | ((cells[r] ? 1 : 0) << C));
  const pivotCol: number[] = [];
  let rank = 0;
  for (let col = 0; col < C && rank < C; col++) {
    const p = rows.findIndex((row, idx) => idx >= rank && row & (1 << col));
    if (p < 0) continue;
    [rows[rank], rows[p]] = [rows[p]!, rows[rank]!];
    for (let r = 0; r < C; r++) if (r !== rank && rows[r]! & (1 << col)) rows[r]! ^= rows[rank]!;
    pivotCol[rank++] = col;
  }
  for (let r = rank; r < C; r++) if (rows[r]! & (1 << C)) return null;
  const free = [...Array(C).keys()].filter((c) => !pivotCol.includes(c));
  let best: number | null = null;
  for (let combo = 0; combo < 1 << free.length; combo++) {
    let x = 0;
    free.forEach((f, k) => { if (combo & (1 << k)) x |= 1 << f; });
    for (let r = 0; r < rank; r++) {
      const row = rows[r]!;
      let bit = (row >> C) & 1;
      for (const f of free) if (row & (1 << f) && x & (1 << f)) bit ^= 1;
      if (bit) x |= 1 << pivotCol[r]!;
    }
    if (best === null || popcount(x) < popcount(best)) best = x;
  }
  return [...Array(C).keys()].filter((i) => best! & (1 << i));
}
