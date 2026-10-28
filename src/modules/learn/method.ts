// Pure maths for the lessons, derived from the solver service (press / isSolvable / solve).
// Nothing here is hard-coded: the bottom-row table and the quiet patterns are found by trying.
import { CELL_COUNT, SIZE, type Cells, type SolverService } from '../../contracts';

type Press = Pick<SolverService, 'press'>;

/** first cell of the bottom row */
export const BOTTOM = (SIZE - 1) * SIZE;

export const blank = (): Cells => new Array<boolean>(CELL_COUNT).fill(false);

/** a board with these cells lit (an index listed twice cancels) */
export function lit(indexes: readonly number[]): Cells {
  const c = blank();
  for (const i of indexes) c[i] = !c[i];
  return c;
}

export const litIndexes = (cells: readonly boolean[]): number[] => cells.flatMap((on, i) => (on ? [i] : []));
export const isClear = (cells: readonly boolean[]): boolean => cells.every((on) => !on);

/** set bits of a 5-bit row mask as column numbers */
export const columns = (mask: number): number[] => [...Array(SIZE).keys()].filter((c) => (mask >> c) & 1);

export function pressAll(solver: Press, cells: Cells, presses: readonly number[]): Cells {
  let b = cells;
  for (const p of presses) b = solver.press(b, p);
  return b;
}

/** true when nothing above the bottom row is lit */
export const onlyBottom = (cells: readonly boolean[]): boolean => cells.every((on, i) => !on || i >= BOTTOM);

/** lit columns of the bottom row */
export const bottomColumns = (cells: readonly boolean[]): number[] => columns(cells.slice(BOTTOM).reduce((m, on, c) => (on ? m | (1 << c) : m), 0));

/** Light chasing: row by row from the top, tap the cell under every lit light. */
export function chase(solver: Press, cells: Cells): { taps: number[]; cells: Cells } {
  let b = cells;
  const taps: number[] = [];
  for (let r = 0; r < SIZE - 1; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!b[r * SIZE + c]) continue;
      const t = (r + 1) * SIZE + c;
      b = solver.press(b, t);
      taps.push(t);
    }
  }
  return { taps, cells: b };
}

/** the next chase tap: under the leftmost lit light of the highest lit row (above the bottom), or null */
export function chaseSuggest(cells: readonly boolean[]): number | null {
  for (let i = 0; i < BOTTOM; i++) if (cells[i]) return i + SIZE;
  return null;
}

export interface TableEntry {
  /** lit columns left in the bottom row after a chase */
  bottom: number[];
  /** top-row columns to tap before chasing again (fewest taps) */
  top: number[];
}

/**
 * For every non-empty bottom row: if a board with only that row lit can be solved, find the fewest
 * top-row taps after which a second chase clears it. On 5×5 exactly 7 rows qualify.
 */
export function bottomRowTable(solver: Pick<SolverService, 'press' | 'isSolvable'>): TableEntry[] {
  const out: TableEntry[] = [];
  for (let p = 1; p < 1 << SIZE; p++) {
    const bottom = columns(p);
    const board = lit(bottom.map((c) => BOTTOM + c));
    if (!solver.isSolvable(board)) continue;
    let best: number[] | null = null;
    for (let t = 0; t < 1 << SIZE; t++) {
      const top = columns(t);
      if (best && top.length >= best.length) continue;
      if (isClear(chase(solver, pressAll(solver, board, top)).cells)) best = top;
    }
    if (!best) throw new Error(`No top-row taps clear the bottom row ${bottom.join(',')}, though the solver says it can be solved`);
    out.push({ bottom, top: best });
  }
  return out;
}

export function lookup(table: readonly TableEntry[], bottom: readonly number[]): TableEntry | undefined {
  return table.find((e) => e.bottom.length === bottom.length && e.bottom.every((c, k) => c === bottom[k]));
}

/**
 * Quiet patterns: tap sets that change nothing. A tap set is fixed by its top row once you chase,
 * so try all 31 non-empty top rows, chase from a dark board, and keep the ones that end dark.
 */
export function quietPatterns(solver: Press): number[][] {
  const out: number[][] = [];
  for (let t = 1; t < 1 << SIZE; t++) {
    const top = columns(t);
    const { taps, cells } = chase(solver, pressAll(solver, blank(), top));
    if (isClear(cells)) out.push([...top, ...taps].sort((a, b) => a - b));
  }
  return out;
}

/**
 * The next tap of the full method (chase → top-row taps from the table → chase), worked out from
 * the board alone so it survives reloads: if the board is "bottom row + some of its table taps",
 * finish those taps first; else chase; else look the bottom row up.
 */
export function methodSuggest(solver: Press, table: readonly TableEntry[], cells: Cells): number | null {
  if (isClear(cells)) return null;
  for (let t = 1; t < 1 << SIZE; t++) {
    const done = columns(t);
    const before = pressAll(solver, cells, done);
    if (isClear(before) || !onlyBottom(before)) continue;
    const entry = lookup(table, bottomColumns(before));
    if (entry && done.length < entry.top.length && done.every((c) => entry.top.includes(c))) {
      return entry.top.find((c) => !done.includes(c))!;
    }
  }
  const next = chaseSuggest(cells);
  if (next !== null) return next;
  return lookup(table, bottomColumns(cells))?.top[0] ?? null;
}

/** every tap the method makes on this board, reduced to a set (a cell tapped twice cancels) */
export function methodTaps(solver: Press, table: readonly TableEntry[], cells: Cells): number[] | null {
  const counts = new Map<number, number>();
  let b = cells;
  for (let guard = 0; guard < 200 && !isClear(b); guard++) {
    const t = methodSuggest(solver, table, b);
    if (t === null) return null;
    counts.set(t, (counts.get(t) ?? 0) + 1);
    b = solver.press(b, t);
  }
  if (!isClear(b)) return null;
  return [...counts].filter(([, n]) => n % 2 === 1).map(([i]) => i).sort((a, b2) => a - b2);
}

/** a board made from `count` distinct taps chosen from `pool`; never dark */
export function makeBoard(solver: Press, pick: (n: number) => number, count: number, pool: readonly number[]): Cells {
  for (let attempt = 0; attempt < 50; attempt++) {
    const bag = [...pool];
    const taps: number[] = [];
    for (let k = 0; k < count && bag.length; k++) taps.push(bag.splice(pick(bag.length), 1)[0]!);
    const board = pressAll(solver, blank(), taps);
    if (!isClear(board)) return board;
  }
  return pressAll(solver, blank(), [pool[0]!]);
}
