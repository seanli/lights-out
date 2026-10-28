// Deterministic level generation and chapter checks. Pure: everything comes in as arguments.
import { type Cells, type Chapter, type LevelDef, type Rng, type Shape, type SolverService } from '../../contracts';
import { stuckCells, tangle, wiring } from '../../lib/puzzle';
import { cellIndexes, emptyCells, shapeOf } from '../../lib/shape';

export interface LevelsRules {
  pars: number[];
  maxTries: number;
  chapters: { id: string; from: number; to: number }[];
}

/** where a pack's levels go: ids idBase + 1.., and the shape (absent = classic, generated exactly as before packs existed) */
export interface PackPlan {
  idBase: number;
  shape?: Shape;
  /** stamped on every LevelDef (absent for classic) */
  pack?: string;
  /** every Nth level (by position in the pack) is stamped `boss: true` */
  bossEvery?: number;
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
 * For each target par k: press k distinct random cells on an empty board and keep the board
 * when its fewest-presses solution is exactly k and no earlier level has the same board.
 * Out of tries → keep the closest new board found (highest par below k) and report it in `missed`.
 */
export function generateLevels(
  rules: Pick<LevelsRules, 'pars' | 'maxTries'>,
  rng: Rng,
  solver: SolverService,
  plan: PackPlan = { idBase: 0 },
): Generated {
  const { shape, pack, idBase, bossEvery } = plan;
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
    let t = 0;
    while (t < rules.maxTries) {
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
      if (!best || par > best.par) best = { cells, par };
      if (par === wanted) break;
    }
    if (!best) throw new Error(`Couldn't find a new board for level ${id} (par ${wanted}) in ${rules.maxTries} tries`);
    if (best.par !== wanted) missed.push({ id, wanted, got: best.par });
    seen.add(key(best.cells));
    const boss = bossEvery && (n + 1) % bossEvery === 0 ? { boss: true as const } : {};
    list.push(pack === undefined ? { id, cells: best.cells, par: best.par, ...boss } : { id, cells: best.cells, par: best.par, pack, index: n + 1, ...(shape ? { shape } : {}), ...boss });
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
}

/**
 * A Variety room: per level, its own stuck cells or wiring (when the room has a twist), then a tangled board
 * (lib/puzzle.ts) whose fewest-presses solution is the band's par and whose presses can't be read off the board.
 * Every 10th level is the band's boss.
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
      let shape: Shape = plan.shape;
      if (plan.twist === 'stuck') shape = { ...shape, stuck: stuckCells(shape, band.stuck ?? 3, rng) };
      if (plan.twist === 'wired') shape = { ...shape, wires: wiring(shape, rng, band.kinds ?? 4, band.gentle ?? false) };
      const made = tangle(shape, wanted, rng, solver, { readable: plan.readable, maxTries: plan.maxTries, seen });
      if (made.par !== wanted || made.readable > plan.readable) missed.push({ id, wanted, got: made.par });
      seen.add(made.cells.map((on) => (on ? '1' : '0')).join(''));
      const boss = k === band.pars.length ? { boss: true as const } : {};
      list.push({ id, cells: made.cells, par: made.par, pack: plan.pack, index, shape, ...boss });
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
