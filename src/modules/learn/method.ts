// Pure maths for the lessons, derived from the solver service (press / isSolvable / solve).
// Nothing here is hard-coded: the bottom-row table and the quiet patterns are found by trying.
import { CELL_COUNT, SIZE, type Cells, type Shape, type SolverService } from '../../contracts';
import { cellIndexes, emptyCells, gridSize, isCell, isPressable, pressTargets } from '../../lib/shape';

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

/** press each in turn; shape absent = the classic board */
export function pressAll(solver: Press, cells: Cells, presses: readonly number[], shape?: Shape): Cells {
  let b = cells;
  for (const p of presses) b = shape ? solver.press(b, p, shape) : solver.press(b, p);
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
  /** top-row columns to tap before chasing again: the fix that ends in the fewest taps in all */
  top: number[];
}

/**
 * For every non-empty bottom row: if a board with only that row lit can be solved, find the top-row taps after which
 * a second chase clears it, choosing the fix with the fewest taps in all (its top taps plus the chase after them; ties:
 * fewer top taps, then the leftmost). Fewer top taps isn't always fewer taps: for B·D, A·D takes 15 and A·B·C 11.
 * On 5×5 exactly 7 rows qualify, each with four fixes (a fix plus a quiet top row is another fix).
 */
export function bottomRowTable(solver: Pick<SolverService, 'press' | 'isSolvable'>): TableEntry[] {
  const out: TableEntry[] = [];
  for (let p = 1; p < 1 << SIZE; p++) {
    const bottom = columns(p);
    const board = lit(bottom.map((c) => BOTTOM + c));
    if (!solver.isSolvable(board)) continue;
    let best: number[] | null = null;
    let bestTotal = Infinity;
    for (let t = 0; t < 1 << SIZE; t++) {
      const top = columns(t);
      const after = chase(solver, pressAll(solver, board, top));
      if (!isClear(after.cells)) continue;
      const total = top.length + after.taps.length;
      if (total < bestTotal || (total === bestTotal && top.length < best!.length)) { best = top; bestTotal = total; }
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

/** a board made from `count` distinct taps chosen from `pool`; never dark. shape absent = classic */
export function makeBoard(solver: Press, pick: (n: number) => number, count: number, pool: readonly number[], shape?: Shape, ok?: (taps: readonly number[]) => boolean): Cells {
  const dark = shape ? emptyCells(shape) : blank();
  for (let attempt = 0; attempt < (ok ? 300 : 50); attempt++) {
    const bag = [...pool];
    const taps: number[] = [];
    for (let k = 0; k < count && bag.length; k++) taps.push(bag.splice(pick(bag.length), 1)[0]!);
    if (ok && !ok(taps)) continue;
    const board = pressAll(solver, dark, taps, shape);
    if (!isClear(board)) return board;
  }
  return pressAll(solver, dark, [pool[0]!], shape);
}

/** two taps' shapes touch: a light of one is, or sits next to, a light of the other */
export function touches(shape: Shape, a: number, b: number): boolean {
  const fb = pressTargets(shape, b);
  return pressTargets(shape, a).some((x) => pressTargets(shape, x).some((y) => fb.includes(y)));
}

// ---------- echoes: why the bottom-row table works ----------

/** the bottom row one top-row tap leaves on a dark board after a chase (its "echo"), as columns */
export function echoOf(solver: Press, col: number): number[] {
  return bottomColumns(chase(solver, solver.press(blank(), col)).cells);
}

/** the echo of a set of top-row taps: echoes stack, and a light lit by two of them cancels */
export function echoOfSet(solver: Press, cols: readonly number[]): number[] {
  return bottomColumns(chase(solver, pressAll(solver, blank(), cols)).cells);
}

/** true when these top-row taps clear a board whose only lights are this bottom row (tap, then chase) */
export function clearsBottom(solver: Press, bottom: readonly number[], top: readonly number[]): boolean {
  const board = lit(bottom.map((c) => BOTTOM + c));
  return isClear(chase(solver, pressAll(solver, board, top)).cells);
}

const FULL_ROW = (1 << SIZE) - 1;
/** a row of taps lights itself and its left and right neighbours */
const spread = (m: number) => (m ^ (m << 1) ^ (m >> 1)) & FULL_ROW;

/**
 * How an echo is made, by the row rule alone (no board): the taps in each row are the row above
 * spread, cancelled against the row two above. Row 1 is the one top-row tap; the echo is what a
 * sixth row would need. learn.test.ts checks this equals the real chase.
 */
export function echoRows(col: number): { rows: number[][]; echo: number[] } {
  let prev = 0;
  let cur = 1 << col;
  const rows = [columns(cur)];
  for (let r = 1; r < SIZE; r++) {
    const next = spread(cur) ^ prev;
    prev = cur;
    cur = next;
    rows.push(columns(cur));
  }
  return { rows, echo: columns(spread(cur) ^ prev) };
}

// ---------- full rectangles of any size (Variety rooms) ----------

type ShapedPress = Pick<SolverService, 'press'>;
interface Rect { cols: number; rows: number; mask: null }

/** chase on any full rectangle: row by row, tap under every lit light */
export const chaseRect = (solver: ShapedPress, cells: Cells, shape: Rect): Cells => chaseShape(solver, cells, shape).cells;

const popcount = (m: number): number => { let n = 0; for (let x = m; x; x &= x - 1) n++; return n; };
/** a null space bigger than this isn't searched whole (2^n answers); the answer is then made lighter step by step */
const MAX_NULL_SEARCH = 12;

/**
 * For each bottom-row light of a full rectangle: the fewest top-row taps that, after a chase, clear a board
 * where only that light is lit (null when no top taps do). Linear in the width: each top light is chased once for its
 * echo (the bottom row it leaves); echoes of a set of top lights add up over GF(2) (a light lit twice cancels), so the
 * sets for a bottom light are one answer plus any mix of the "quiet" sets whose echoes cancel, and the lightest of
 * those is kept (a tie goes to the lowest columns). Where every echo is dark (4×4) a chase alone clears any solvable
 * board. Where some lone bottom lights have no set (9×9: a chase leaves the bottom row dark or A C E G I, nothing else),
 * `tapsFor` still answers each bottom row a chase can leave: `rows` counts them (not counting dark). A 20-wide custom
 * board takes 20 chases, not 2^20.
 */
export interface RectSets {
  perLight: (number[] | null)[];
  chaseClears: boolean;
  /** how many lit bottom rows a chase can leave on a solvable board (2^rank − 1) */
  rows: number;
  /** the top taps for a lit bottom row (each light's set, overlaps cancel, when every light has one; else the lightest
   *  answer for the whole row), or null when no top taps clear it */
  tapsFor: (bottom: readonly number[]) => number[] | null;
  /** the lit bottom rows a chase can leave, when there are at most `max` of them (fewest lights first), else null */
  possibleRows: (max: number) => number[][] | null;
}
export function rectTopSets(solver: ShapedPress, shape: Rect): RectSets {
  const { cols, rows } = shape;
  const dark = new Array<boolean>(cols * rows).fill(false);
  // echo[k]: the bottom row (bit c = column c) that tapping top light k, then chasing, leaves
  const echo = Array.from({ length: cols }, (_, k) => {
    const left = chaseRect(solver, solver.press(dark, k, shape), shape);
    let m = 0;
    for (let c = 0; c < cols; c++) if (left[(rows - 1) * cols + c]) m |= 1 << c;
    return m;
  });
  // an XOR basis of the echoes, each with the top lights that make it (`pre`); sets whose echoes cancel are quiet
  const basis: { echo: number; pre: number }[] = [];
  const quiet: number[] = [];
  echo.forEach((e, k) => {
    let img = e, pre = 1 << k;
    for (const b of basis) if ((img ^ b.echo) < img) { img ^= b.echo; pre ^= b.pre; }
    if (img) { basis.push({ echo: img, pre }); basis.sort((x, y) => y.echo - x.echo); } else quiet.push(pre);
  });
  /** the top lights whose echoes add up to `target`, or null */
  const solveFor = (target: number): number | null => {
    let img = target, pre = 0;
    for (const b of basis) if ((img ^ b.echo) < img) { img ^= b.echo; pre ^= b.pre; }
    return img ? null : pre;
  };
  /** the lightest of x and x plus any quiet mix: every mix while there are few, else one quiet set at a time while it helps */
  const lightest = (x: number): number => {
    let best = x;
    const better = (m: number) => popcount(m) < popcount(best) || (popcount(m) === popcount(best) && m < best);
    if (quiet.length <= MAX_NULL_SEARCH) {
      for (let mix = 1; mix < 1 << quiet.length; mix++) {
        let m = x;
        for (let j = 0; j < quiet.length; j++) if ((mix >> j) & 1) m ^= quiet[j]!;
        if (better(m)) best = m;
      }
      return best;
    }
    for (let improved = true; improved;) {
      improved = false;
      for (const q of quiet) if (better(best ^ q)) { best ^= q; improved = true; }
    }
    return best;
  };
  const bits = (m: number) => [...Array(cols).keys()].filter((c) => (m >> c) & 1);
  const perLight = Array.from({ length: cols }, (_, c) => {
    const x = solveFor(1 << c);
    return x === null ? null : bits(lightest(x));
  });
  const everyLight = perLight.every((set) => set !== null);
  const tapsFor = (bottom: readonly number[]): number[] | null => {
    if (everyLight) return rectTaps(perLight, bottom);
    const x = solveFor(bottom.reduce((m, c) => m | (1 << c), 0));
    return x === null ? null : bits(lightest(x));
  };
  const possibleRows = (max: number): number[][] | null => {
    if (2 ** basis.length - 1 > max) return null;
    const out: number[] = [];
    for (let mix = 1; mix < 1 << basis.length; mix++) {
      let m = 0;
      for (let j = 0; j < basis.length; j++) if ((mix >> j) & 1) m ^= basis[j]!.echo;
      out.push(m);
    }
    return out.sort((a, b) => popcount(a) - popcount(b) || a - b).map(bits);
  };
  return { perLight, chaseClears: echo.every((e) => e === 0), rows: 2 ** basis.length - 1, tapsFor, possibleRows };
}

/**
 * The per-light rules a player can say in a few words, by column c of n (A = 0). Each is a guess that
 * `rectRule` checks against the solver's sets; learn.test.ts proves which rule each room follows.
 */
export const RECT_RULES = {
  /** 5×6, the Tower: the top light straight above it */
  straightAbove: (c: number) => [c],
  /** 7×7: the three above it (two at an edge) */
  threeAbove: (c: number) => [c - 1, c, c + 1],
  /** 6×6: the top lights two to each side; at the very edges also the one above */
  twoAside: (c: number, n: number) => [c - 2, ...(c === 0 || c === n - 1 ? [c] : []), c + 2],
  /** 10×10: the one above and two to each side; at the very edges not the one above */
  aboveTwoAside: (c: number, n: number) => [c - 2, ...(c === 0 || c === n - 1 ? [] : [c]), c + 2],
} as const;
export type RectRule = keyof typeof RECT_RULES;

/** the rule a full rectangle's per-light sets follow, or null when each light just has its own taps (8×8) */
export function rectRule(perLight: readonly (number[] | null)[]): RectRule | null {
  const n = perLight.length;
  const fits = (rule: RectRule) => perLight.every((set, c) => set !== null && set.join() === RECT_RULES[rule](c, n).filter((x) => x >= 0 && x < n).join());
  return (Object.keys(RECT_RULES) as RectRule[]).find(fits) ?? null;
}

/** the top-row taps for a lit bottom row: each light's set, overlaps cancel; null when a light has no set */
export function rectTaps(perLight: readonly (number[] | null)[], bottom: readonly number[]): number[] | null {
  const on = new Set<number>();
  for (const c of bottom) {
    const set = perLight[c];
    if (!set) return null;
    for (const t of set) if (!on.delete(t)) on.add(t);
  }
  return [...on].sort((a, b) => a - b);
}

// ---------- any square-grid shape (rooms with gaps, stuck switches): chase, start and end cells, the start-cell fix ----------
// A chase leaves lights only on "end" cells (nothing below, or a stuck switch below). Taps on "start" cells (nothing
// above) are the only taps a chase can't make, so the leftover is fixed there: tap the fewest start cells whose own
// chase leaves exactly that leftover, then chase again. learn.test.ts proves chase + fix + chase clears every room.

/** true when grid position i is a real cell with a switch below it (a stuck switch can't be pressed, so it doesn't count) */
export const hasBelow = (shape: Shape, i: number): boolean => isCell(shape, i) && i + shape.cols < gridSize(shape) && isPressable(shape, i + shape.cols);
const hasAbove = (shape: Shape, i: number): boolean => isCell(shape, i) && i >= shape.cols && isCell(shape, i - shape.cols);

/** switches with nothing above: where the fix goes ("top-edge lights") */
export const startCells = (shape: Shape): number[] => cellIndexes(shape).filter((i) => !hasAbove(shape, i) && isPressable(shape, i));
/** cells with nothing below: where a chase collects lights */
export const endCells = (shape: Shape): number[] => cellIndexes(shape).filter((i) => !hasBelow(shape, i));
/** true when every lit light sits on an end cell (a chase has nothing left to do) */
export const onlyEnds = (cells: readonly boolean[], shape: Shape): boolean => cells.every((on, i) => !on || !hasBelow(shape, i));

/** Chase on any shape: row by row from the top, tap the cell under each lit light, if there is one. */
export function chaseShape(solver: ShapedPress, cells: Cells, shape: Shape): { taps: number[]; cells: Cells } {
  let b = cells;
  const taps: number[] = [];
  // row-major order is row by row; a tap only changes its own row, the one above and the ones below
  for (let i = 0; i < gridSize(shape); i++) {
    if (!b[i] || !hasBelow(shape, i)) continue;
    b = solver.press(b, i + shape.cols, shape);
    taps.push(i + shape.cols);
  }
  return { taps, cells: b };
}

/** the next chase tap: under the first lit light (row by row) that has a cell below, or null */
export function chaseShapeSuggest(cells: readonly boolean[], shape: Shape): number | null {
  for (let i = 0; i < cells.length; i++) if (cells[i] && hasBelow(shape, i)) return i + shape.cols;
  return null;
}

/** more start cells than this and the 2^n look-up gets slow; no room comes close (the most is 10) */
export const MAX_FIX_STARTS = 14;

const toBits = (cells: readonly boolean[]): bigint => {
  let m = 0n;
  for (let i = cells.length - 1; i >= 0; i--) m = (m << 1n) | (cells[i] ? 1n : 0n);
  return m;
};
const lowBit = (m: number): number => 31 - Math.clz32(m & -m);

export interface Fixer {
  starts: number[];
  ends: number[];
  /** the fewest start taps whose chase leaves exactly this board (so tapping them, then chasing, clears it), or null */
  fixFor(leftover: readonly boolean[]): number[] | null;
  /** part-way through a fix: the board is a leftover plus some (not all) of its fix taps */
  progress(cells: readonly boolean[]): { fix: number[]; done: number[] } | null;
}

/** Works out, once per shape, what each set of start taps leaves after a chase (from the solver, by trying). */
/** set bits in a bigint mask */
function bitCount(x: bigint): number {
  let n = 0;
  for (let v = x; v; v &= v - 1n) n++;
  return n;
}

export function createFixer(solver: ShapedPress, shape: Shape): Fixer {
  const starts = startCells(shape);
  const ends = endCells(shape);
  if (starts.length > MAX_FIX_STARTS) throw new Error(`This board has ${starts.length} top-edge cells; at most ${MAX_FIX_STARTS} can be looked up`);
  const dark = emptyCells(shape);
  const n = 1 << starts.length;
  const alone = starts.map((s) => chaseShape(solver, solver.press(dark, s, shape), shape));
  const echo = alone.map((c) => toBits(c.cells));
  /** the chase's taps after one start tap: chasing is linear, so a set of start taps chases the XOR of these */
  const chaseOf = alone.map((c) => c.taps.reduce((acc, t) => acc ^ (1n << BigInt(t)), 0n));
  const pressed = starts.map((s) => toBits(solver.press(dark, s, shape)));
  /** by subset of starts (bit k = starts[k]): what its chase leaves, what its taps light, and the chase after it */
  const leaves: bigint[] = new Array<bigint>(n).fill(0n);
  const lights: bigint[] = new Array<bigint>(n).fill(0n);
  const chased: bigint[] = new Array<bigint>(n).fill(0n);
  const size = new Uint8Array(n);
  /** every tap a fix takes to dark: its start taps plus the chase after them (a leftover sits on end cells, which a
   *  chase never taps, so the chase after a fix is the fix's own) */
  const total = new Uint16Array(n);
  const best = new Map<bigint, number>();
  for (let m = 1; m < n; m++) {
    const k = lowBit(m), rest = m & (m - 1);
    leaves[m] = leaves[rest]! ^ echo[k]!;
    lights[m] = lights[rest]! ^ pressed[k]!;
    chased[m] = chased[rest]! ^ chaseOf[k]!;
    size[m] = size[rest]! + 1;
    total[m] = size[m]! + bitCount(chased[m]!);
    const had = best.get(leaves[m]!);
    // the fix with the fewest taps in all; fewer start taps only breaks a tie
    if (leaves[m] !== 0n && (had === undefined || total[m]! < total[had]! || (total[m] === total[had] && size[m]! < size[had]!))) best.set(leaves[m]!, m);
  }
  let nonEnd = 0n;
  for (let i = 0; i < gridSize(shape); i++) if (hasBelow(shape, i)) nonEnd |= 1n << BigInt(i);
  const list = (m: number) => starts.filter((_, k) => (m >> k) & 1);
  return {
    starts,
    ends,
    fixFor(leftover) {
      const m = best.get(toBits(leftover));
      return m === undefined ? null : list(m);
    },
    progress(cells) {
      const b = toBits(cells);
      for (let m = 1; m < n; m++) {
        const before = b ^ lights[m]!;
        if (before === 0n || (before & nonEnd) !== 0n) continue;
        const f = best.get(before);
        if (f !== undefined && (m & ~f) === 0 && m !== f) return { fix: list(f), done: list(m) };
      }
      return null;
    },
  };
}

/** the start taps whose chase leaves exactly `leftover` and that take the fewest taps in all, or null (works the table out each call) */
export const fixFor = (solver: ShapedPress, shape: Shape, leftover: readonly boolean[]): number[] | null => createFixer(solver, shape).fixFor(leftover);

/** the next tap of chase → fix → chase on any shape, from the board alone (survives reloads) */
export function fixSuggest(fixer: Fixer, cells: readonly boolean[], shape: Shape): number | null {
  if (isClear(cells)) return null;
  const part = fixer.progress(cells);
  if (part) return part.fix.find((c) => !part.done.includes(c))!;
  return chaseShapeSuggest(cells, shape) ?? fixer.fixFor(cells)?.[0] ?? null;
}

/** where a guide's practice board stands: chasing, only end lights left (their top-edge fix, maybe part done), or chasing again */
export type Coach = { phase: 'chase' } | { phase: 'fix'; ends: number[]; fix: number[] } | { phase: 'again' };

/**
 * From the board alone: mid-fix (some of the fix tapped) or only end lights left → 'fix' with those lights and their fix;
 * else a chase that clears what is left → 'again' (unless the board's own chase cleared it from the start); else 'chase'.
 */
export function coachPhase(solver: ShapedPress, fixer: Fixer, shape: Shape, start: Cells, cells: Cells): Coach | null {
  if (isClear(cells)) return null;
  const part = fixer.progress(cells);
  if (part) return { phase: 'fix', ends: litIndexes(pressAll(solver, cells, part.done, shape)), fix: part.fix };
  if (onlyEnds(cells, shape)) {
    const fix = fixer.fixFor(cells);
    if (fix) return { phase: 'fix', ends: litIndexes(cells), fix };
  }
  if (isClear(chaseShape(solver, cells, shape).cells) && !isClear(chaseShape(solver, start, shape).cells)) return { phase: 'again' };
  return { phase: 'chase' };
}
