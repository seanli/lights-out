// Making puzzles for any board: presses that tangle (each lands near another, so their footprints overlap and no
// press shows as a whole shape you can read off the board), stuck cells, and per-cell wiring. Pure: the solver and
// a random source come in as arguments. Shared by the levels module (fixed seeds) and the custom module.
import type { Cells, Rng, Shape, SolverService } from '../contracts';
import { cellIndexes, emptyCells, gridOf, gridSize, isCell, isPressable, pressTargets, touching } from './shape';

export interface Made {
  cells: Cells;
  /** the fewest presses that clear it */
  par: number;
  /** presses in that solution whose whole footprint is lit at the start (readable at a glance) */
  readable: number;
  tries: number;
}

export interface TangleOptions {
  /** most readable presses allowed (default 0) */
  readable?: number;
  maxTries?: number;
  /** boards already used: never made again (keys from boardKey) */
  seen?: Set<string>;
  /** the board must need a fix from the top edge: a plain chase down doesn't clear it (chaseClears) */
  needsFix?: boolean;
}

/** a square grid without wiring, where "chase down" is the method (stuck switches and gaps included) */
export const chaseable = (shape: Shape): boolean => gridOf(shape) === 'square' && !shape.wires;

/**
 * True when a plain chase clears the board: row by row from the top, tap the cell under every lit light (where there
 * is a switch under it). Such a level gives par away for free, so after a board's first levels none is made.
 */
export function chaseClears(shape: Shape, cells: Cells, solver: Pick<SolverService, 'press'>): boolean {
  let b = cells;
  for (let i = 0; i < gridSize(shape); i++) {
    const below = i + shape.cols;
    if (b[i] && below < gridSize(shape) && isCell(shape, below) && isPressable(shape, below)) b = solver.press(b, below, shape);
  }
  return !b.some(Boolean);
}

export const boardKey = (cells: Cells): string => cells.map((on) => (on ? '1' : '0')).join('');

/** cells within `radius` steps of i, moving between touching cells (the grid's own geometry, wiring aside) */
function near(shape: Shape, i: number, radius: number): number[] {
  const seen = new Set([i]);
  let edge = [i];
  for (let d = 0; d < radius; d++) {
    const next: number[] = [];
    for (const c of edge) for (const t of touching(shape, c)) if (!seen.has(t)) { seen.add(t); next.push(t); }
    edge = next;
  }
  seen.delete(i);
  return [...seen];
}

/** presses in `solution` whose whole footprint is lit on `cells` */
export function readableIn(shape: Shape, cells: Cells, solution: readonly number[]): number {
  let n = 0;
  for (const p of solution) if (pressTargets(shape, p).every((t) => cells[t])) n++;
  return n;
}

/**
 * A board whose fewest-presses solution is exactly `par`, built from presses in clusters: each press lands within two
 * steps of one already made, and a new cluster starts only when at least two presses remain for it, so no press
 * stands alone. Keeps trying until no more than `readable` presses can be read off the board; out of tries, returns
 * the closest board found (par nearest below the target, then fewest readable).
 */
export function tangle(shape: Shape, par: number, rng: Rng, solver: SolverService, opts: TangleOptions = {}): Made {
  const maxReadable = opts.readable ?? 0;
  const maxTries = opts.maxTries ?? 4000;
  const vars = cellIndexes(shape).filter((g) => isPressable(shape, g));
  if (!vars.length) throw new Error('This board has nothing to press');
  const around = new Map<number, number[]>();
  const nearOf = (g: number) => {
    let a = around.get(g);
    if (!a) { a = near(shape, g, 2).filter((x) => isPressable(shape, x)); around.set(g, a); }
    return a;
  };
  let best: Made | null = null;
  let fallback: Made | null = null;
  const better = (m: Made) => !best || m.par > best.par || (m.par === best.par && m.readable < best.readable);
  for (let t = 1; t <= maxTries; t++) {
    const chosen: number[] = [];
    const taken = new Set<number>();
    let cluster: number[] = [];
    const add = (g: number) => { chosen.push(g); taken.add(g); cluster.push(g); };
    add(vars[rng.int(vars.length)]!);
    while (chosen.length < par) {
      const left = par - chosen.length;
      // a cluster of three or more may end; the next starts anywhere, if at least two presses remain for it
      if (cluster.length >= 3 && left >= 2 && rng.int(3) === 0) {
        const fresh = vars.filter((g) => !taken.has(g));
        if (!fresh.length) break;
        cluster = [];
        add(fresh[rng.int(fresh.length)]!);
        continue;
      }
      const from = cluster[rng.int(cluster.length)]!;
      const options = nearOf(from).filter((g) => !taken.has(g));
      if (!options.length) {
        const any = vars.filter((g) => !taken.has(g));
        if (!any.length) break;
        add(any[rng.int(any.length)]!);
        continue;
      }
      add(options[rng.int(options.length)]!);
    }
    let cells = emptyCells(shape);
    for (const g of chosen) cells = solver.press(cells, g, shape);
    if (!cells.some(Boolean)) continue;
    if (opts.seen?.has(boardKey(cells))) continue;
    const solution = solver.solve(cells, shape);
    if (!solution) throw new Error('The solver couldn\'t solve a board built from presses');
    const made: Made = { cells, par: solution.length, readable: readableIn(shape, cells, solution), tries: t };
    if (made.par > par) continue;
    // a board a plain chase clears is kept only as a last resort
    if (opts.needsFix && chaseClears(shape, cells, solver)) {
      if (!fallback || made.par > fallback.par) fallback = made;
      continue;
    }
    if (made.par === par && made.readable <= maxReadable) return made;
    if (better(made)) best = made;
  }
  best ??= fallback;
  if (!best) throw new Error(`Couldn't make a board needing ${par} presses`);
  return { ...best, tries: maxTries };
}

/**
 * `count` stuck cells, spread out: never two touching, never on the board's edge when the board is big enough
 * (a stuck cell in the open asks more of the player than one tucked into a corner).
 */
export function stuckCells(shape: Shape, count: number, rng: Rng): number[] {
  const cells = cellIndexes(shape);
  const inner = cells.filter((g) => touching(shape, g).length >= 4);
  const pool = inner.length >= count * 3 ? inner : cells;
  for (let attempt = 0; attempt < 200; attempt++) {
    const out: number[] = [];
    const left = [...pool];
    while (out.length < count && left.length) {
      const g = left.splice(rng.int(left.length), 1)[0]!;
      if (out.some((s) => s === g || touching(shape, s).includes(g))) continue;
      out.push(g);
    }
    if (out.length === count) return out.sort((a, b) => a - b);
  }
  throw new Error(`Couldn't place ${count} stuck cells apart from each other`);
}

/**
 * Wiring patterns a switch can have (lib/shape.ts WIRE_DIRS bits: 0 up, then clockwise). The first few are the
 * gentle ones (lines and the plus); later levels draw from all of them.
 */
export const WIRINGS = Object.freeze({
  plus: 0b01010101,
  cross: 0b10101010,
  across: 0b01000100,
  updown: 0b00010001,
  slash: 0b00100010,
  backslash: 0b10001000,
  teeUp: 0b01000101,
  teeRight: 0b00010101,
  teeDown: 0b01010100,
  teeLeft: 0b01010001,
  cornerUpRight: 0b00000101,
  cornerDownRight: 0b00010100,
  cornerDownLeft: 0b01010000,
  cornerUpLeft: 0b01000001,
});
export type WiringName = keyof typeof WIRINGS;
const GENTLE: WiringName[] = ['plus', 'cross', 'across', 'updown'];
const ALL = Object.keys(WIRINGS) as WiringName[];

/**
 * One wiring per grid position (gaps get 0). A level uses only a few patterns (`kinds`), so the player can learn
 * them; `gentle` keeps to lines, the plus and the cross.
 */
export function wiring(shape: Shape, rng: Rng, kinds: number, gentle: boolean): number[] {
  const pool = [...(gentle ? GENTLE : ALL)];
  const pick: number[] = [];
  while (pick.length < Math.min(kinds, pool.length)) pick.push(WIRINGS[pool.splice(rng.int(pool.length), 1)[0]!]);
  const real = new Set(cellIndexes(shape));
  return Array.from({ length: gridSize(shape) }, (_, g) => (real.has(g) ? pick[rng.int(pick.length)]! : 0));
}
