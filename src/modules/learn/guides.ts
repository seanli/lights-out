// Board guides: one per room (`guide-<room id>`), built at runtime from the room's real shape and the solver.
// Which steps a guide has follows from the maths, never from a table:
//   chase:  a full rectangle where a chase clears every solvable board (none today: 4×4 and 9×9 were dropped)
//   lights: a full rectangle where each lone bottom light has its own top lights to tap (5×6, 6×6, 7×7, 8×8, 10×10, Tower)
//   shapes: anything else (Cross, Ring, Diamond): spot tap shapes, or chase, then tap the top-edge fix and chase again
// Example boards come from a fixed-order search, so they always fit the shape; learn.test.ts proves each.
import type { Cells, Pack, Shape, SolverService } from '../../contracts';
import { cellIndexes, emptyCells, isCell, pressTargets } from '../../lib/shape';
import type { Lesson, Phase, Step } from './lessons';
import { chaseShape, createFixer, isClear, pressAll, rectTopSets, touches, type Fixer } from './method';

type Solver = Pick<SolverService, 'press'>;
export type GuideKind = 'chase' | 'lights' | 'shapes';
/** steps per kind: copy.json → learn.guides.<room>.steps has exactly this many sentences */
export const GUIDE_STEPS: Record<GuideKind, number> = { chase: 3, lights: 4, shapes: 5 };
export const GUIDE_PREFIX = 'guide-';
export const guideId = (pack: string): string => `${GUIDE_PREFIX}${pack}`;

const isRect = (s: Shape) => !s.mask || s.mask.every(Boolean);
const asRect = (s: Shape) => ({ cols: s.cols, rows: s.rows, mask: null as null });

export function guideKind(solver: Solver, shape: Shape): GuideKind {
  if (!isRect(shape)) return 'shapes';
  const { perLight, chaseClears } = rectTopSets(solver, asRect(shape));
  if (chaseClears) return 'chase';
  return perLight.every((set) => set !== null) ? 'lights' : 'shapes';
}

// ---------- tap shapes ----------

/** what one tap lights: a plus, or the plus cut short by the board's edges and holes */
export type Footprint = 'plus' | 't' | 'l' | 'line' | 'pair' | 'single';
const BY_SIZE: Footprint[] = ['plus', 't', 'l', 'line', 'pair', 'single'];

export function footprint(shape: Shape, i: number): Footprint {
  const t = pressTargets(shape, i);
  if (t.length === 5) return 'plus';
  if (t.length === 4) return 't';
  if (t.length === 2) return 'pair';
  if (t.length < 2) return 'single';
  const has = (j: number) => t.includes(j);
  return (has(i - 1) && has(i + 1)) || (has(i - shape.cols) && has(i + shape.cols)) ? 'line' : 'l';
}

/** in-grid neighbour positions that are gaps (a hole cuts the tap short there) */
const holes = (shape: Shape, i: number) => {
  const r = Math.floor(i / shape.cols), c = i % shape.cols;
  const around = [r > 0 ? i - shape.cols : -1, r < shape.rows - 1 ? i + shape.cols : -1, c > 0 ? i - 1 : -1, c < shape.cols - 1 ? i + 1 : -1];
  return around.filter((j) => j >= 0 && !isCell(shape, j)).length;
};

/** A plus, then the two smallest cut shapes this board has; each at a cell cut by a hole if possible, near the middle. */
export function footprintExamples(shape: Shape): { cell: number; kind: Footprint }[] {
  const cx = (shape.cols - 1) / 2, cy = (shape.rows - 1) / 2;
  const dist = (i: number) => Math.hypot((i % shape.cols) - cx, Math.floor(i / shape.cols) - cy);
  const order = cellIndexes(shape).sort((a, b) => holes(shape, b) - holes(shape, a) || dist(a) - dist(b) || a - b);
  const first = new Map<Footprint, number>();
  for (const i of order) if (!first.has(footprint(shape, i))) first.set(footprint(shape, i), i);
  const kinds = BY_SIZE.filter((k) => first.has(k));
  const pick = kinds[0] === 'plus' ? ['plus' as const, ...kinds.slice(1).slice(-2)] : kinds.slice(-3);
  return pick.map((kind) => ({ cell: first.get(kind)!, kind }));
}

/**
 * Spotting, the way a player does it: while some lit light's whole tap shape is lit, tap its centre,
 * smallest shapes first (tips and corners: few taps reach them). The taps, or null when it gets stuck.
 */
export function spot(solver: Solver, shape: Shape, cells: Cells, limit = 12): number[] | null {
  let b = cells;
  const taps: number[] = [];
  const real = cellIndexes(shape);
  while (!isClear(b)) {
    if (taps.length >= limit) return null;
    let best = -1;
    for (const i of real) {
      const t = pressTargets(shape, i);
      if (t.every((j) => b[j]) && (best < 0 || t.length < pressTargets(shape, best).length)) best = i;
    }
    if (best < 0) return null;
    b = solver.press(b, best, shape);
    taps.push(best);
  }
  return taps;
}

// ---------- example boards (fixed-order searches: the same shape always gives the same examples) ----------

/** the candidate with the lowest score (first wins a tie); null scores are skipped */
function best<T>(cands: Iterable<T>, score: (c: T) => number | null): T | null {
  let out: T | null = null, low = Infinity;
  for (const c of cands) {
    const s = score(c);
    if (s !== null && s < low) { low = s; out = c; }
  }
  return out;
}
function* pairsOf(a: readonly number[], b: readonly number[]) {
  for (const x of a) for (const y of b) if (x !== y) yield [x, y] as [number, number];
}
function* triplesOf(a: readonly number[], b: readonly number[]) {
  for (const x of a) for (let j = 0; j < b.length; j++) for (let k = j + 1; k < b.length; k++) {
    if (b[j] !== x && b[k] !== x) yield [x, b[j]!, b[k]!] as [number, number, number];
  }
}
/** how far taps sit from the board's middle (examples read best near the middle) */
const spread = (shape: Shape, taps: readonly number[]) => {
  const cx = (shape.cols - 1) / 2, cy = (shape.rows - 1) / 2;
  return taps.reduce((sum, i) => sum + Math.abs((i % shape.cols) - cx) + Math.abs(Math.floor(i / shape.cols) - cy) / 2, 0);
};
const overlaps = (shape: Shape, a: number, b: number) => pressTargets(shape, a).some((t) => pressTargets(shape, b).includes(t));

/** a demo step: build the board from `from`, play `play` with its phases */
const demo = (from: number[], play: number[], phases: (Phase | null)[], lit?: number[]): Extract<Step, { kind: 'demo' }> =>
  ({ kind: 'demo', from, play, phases, ...(lit ? { lit } : {}) });

/**
 * a board from one top-edge tap and two others (from the next three rows, which keeps the search small on 10×10)
 * whose chase is about `aim` taps long, leaving as little as possible
 */
function chaseBoard(solver: Solver, shape: Shape, fx: Fixer, aim: number, avoid?: string) {
  const dark = emptyCells(shape);
  const rest = cellIndexes(shape).filter((i) => !fx.starts.includes(i) && i < 4 * shape.cols);
  const pick = best(triplesOf(fx.starts, rest), (t) => {
    const board = pressAll(solver, dark, t, shape);
    if (board.join() === avoid) return null;
    const c = chaseShape(solver, board, shape);
    const n = c.taps.length;
    if (n < 3) return null;
    return Math.abs(n - aim) * 1000 + c.cells.filter(Boolean).length * 50 + spread(shape, t) * 4 + board.filter(Boolean).length;
  });
  if (!pick) throw new Error('No example board fits this shape');
  const board = pressAll(solver, dark, pick, shape);
  return { from: pick, board, chase: chaseShape(solver, board, shape) };
}

/** two bottom lights whose top taps share one light, ordered so that light isn't tapped twice in a row; near the middle.
 *  null when no two share a tap (straight above: 5×6, the Tower) */
function overlapPair(perLight: readonly number[][], cols: number): [number, number] | null {
  const cands: [number, number][] = [];
  for (let a = 0; a < cols; a++) for (let b = 0; b < cols; b++) if (a !== b) cands.push([a, b]);
  return best(cands, ([a, b]) => {
    const seq = [...perLight[a]!, ...perLight[b]!];
    const shared = perLight[a]!.filter((t) => perLight[b]!.includes(t)).length;
    if (shared === 0 || seq.some((t, k) => k > 0 && seq[k - 1] === t)) return null;
    return Math.abs((a + b) / 2 - (cols - 1) / 2) * 10 + shared;
  });
}

// ---------- the guides ----------

function chaseGuide(solver: Solver, shape: Shape, fx: Fixer): Step[] {
  const one = chaseBoard(solver, shape, fx, 5);
  const two = chaseBoard(solver, shape, fx, 8, one.board.join());
  const chasePhases = (n: number) => new Array<Phase>(n).fill('chase');
  return [
    demo(one.from, one.chase.taps, chasePhases(one.chase.taps.length)),
    demo(two.from, two.chase.taps, chasePhases(two.chase.taps.length)),
    { kind: 'practice' },
  ];
}

function lightsGuide(solver: Solver, shape: Shape, fx: Fixer): Step[] {
  const { cols, rows } = shape;
  const perLight = rectTopSets(solver, asRect(shape)).perLight as number[][];
  const one = chaseBoard(solver, shape, fx, 2 * rows - 2);
  const bottom = (c: number) => (rows - 1) * cols + c;
  const pick = Math.floor((cols - 1) / 2);
  // several bottom lights: each one's top taps in turn (a light tapped twice cancels), then chase again;
  // where no taps overlap, two lights with a gap between, either side of the middle
  const pair = overlapPair(perLight, cols) ?? (cols > 2 ? [pick - 1, pick + 1] : [pick]);
  const tops = pair.flatMap((c) => perLight[c]!);
  const lit = pair.map(bottom);
  const start = emptyCells(shape).map((_, i) => lit.includes(i));
  const again = chaseShape(solver, pressAll(solver, start, tops, shape), shape).taps;
  return [
    { ...demo(one.from, one.chase.taps, one.chase.taps.map(() => 'chase')), letters: true },
    { kind: 'lights', rows: perLight.map((top, c) => ({ bottom: bottom(c), top })), pick },
    { ...demo([], [...tops, ...again], [...tops.map(() => 'top' as const), ...again.map(() => 'chase2' as const)], lit), letters: true },
    { kind: 'practice' },
  ];
}

function shapesGuide(solver: Solver, shape: Shape, fx: Fixer): Step[] {
  const dark = emptyCells(shape);
  const real = cellIndexes(shape);
  const size = (i: number) => pressTargets(shape, i).length;

  // 1. three real tap shapes on this board
  const examples = footprintExamples(shape);

  // 2. a 3-tap board of different shapes, one at a tip or corner touching another; spotting clears it
  const smallest = Math.min(...real.map(size));
  const tips = real.filter((i) => size(i) === smallest);
  const spotted = best(triplesOf(tips, real), ([a, b, c]) => {
    if (overlaps(shape, a, b) || overlaps(shape, a, c) || overlaps(shape, b, c)) return null;
    if (new Set([footprint(shape, a), footprint(shape, b), footprint(shape, c)]).size < 3) return null;
    const touching = [touches(shape, a, b), touches(shape, a, c), touches(shape, b, c)];
    if (touching.filter(Boolean).length !== 1 || touching[2]) return null;
    const taps = spot(solver, shape, pressAll(solver, dark, [a, b, c], shape));
    return taps?.length === 3 ? spread(shape, [b, c]) : null;
  }) ?? best(pairsOf(tips, real), ([a, b]) => (!overlaps(shape, a, b) && spot(solver, shape, pressAll(solver, dark, [a, b], shape))?.length === 2 ? 0 : null));
  const spotFrom = spotted ?? [real[0]!];
  const spotTaps = spot(solver, shape, pressAll(solver, dark, spotFrom, shape)) ?? spotFrom;

  // 3. a board spotting can't finish: chase, tap the one start cell that fixes what's left, chase again
  const rest = real.filter((i) => !fx.starts.includes(i));
  const plan = (t: readonly number[]) => {
    const c1 = chaseShape(solver, pressAll(solver, dark, t, shape), shape);
    const fix = isClear(c1.cells) ? null : fx.fixFor(c1.cells);
    if (!fix) return null;
    const c2 = chaseShape(solver, pressAll(solver, c1.cells, fix, shape), shape);
    return { c1: c1.taps, fix, c2: c2.taps };
  };
  const stuck = best(triplesOf(fx.starts, rest), (t) => {
    if (!overlaps(shape, t[0], t[1])) return null;
    const p = plan(t);
    if (!p || p.fix.length !== 1 || p.c1.length < 3) return null;
    const total = p.c1.length + 1 + p.c2.length;
    if (total > 18 || spot(solver, shape, pressAll(solver, dark, t, shape)) !== null) return null;
    return Math.abs(total - 15) * 100 + spread(shape, t);
  }) ?? best(triplesOf(fx.starts, rest), (t) => (plan(t) ? 0 : null));
  const p = stuck ? plan(stuck)! : { c1: [], fix: [], c2: [] };
  // what the chase leaves: step 4 starts from it
  const left = cellIndexes(shape).filter((i) => pressAll(solver, pressAll(solver, dark, stuck ?? [], shape), p.c1, shape)[i]);
  return [
    { kind: 'show', boards: examples.map((e) => ({ from: [e.cell], marks: 'taps' as const, caption: e.kind })) },
    demo(spotFrom, spotTaps, spotTaps.map(() => 'spot' as const)),
    // 3. stuck: chase down until only lights with nothing below are left
    { ...demo(stuck ?? [], p.c1, p.c1.map(() => 'chase' as const)), end: 'stuckShape' },
    // 4. the top-edge light that fixes them, then chase again
    demo([], [...p.fix, ...p.c2], [...p.fix.map(() => 'edge' as const), ...p.c2.map(() => 'chase2' as const)], left),
    { kind: 'practice' },
  ];
}

/** how many of the lowest rows a full rectangle's practice taps come from: the first chase stays short */
export const PRACTICE_ROWS = 3;

/**
 * a room's guide: its steps on the room's own shape, assist = chase + fix, a coach line by phase.
 * Full rectangles practise on taps from the lowest rows (a short first chase that still leaves a bottom row);
 * shaped rooms from any cell, so spotting shapes stays worth trying.
 */
export function buildGuide(solver: Solver, pack: Pick<Pack, 'id' | 'shape'>): { kind: GuideKind; lesson: Lesson; fixer: Fixer } {
  const shape = pack.shape;
  const kind = guideKind(solver, shape);
  const fixer = createFixer(solver, shape);
  const steps = kind === 'chase' ? chaseGuide(solver, shape, fixer) : kind === 'lights' ? lightsGuide(solver, shape, fixer) : shapesGuide(solver, shape, fixer);
  const low = cellIndexes(shape).filter((i) => i >= (shape.rows - PRACTICE_ROWS) * shape.cols);
  return {
    kind, fixer,
    lesson: {
      steps, shape, assist: 'fix', coach: kind === 'shapes' ? 'shape' : 'rect',
      pool: kind === 'lights' ? low : cellIndexes(shape), ...(kind === 'lights' ? { leftover: true } : {}),
    },
  };
}
