// Making puzzles for any board: presses that tangle (each lands near another, so their footprints overlap and no
// press shows as a whole shape you can read off the board), symmetric boards (presses in whole orbits of a mirror or
// turn), stuck cells, and per-cell wiring. Pure: the solver and a random source come in as arguments. Shared by the
// levels module (fixed seeds) and the custom module.
import type { Cells, Rng, Shape, SolverService } from '../contracts';
import { cellCount, cellIndexes, emptyCells, gridOf, gridSize, isCell, isPressable, pressTargets, touching } from './shape';
import { isPinwheel, orbits, symmetryNamed, type Symmetry, type SymmetryName } from './symmetry';

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
    // no level may show a pinwheel (lib/symmetry.ts isPinwheel)
    if (opts.needsFix && chaseClears(shape, cells, solver)) {
      if ((!fallback || made.par > fallback.par) && !isPinwheel(shape, cells)) fallback = made;
      continue;
    }
    if (made.par === par && made.readable <= maxReadable) {
      if (!isPinwheel(shape, cells)) return made;
      continue;
    }
    if (better(made) && !isPinwheel(shape, cells)) best = made;
  }
  best ??= fallback;
  if (!best) throw new Error(`Couldn't make a board needing ${par} presses`);
  return { ...best, tries: maxTries };
}

/**
 * per symmetry: the orbits of the pressable cells, for each orbit the orbits within two steps of it, and what pressing
 * a whole orbit toggles (cells its presses reach an odd number of times)
 */
interface OrbitTable { orbs: number[][]; nearby: number[][]; flips: number[][] }
const orbitCache = new WeakMap<Symmetry, WeakMap<Shape, OrbitTable>>();
function orbitsFor(shape: Shape, sym: Symmetry): OrbitTable {
  let per = orbitCache.get(sym);
  if (!per) { per = new WeakMap(); orbitCache.set(sym, per); }
  const hit = per.get(shape);
  if (hit) return hit;
  const orbs = orbits(sym, cellIndexes(shape).filter((g) => isPressable(shape, g)));
  const orbitOf = new Map<number, number>();
  orbs.forEach((o, k) => { for (const g of o) orbitOf.set(g, k); });
  const nearby = orbs.map((o, k) => [...new Set(o.flatMap((g) => near(shape, g, 2)).map((g) => orbitOf.get(g)).filter((x): x is number => x !== undefined && x !== k))]);
  const flips = orbs.map((o) => {
    const odd = new Set<number>();
    for (const g of o) for (const x of pressTargets(shape, g)) if (!odd.delete(x)) odd.add(x);
    return [...odd];
  });
  const made = { orbs, nearby, flips };
  per.set(shape, made);
  return made;
}

/** a copy of the list in a random order */
export function shuffled<T>(list: readonly T[], rng: Rng): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** how good a board looks: lights joined into shapes rather than scattered dots, and about half the board lit */
export function looks(shape: Shape, cells: Cells): number {
  const lit = cellIndexes(shape).filter((i) => cells[i]);
  if (!lit.length) return -Infinity;
  const joined = lit.filter((i) => touching(shape, i).some((j) => cells[j])).length / lit.length;
  return joined - Math.abs(lit.length / cellCount(shape) - 0.45);
}

export interface SymmetricOptions extends TangleOptions {
  /** boards that pass every rule to compare before keeping the best-looking one (default 3) */
  pick?: number;
}

/**
 * A board with the symmetry's pattern: presses chosen in whole orbits (a press together with every press the
 * symmetry makes of it), so the lights show the same symmetry. Its fewest-presses solution is exactly `par`, no more
 * than `readable` presses can be read off the board, with `needsFix` a plain chase doesn't clear it, and it is never a
 * pinwheel. Of the first few such boards, keeps the best-looking (`looks`). Null when none turns up: the caller tries
 * another symmetry.
 */
export function symmetric(shape: Shape, par: number, sym: Symmetry, rng: Rng, solver: SolverService, opts: SymmetricOptions = {}): Made | null {
  const maxReadable = opts.readable ?? 0;
  const maxTries = opts.maxTries ?? 1000;
  const pick = opts.pick ?? 3;
  const { orbs, nearby, flips } = orbitsFor(shape, sym);
  // press counts the orbits can add up to: aim at par, now and then a little past it (where presses can cancel out,
  // the fewest that clear a board may be fewer); none reachable → this symmetry can't make the board
  const reach = [true];
  for (const o of orbs) for (let n = par + 2; n >= o.length; n--) if (reach[n - o.length]) reach[n] = true;
  const past = [par + 1, par + 2].filter((n) => reach[n]);
  if (!reach[par] && !past.length) return null;
  const taken = new Uint8Array(orbs.length);
  const close: number[] = [];
  const options: number[] = [];
  const found: Made[] = [];
  const keys = new Set<string>();
  // give up early on what isn't working: aiming past par when presses never cancel out (no board on this grid has a
  // shorter way), or orbits so few that every new try repeats an old board
  let pastSolved = 0, pastShorter = 0, stale = 0;
  let t = 0;
  while (t < maxTries && found.length < pick && stale < 60) {
    t++;
    const pastWorks = pastSolved < 12 || pastShorter > 0;
    if (!reach[par] && !pastWorks) break;
    const target = reach[par] && (!past.length || !pastWorks || rng.int(4) > 0) ? par : past[rng.int(past.length)]!;
    // orbits join a cluster near the ones already in it, until a cluster of two or more may end; the next starts anywhere
    taken.fill(0);
    close.length = 0;
    let count = 0, inCluster = 0;
    const fits = (j: number) => !taken[j] && orbs[j]!.length <= target - count;
    while (count < target) {
      let k = -1;
      if (inCluster > 0 && !(inCluster >= 2 && rng.int(3) === 0)) {
        options.length = 0;
        for (const j of close) if (fits(j)) options.push(j);
        if (options.length) k = options[rng.int(options.length)]!;
      }
      if (k < 0) {
        for (let a = 0; a < 8 && k < 0; a++) { const j = rng.int(orbs.length); if (fits(j)) k = j; }
        if (k < 0) {
          options.length = 0;
          for (let j = 0; j < orbs.length; j++) if (fits(j)) options.push(j);
          if (!options.length) break;
          k = options[rng.int(options.length)]!;
        }
        close.length = 0;
        inCluster = 0;
      }
      taken[k] = 1;
      inCluster++;
      close.push(...nearby[k]!);
      count += orbs[k]!.length;
    }
    if (count !== target) continue;
    const cells = emptyCells(shape);
    for (let k = 0; k < orbs.length; k++) if (taken[k]) for (const x of flips[k]!) cells[x] = !cells[x];
    const key = boardKey(cells);
    if (!cells.some(Boolean) || keys.has(key) || opts.seen?.has(key)) { stale++; continue; }
    stale = 0;
    keys.add(key);
    const solution = solver.solve(cells, shape);
    if (!solution) throw new Error('The solver couldn\'t solve a board built from presses');
    if (target > par) {
      pastSolved++;
      if (solution.length < target) pastShorter++;
    }
    if (solution.length !== par) continue;
    const readable = readableIn(shape, cells, solution);
    if (readable > maxReadable || (opts.needsFix && chaseClears(shape, cells, solver)) || isPinwheel(shape, cells)) continue;
    found.push({ cells, par, readable, tries: t });
  }
  let best: Made | null = null;
  for (const m of found) if (!best || looks(shape, m.cells) > looks(shape, best.cells)) best = m;
  return best && { ...best, tries: t };
}

/**
 * `count` stuck cells placed in whole orbits of the symmetry (so the board keeps it), spread out as stuckCells
 * spreads them. Null when no set of orbits adds up to `count`.
 */
export function symmetricStuck(shape: Shape, count: number, rng: Rng, sym: Symmetry): number[] | null {
  const cells = cellIndexes(shape);
  const inner = cells.filter((g) => touching(shape, g).length >= 4);
  const pool = new Set(inner.length >= count * 3 ? inner : cells);
  const apart = (a: readonly number[], b: readonly number[]) => a.every((x) => b.every((y) => x !== y && !touching(shape, x).includes(y)));
  const orbs = orbits(sym, [...pool]).filter((o) => o.every((g) => pool.has(g)) && o.every((g, k) => apart([g], o.slice(k + 1))));
  // no set of orbits adds up to count: don't try
  const reach = [true];
  for (const o of orbs) for (let n = count; n >= o.length; n--) if (reach[n - o.length]) reach[n] = true;
  if (!reach[count]) return null;
  for (let attempt = 0; attempt < 200; attempt++) {
    const out: number[] = [];
    for (const o of shuffled(orbs, rng)) {
      if (out.length + o.length <= count && apart(out, o)) out.push(...o);
      if (out.length === count) return out.sort((a, b) => a - b);
    }
  }
  return null;
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
 * them; `gentle` keeps to lines, the plus and the cross. With a symmetry (square grids), each orbit's switches carry
 * one pattern turned with the board (a tee pointing left mirrors into one pointing right), so the wiring keeps it.
 */
export function wiring(shape: Shape, rng: Rng, kinds: number, gentle: boolean, sym?: Symmetry): number[] {
  const pool = [...(gentle ? GENTLE : ALL)];
  const pick: number[] = [];
  while (pick.length < Math.min(kinds, pool.length)) pick.push(WIRINGS[pool.splice(rng.int(pool.length), 1)[0]!]);
  const real = cellIndexes(shape);
  if (!sym?.wires) {
    const set = new Set(real);
    return Array.from({ length: gridSize(shape) }, (_, g) => (set.has(g) ? pick[rng.int(pick.length)]! : 0));
  }
  const turn = sym.wires;
  const out = new Array<number>(gridSize(shape)).fill(0);
  for (const [rep] of orbits(sym, real)) {
    // a switch the symmetry carries onto itself needs a pattern that looks the same after it
    const still = sym.maps.flatMap((m, e) => (m[rep!] === rep ? [e] : []));
    const keeps = (p: number) => still.every((e) => turn[e]!(p) === p);
    const options = pick.filter(keeps);
    const p = options.length ? options[rng.int(options.length)]! : WIRINGS.plus;
    sym.maps.forEach((m, e) => { out[m[rep!]!] = turn[e]!(p); });
  }
  return out;
}

/** a puzzle to make: the board before its twist, the par, and the symmetries to try in order */
export interface PuzzleSpec {
  /** the board before its twist (stuck cells or wiring are placed per puzzle) */
  base: Shape;
  par: number;
  twist?: { stuck: number } | { kinds: number; gentle: boolean };
  /** symmetries to try, in order (names the board doesn't have are skipped); empty = a tangled board */
  looks: readonly SymmetryName[];
  /** tries per symmetry before the next */
  looksTries: number;
  /**
   * other pars a symmetric board may have when none has `par` (tried in order): on a board with no middle row or
   * column the mirrors only make even pars, so a custom puzzle takes one press more or less rather than giving up its
   * symmetry
   */
  orPars?: readonly number[];
  /** most presses readable straight off the board */
  readable: number;
  /** tries for the tangled board made when no symmetry works */
  maxTries: number;
  /** whether the finished board (twist included) must need a fix from the top edge */
  needsFix?: (shape: Shape) => boolean;
  /** boards already used */
  seen?: Set<string>;
}

export interface Puzzle extends Made {
  /** the board with its twist */
  shape: Shape;
  /** the symmetry the board was made with; null when it is a tangled board */
  symmetry: SymmetryName | null;
}

/**
 * Every puzzle in the game is made here: for each symmetry in turn, the twist placed to match (symmetricStuck, wiring)
 * and a symmetric board; failing all of them, the twist placed freely and a tangled board (closest par if not exact).
 */
export function makePuzzle(spec: PuzzleSpec, rng: Rng, solver: SolverService): Puzzle {
  const { base, par, twist } = spec;
  let spent = 0;
  for (const name of spec.looks) {
    const around = symmetryNamed(base, name);
    if (!around) continue;
    let shape = base;
    if (twist && 'stuck' in twist) {
      const stuck = symmetricStuck(base, twist.stuck, rng, around);
      if (!stuck) continue;
      shape = { ...base, stuck };
    } else if (twist) shape = { ...base, wires: wiring(base, rng, twist.kinds, twist.gentle, around) };
    const sym = symmetryNamed(shape, name);
    if (!sym) continue;
    for (const p of [par, ...(spec.orPars ?? [])]) {
      const made = symmetric(shape, p, sym, rng, solver, { readable: spec.readable, maxTries: spec.looksTries, ...(spec.seen ? { seen: spec.seen } : {}), needsFix: spec.needsFix?.(shape) ?? false });
      spent += made?.tries ?? spec.looksTries;
      if (made) return { ...made, tries: spent, shape, symmetry: name };
    }
  }
  let shape = base;
  if (twist && 'stuck' in twist) shape = { ...base, stuck: stuckCells(base, twist.stuck, rng) };
  else if (twist) shape = { ...base, wires: wiring(base, rng, twist.kinds, twist.gentle) };
  const made = tangle(shape, par, rng, solver, { readable: spec.readable, maxTries: spec.maxTries, ...(spec.seen ? { seen: spec.seen } : {}), needsFix: spec.needsFix?.(shape) ?? false });
  return { ...made, tries: spent + made.tries, shape, symmetry: null };
}
