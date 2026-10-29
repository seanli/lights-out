// Deterministic level generation and chapter checks. Pure: everything comes in as arguments.
import { type Cells, type Chapter, type LevelDef, type Rng, type Shape, type SolverService } from '../../contracts';
import { chaseClears, chaseable, makePuzzle, type Made } from '../../lib/puzzle';
import { cellIndexes, emptyCells, shapeOf } from '../../lib/shape';
import type { SymmetryName } from '../../lib/symmetry';

export interface LevelsRules {
  pars: number[];
  maxTries: number;
  chapters: { id: string; from: number; to: number }[];
}

/** the symmetries levels are made with (rules.json → levels.looks) */
export interface Looks {
  /** a level's first choice takes turns along this list by the level's position; the rest of the list follows */
  levels: readonly SymmetryName[];
  /** a boss's order, the most symmetric first; after its own list a level falls back on this one */
  boss: readonly SymmetryName[];
  /** tries per symmetry before moving on to the next */
  tries: number;
}

/** the symmetries to try for a level, in order (names a board doesn't have are skipped by the caller) */
export function looksFor(looks: Looks, index: number, boss: boolean): SymmetryName[] {
  if (boss) return [...looks.boss];
  const k = (index - 1) % looks.levels.length;
  return [...new Set([...looks.levels.slice(k), ...looks.levels.slice(0, k), ...looks.boss])];
}

/** a hand-made board (a picture, or every light on): its par is whatever the solver says */
function pictureLevel(cells: Cells, shape: Shape | undefined, solver: SolverService, id: number): { cells: Cells; par: number } {
  const solution = solver.solve(cells, shape);
  if (!solution) throw new Error(`Level ${id}'s picture can't be solved: no presses turn it off`);
  return { cells, par: solution.length };
}

/** where a pack's levels go: ids idBase + 1.., and the shape (absent = classic, generated exactly as before packs existed) */
export interface PackPlan {
  idBase: number;
  shape?: Shape;
  /** stamped on every LevelDef (absent for classic) */
  pack?: string;
  /** every Nth level (by position in the pack) is stamped `boss: true` */
  bossEvery?: number;
  /** from this level (by position) on, a plain chase never clears a board: each needs a fix from the top edge */
  fixFrom?: number;
  /** symmetric boards from level `looksFrom` (by position) on; earlier levels keep their random presses */
  looks?: Looks;
  looksFrom?: number;
  /** hand-made boards by position */
  pictures?: ReadonlyMap<number, Cells>;
}

export interface Generated {
  list: LevelDef[];
  /** tries spent per level, in order */
  tries: number[];
  /** levels whose par came out lower than the data asked for */
  missed: { id: number; wanted: number; got: number }[];
}

/** the pars of a list of bands, in level order: each band's nine, then its boss */
export const parsOf = (bands: readonly { pars: readonly number[]; boss: number }[]): number[] => bands.flatMap((b) => [...b.pars, b.boss]);

const key = (cells: Cells) => cells.map((on) => (on ? '1' : '0')).join('');

/**
 * For each target par k: a picture if the plan has one there; else, from `looksFrom` on, a symmetric board (looksFor,
 * lib/puzzle.ts symmetric); else press k distinct random cells on an empty board and keep the board when its
 * fewest-presses solution is exactly k and no earlier level has the same board.
 * Out of tries → keep the closest new board found (highest par below k) and report it in `missed`.
 */
export function generateLevels(
  rules: Pick<LevelsRules, 'pars' | 'maxTries'>,
  rng: Rng,
  solver: SolverService,
  plan: PackPlan = { idBase: 0 },
): Generated {
  const { shape, pack, idBase, bossEvery, fixFrom, looks, looksFrom = 1, pictures } = plan;
  const empty: Cells = emptyCells(shapeOf(shape));
  const seen = new Set<string>();
  const list: LevelDef[] = [];
  const tries: number[] = [];
  const missed: Generated['missed'] = [];
  // only real cells can be pressed; for the classic board this is 0..24, as it always was
  const order = cellIndexes(shapeOf(shape));
  const CELLS = order.length;

  rules.pars.forEach((wanted, n) => {
    const id = idBase + n + 1;
    let best: { cells: Cells; par: number } | null = null;
    /** the closest board a plain chase clears: kept only if nothing else turns up */
    let fallback: { cells: Cells; par: number } | null = null;
    let t = 0;
    const picture = pictures?.get(n + 1);
    const boss = !!bossEvery && (n + 1) % bossEvery === 0;
    const needsFix = fixFrom !== undefined && n + 1 >= fixFrom;
    if (picture) best = pictureLevel(picture, shape, solver, id);
    else if (looks && n + 1 >= looksFrom) {
      // classic never limited readable presses
      const made = makePuzzle({ base: shapeOf(shape), par: wanted, looks: looksFor(looks, n + 1, boss), looksTries: looks.tries, readable: Infinity, maxTries: rules.maxTries, seen, needsFix: () => needsFix }, rng, solver);
      t = made.tries;
      best = made;
    }
    // a picture or a symmetric board is the level; otherwise random presses, as before symmetric levels existed
    const done = best !== null;
    while (!done && t < rules.maxTries) {
      t++;
      // partial Fisher-Yates: the first k entries of `order` become k distinct cells
      let cells = empty;
      for (let i = 0; i < wanted && i < CELLS; i++) {
        const j = i + rng.int(CELLS - i);
        [order[i], order[j]] = [order[j]!, order[i]!];
        cells = solver.press(cells, order[i]!, shape);
      }
      const solution = solver.solve(cells, shape);
      if (!solution) throw new Error(`The solver couldn't solve a board built from presses (level ${id})`);
      const par = solution.length;
      if (par === 0 || seen.has(key(cells))) continue;
      if (needsFix && chaseClears(shapeOf(shape), cells, solver)) {
        if (!fallback || par > fallback.par) fallback = { cells, par };
        continue;
      }
      if (!best || par > best.par) best = { cells, par };
      if (par === wanted) break;
    }
    best ??= fallback;
    if (!best) throw new Error(`Couldn't find a new board for level ${id} (par ${wanted}) in ${rules.maxTries} tries`);
    if (best.par !== wanted && !picture) missed.push({ id, wanted, got: best.par });
    seen.add(key(best.cells));
    const bossMark = boss ? { boss: true as const } : {};
    const cells = [...best.cells];
    list.push(pack === undefined ? { id, cells, par: best.par, ...bossMark } : { id, cells, par: best.par, pack, index: n + 1, ...(shape ? { shape } : {}), ...bossMark });
    tries.push(t);
  });
  return { list, tries, missed };
}

/** a band of ten as data: nine pars, the boss's par, and the band's twist settings */
export interface RoomBand {
  pars: readonly number[];
  boss: number;
  /** stuck cells on each level of the band (a stuck room) */
  stuck?: number;
  /** wiring patterns per level, and whether to keep to the gentle ones (a wired room) */
  kinds?: number;
  gentle?: boolean;
}

export interface RoomPlan {
  idBase: number;
  pack: string;
  /** the board every level starts from; stuck cells and wiring are added per level */
  shape: Shape;
  twist?: 'stuck' | 'wired';
  bands: readonly RoomBand[];
  /** presses a player may read straight off the board (whole footprint lit) */
  readable: number;
  maxTries: number;
  /** from this level (by position) on, a chase room's boards each need a fix from the top edge (never a chase alone) */
  fixFrom?: number;
  /** symmetric boards (and symmetric stuck cells or wiring); absent = tangled boards only */
  looks?: Looks;
  /** hand-made boards by position (never in a stuck or wired room: each of its levels has its own shape) */
  pictures?: ReadonlyMap<number, Cells>;
}

/**
 * A Variety room: per level, a picture if the plan has one there; else a symmetric board (looksFor, with its stuck
 * cells or wiring placed to match when the room has a twist), or failing every symmetry, its own random stuck cells
 * or wiring and a tangled board (lib/puzzle.ts). Either way the fewest-presses solution is the band's par and no press
 * can be read off the board; from `fixFrom` on, on a board you chase, a plain chase doesn't clear it. Every 10th level
 * is the band's boss.
 */
export function generateRoom(plan: RoomPlan, rng: Rng, solver: SolverService): Generated {
  const seen = new Set<string>();
  const list: LevelDef[] = [];
  const tries: number[] = [];
  const missed: Generated['missed'] = [];
  plan.bands.forEach((band, b) => {
    [...band.pars, band.boss].forEach((wanted, k) => {
      const index = b * (band.pars.length + 1) + k + 1;
      const id = plan.idBase + index;
      const isBoss = k === band.pars.length;
      const picture = plan.pictures?.get(index);
      let made: Made & { shape: Shape };
      if (picture) made = { ...pictureLevel(picture, plan.shape, solver, id), readable: 0, tries: 0, shape: plan.shape };
      else {
        const twist = plan.twist === 'stuck' ? { stuck: band.stuck ?? 3 } : plan.twist === 'wired' ? { kinds: band.kinds ?? 4, gentle: band.gentle ?? false } : undefined;
        made = makePuzzle({
          base: plan.shape, par: wanted, ...(twist ? { twist } : {}),
          looks: plan.looks ? looksFor(plan.looks, index, isBoss) : [], looksTries: plan.looks?.tries ?? 0,
          readable: plan.readable, maxTries: plan.maxTries, seen,
          needsFix: (s) => plan.fixFrom !== undefined && index >= plan.fixFrom && chaseable(s),
        }, rng, solver);
        if (made.par !== wanted || made.readable > plan.readable) missed.push({ id, wanted, got: made.par });
      }
      const shape = made.shape;
      seen.add(made.cells.map((on) => (on ? '1' : '0')).join(''));
      const boss = isBoss ? { boss: true as const } : {};
      list.push({ id, cells: [...made.cells], par: made.par, pack: plan.pack, index, shape, ...boss });
      tries.push(made.tries);
    });
  });
  return { list, tries, missed };
}

/** Chapters must cover 1..count with no gaps or overlaps, and each needs a name. Returns them named, or throws. */
export function checkChapters(chapters: LevelsRules['chapters'], names: Record<string, string>, count: number): Chapter[] {
  const sorted = [...chapters].sort((a, b) => a.from - b.from);
  let next = 1;
  for (const c of sorted) {
    if (c.to < c.from) throw new Error(`Chapter "${c.id}" ends (level ${c.to}) before it starts (level ${c.from})`);
    if (c.from > next) throw new Error(`No chapter covers level${c.from - 1 > next ? `s ${next}–${c.from - 1}` : ` ${next}`}`);
    if (c.from < next) throw new Error(`Chapter "${c.id}" starts at level ${c.from}, which an earlier chapter already covers`);
    if (!names[c.id]) throw new Error(`Chapter "${c.id}" has no name in copy.json → levels.chapters`);
    next = c.to + 1;
  }
  if (next - 1 > count) throw new Error(`The chapters run to level ${next - 1}, but there are only ${count} levels`);
  if (next - 1 < count) throw new Error(`No chapter covers level${count > next ? `s ${next}–${count}` : ` ${next}`}`);
  return sorted.map((c) => ({ id: c.id, name: names[c.id]!, from: c.from, to: c.to }));
}
