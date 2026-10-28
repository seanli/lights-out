// Deterministic level generation and chapter checks. Pure: everything comes in as arguments.
import { CELL_COUNT, type Cells, type Chapter, type LevelDef, type Rng, type SolverService } from '../../contracts';

export interface LevelsRules {
  seed: number;
  pars: number[];
  maxTries: number;
  chapters: { id: string; from: number; to: number }[];
}

export interface Generated {
  list: LevelDef[];
  /** tries spent per level, in order */
  tries: number[];
  /** levels whose par came out lower than the data asked for */
  missed: { id: number; wanted: number; got: number }[];
}

const key = (cells: Cells) => cells.map((on) => (on ? '1' : '0')).join('');

/**
 * For each target par k: press k distinct random cells on an empty board and keep the board
 * when its fewest-presses solution is exactly k and no earlier level has the same board.
 * Out of tries → keep the closest new board found (highest par below k) and report it in `missed`.
 */
export function generateLevels(rules: LevelsRules, rng: Rng, solver: SolverService): Generated {
  const empty: Cells = Array(CELL_COUNT).fill(false);
  const seen = new Set<string>();
  const list: LevelDef[] = [];
  const tries: number[] = [];
  const missed: Generated['missed'] = [];
  const order = [...Array(CELL_COUNT).keys()];

  rules.pars.forEach((wanted, n) => {
    const id = n + 1;
    let best: { cells: Cells; par: number } | null = null;
    let t = 0;
    while (t < rules.maxTries) {
      t++;
      // partial Fisher-Yates: the first k entries of `order` become k distinct cells
      let cells = empty;
      for (let i = 0; i < wanted && i < CELL_COUNT; i++) {
        const j = i + rng.int(CELL_COUNT - i);
        [order[i], order[j]] = [order[j]!, order[i]!];
        cells = solver.press(cells, order[i]!);
      }
      const solution = solver.solve(cells);
      if (!solution) throw new Error(`The solver couldn't solve a board built from presses (level ${id})`);
      const par = solution.length;
      if (par === 0 || seen.has(key(cells))) continue;
      if (!best || par > best.par) best = { cells, par };
      if (par === wanted) break;
    }
    if (!best) throw new Error(`Couldn't find a new board for level ${id} (par ${wanted}) in ${rules.maxTries} tries`);
    if (best.par !== wanted) missed.push({ id, wanted, got: best.par });
    seen.add(key(best.cells));
    list.push({ id, cells: best.cells, par: best.par });
    tries.push(t);
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
