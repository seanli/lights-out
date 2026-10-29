// Board guides: one per room (`guide-<room id>`), built at runtime from the room's real shape and the solver.
// Which steps a guide has follows from the room's kind and the maths, never from a table:
//   chase:  a full rectangle where a chase clears every solvable board (none today: 4×4 was dropped)
//   lights: a full rectangle where each lone bottom light has its own top lights to tap (7×7, 8×8, the Tower)
//   shapes: any other square grid (Ring, Diamond): tap shapes, then chase, tap the top-edge fix and chase again
//   hex, cube, wired, stuck (the twist rooms, by pack kind): how a tap spreads there, the one idea, practice
// Levels are tangled (lib/puzzle.ts, decision 56): no tap of the shortest answer shows whole at the start, so a whole
// shape there is a trap. Guides teach what works on such boards (chase and fix; two taps side by side; working back),
// and twist and shaped guides practise on tangled boards too.
// Example boards come from a fixed-order search, so they always fit the shape; learn.test.ts proves each.
import type { Cells, Pack, Shape, SolverService } from '../../contracts';
import { cellIndexes, emptyCells, gridOf, isCell, isPressable, pressTargets, touching } from '../../lib/shape';
import { cellFace, cubeSide, FACES } from '../../lib/cube';
import { WIRINGS } from '../../lib/puzzle';
import type { Lesson, Phase, Step } from './lessons';
import { chaseShape, createFixer, isClear, pressAll, rectTopSets, touches, type Fixer } from './method';

type Solver = Pick<SolverService, 'press'>;
type Solving = Pick<SolverService, 'press' | 'solve'>;
/** the twist rooms: a guide of their own, picked by the room's kind (a stuck or wired room's pack is a plain grid) */
export type TwistKind = 'hex' | 'cube' | 'wired' | 'stuck';
export const TWISTS: readonly TwistKind[] = ['hex', 'cube', 'wired', 'stuck'];
const isTwist = (kind: string | undefined): kind is TwistKind => (TWISTS as readonly string[]).includes(kind ?? '');
export type GuideKind = 'chase' | 'lights' | 'shapes' | TwistKind;
/** steps per kind: copy.json → learn.guides.<room>.steps has exactly this many sentences */
export const GUIDE_STEPS: Record<GuideKind, number> = { chase: 3, lights: 4, shapes: 4, hex: 4, cube: 4, wired: 4, stuck: 4 };
export const GUIDE_PREFIX = 'guide-';
export const guideId = (pack: string): string => `${GUIDE_PREFIX}${pack}`;

const isRect = (s: Shape) => !s.mask || s.mask.every(Boolean);
const asRect = (s: Shape) => ({ cols: s.cols, rows: s.rows, mask: null as null });

type GuidePack = Pick<Pack, 'id' | 'shape'> & { kind?: Pack['kind'] };

export function guideKind(solver: Solver, pack: Pick<GuidePack, 'kind' | 'shape'>): GuideKind {
  if (isTwist(pack.kind)) return pack.kind;
  const shape = pack.shape;
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

  // 1. three real tap shapes on this board
  const examples = footprintExamples(shape);

  // 2–3. a board whose chase leaves lights with nothing below them: chase, tap the one start cell that fixes what's
  //      left, chase again (taps that overlap, as in levels, and no whole shape to spot)
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
  // what the chase leaves: step 3 starts from it
  const left = cellIndexes(shape).filter((i) => pressAll(solver, pressAll(solver, dark, stuck ?? [], shape), p.c1, shape)[i]);
  return [
    { kind: 'show', boards: examples.map((e) => ({ from: [e.cell], marks: 'taps' as const, caption: e.kind })) },
    // 2. chase down until only lights with nothing below are left
    { ...demo(stuck ?? [], p.c1, p.c1.map(() => 'chase' as const)), end: 'stuckShape' },
    // 3. the top-edge light that fixes them, then chase again
    demo([], [...p.fix, ...p.c2], [...p.fix.map(() => 'edge' as const), ...p.c2.map(() => 'chase2' as const)], left),
    { kind: 'practice' },
  ];
}

// ---------- the twist rooms ----------

/** where a light sits, in light widths (a honeycomb's odd rows half a light right, its rows closer) */
function spot2d(shape: Shape, i: number): [number, number] {
  const r = Math.floor(i / shape.cols), c = i % shape.cols;
  return gridOf(shape) === 'hex' ? [c + (r & 1) / 2, r * 0.866] : [c, r];
}
/** distance from the middle of the board's real cells */
function fromMiddle(shape: Shape) {
  const pts = cellIndexes(shape).map((i) => spot2d(shape, i));
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return (i: number) => { const [x, y] = spot2d(shape, i); return Math.hypot(x - mx, y - my); };
}
const shared = (shape: Shape, a: number, b: number) => pressTargets(shape, a).filter((t) => pressTargets(shape, b).includes(t));
/** the switches whose press flips light i: its own and every switch wired or touching it */
export const reachers = (shape: Shape, i: number): number[] => cellIndexes(shape).filter((j) => pressTargets(shape, j).includes(i));
/** a board's answer is exactly these taps (the shortest one, so the demo shows what a player would find) */
const answerIs = (solver: Solving, shape: Shape, taps: readonly number[]) =>
  solver.solve(pressAll(solver, emptyCells(shape), taps, shape), shape)?.join() === [...taps].sort((a, b) => a - b).join();

/**
 * Taps in the order a player spots them: next, the one whose pattern is most lit (a whole pattern first; where two
 * overlap, the one with the most showing, after which the other is whole); a tie goes to the smaller pattern.
 */
export function readOrder(solver: Solver, shape: Shape, cells: Cells, taps: readonly number[]): number[] {
  const left = [...taps];
  const out: number[] = [];
  let b = cells;
  while (left.length) {
    let k = 0, top = -Infinity;
    left.forEach((t, j) => {
      const f = pressTargets(shape, t);
      const score = f.filter((x) => b[x]).length / f.length - f.length / 1000;
      if (score > top) { top = score; k = j; }
    });
    const t = left.splice(k, 1)[0]!;
    out.push(t);
    b = solver.press(b, t, shape);
  }
  return out;
}
/** a shortest answer, in spotting order (Assist on the twist guides), or null when the board can't be solved */
export const spotOrder = (solver: Solving, shape: Shape, cells: Cells): number[] | null => {
  const answer = solver.solve(cells, shape);
  return answer ? readOrder(solver, shape, cells, answer) : null;
};

/** a show step's figure of one tap, captioned */
const tapFig = (cell: number, caption: string) => ({ from: [cell], marks: 'taps' as const, caption });
const spotDemo = (solver: Solver, shape: Shape, taps: readonly number[]) => {
  const play = readOrder(solver, shape, pressAll(solver, emptyCells(shape), taps, shape), taps);
  return demo([...taps], play, play.map(() => 'spot' as const));
};

/** two taps side by side (touching each other), near the middle, that are a board's whole shortest answer: tap one
 *  and the other shows whole (each tap flips the other's centre, so both centres start dark) */
function sideBySide(solver: Solving, shape: Shape, from: readonly number[], dist: (i: number) => number): [number, number] | null {
  // in one row reads plainest: an arc opening left, one opening right
  const row = (i: number) => Math.floor(i / shape.cols);
  return best(pairsOf(from, from), ([a, b]) =>
    (a < b && pressTargets(shape, a).includes(b) && answerIs(solver, shape, [a, b]) ? (row(a) === row(b) ? 0 : 100) + dist(a) + dist(b) : null));
}

/** Hex: a flower of seven (fewer at the edge); two flowers overlapping cancel where they share; two side by side */
function hexGuide(solver: Solving, shape: Shape): Step[] {
  const real = cellIndexes(shape);
  const size = (i: number) => pressTargets(shape, i).length;
  const dist = fromMiddle(shape);
  const near = (cells: number[]) => [...cells].sort((a, b) => dist(a) - dist(b) || a - b);
  const full = Math.max(...real.map(size));
  const flowers = near(real.filter((i) => size(i) === full));
  const edge = near(real.filter((i) => size(i) === Math.max(...real.map(size).filter((n) => n < full))))[0]!;
  // two flowers two apart, sharing two lights (each centre stays lit), near the middle
  const pair = best(pairsOf(flowers, flowers), ([a, b]) =>
    (a < b && shared(shape, a, b).length === 2 && !pressTargets(shape, a).includes(b) ? dist(a) + dist(b) : null))!;
  // as in levels: two flowers side by side leave two arcs of three, with both centres dark between them
  const side = sideBySide(solver, shape, flowers, dist) ?? pair;
  return [
    { kind: 'show', boards: [tapFig(flowers[0]!, 'hexMiddle'), tapFig(edge, 'hexEdge')] },
    { kind: 'show', boards: [{ from: pair, marks: 'taps', ring: shared(shape, pair[0], pair[1]), caption: 'hexCancel' }] },
    demo([...side], [...side], side.map(() => 'pair' as const)),
    { kind: 'practice' },
  ];
}

/** Cube: on the net, a face's middle flips a plain plus; a corner's plus bends onto two other faces; two side by side */
function cubeGuide(solver: Solving, shape: Shape): Step[] {
  const n = cubeSide(shape);
  const real = cellIndexes(shape);
  const faceOf = (i: number) => cellFace(n, i)!.face.id;
  const middleOf = (id: string) => { const f = FACES.find((x) => x.id === id)!; const m = Math.floor(n / 2); return (f.by * n + m) * shape.cols + f.bx * n + m; };
  const front = middleOf('front');
  // how far a tap's lights lie apart on the net (lights that touch on the cube but sit far apart unfolded)
  const scatter = (i: number) => pressTargets(shape, i).reduce((s, t) => s + Math.abs((t % shape.cols) - (i % shape.cols)) + Math.abs(Math.floor(t / shape.cols) - Math.floor(i / shape.cols)), 0);
  const corners = real.filter((i) => new Set(pressTargets(shape, i).map(faceOf)).size === 3);
  // a front-face corner (the face you look at in play), its plus bent across the seams; else the most scattered
  const corner = best(corners, (i) => (faceOf(i) === 'front' ? -scatter(i) : null)) ?? best(corners, (i) => -scatter(i))!;
  // two pluses side by side on the front face, as in levels: two arcs of three, both centres dark
  const onFront = real.filter((i) => faceOf(i) === 'front');
  const dist = (i: number) => Math.abs((i % shape.cols) - (front % shape.cols)) + Math.abs(Math.floor(i / shape.cols) - Math.floor(front / shape.cols));
  const side = sideBySide(solver, shape, onFront, dist) ?? [front, corner];
  return [
    { kind: 'show', boards: [tapFig(front, 'cubePlus')] },
    { kind: 'show', boards: [tapFig(corner, 'cubeCorner')] },
    demo([...side], [...side], side.map(() => 'pair' as const)),
    { kind: 'practice' },
  ];
}

/**
 * The Wired guide's board: the room's grid with a fixed wiring of the gentle patterns (plus, X, the two lines), as on a
 * room's first levels. On 5×5 and 6×6 this layout has one answer per board and a plus, an X and a line near the middle
 * (tested; searched over layouts of this form).
 */
export function guideWiring(shape: Shape): number[] {
  const kinds = [WIRINGS.plus, WIRINGS.cross, WIRINGS.across, WIRINGS.updown];
  return Array.from({ length: shape.cols * shape.rows }, (_, i) => {
    const r = Math.floor(i / shape.cols), c = i % shape.cols;
    return isCell(shape, i) ? kinds[(r + 2 * c + 3 * ((r * c) % 3)) % 4]! : 0;
  });
}
/** what a wiring looks like, for its caption (learn.captions) */
const WIRE_SHAPE: Record<number, string> = {
  [WIRINGS.plus]: 'plus', [WIRINGS.cross]: 'x', [WIRINGS.across]: 'line', [WIRINGS.updown]: 'line', [WIRINGS.slash]: 'line', [WIRINGS.backslash]: 'line',
  [WIRINGS.teeUp]: 't', [WIRINGS.teeRight]: 't', [WIRINGS.teeDown]: 't', [WIRINGS.teeLeft]: 't',
  [WIRINGS.cornerUpRight]: 'l', [WIRINGS.cornerDownRight]: 'l', [WIRINGS.cornerDownLeft]: 'l', [WIRINGS.cornerUpLeft]: 'l',
};

/** Wired: three switches and what each flips; for a lit light, the switches that reach it; work back from the lit lights */
function wiredGuide(solver: Solving, shape: Shape): Step[] {
  const real = cellIndexes(shape);
  const dist = fromMiddle(shape);
  const wires = shape.wires ?? [];
  const bits = (i: number) => wires[i] ?? 0;
  const spokes = (i: number) => bits(i).toString(2).replace(/0/g, '').length;
  // whole patterns (no spoke off the board), near the middle; one switch of each look, the plus first
  const whole = real.filter((i) => pressTargets(shape, i).length === spokes(i) + 1).sort((a, b) => dist(a) - dist(b) || a - b);
  const three = ['plus', 'x', 'line', 't', 'l'].flatMap((look) => whole.filter((j) => WIRE_SHAPE[bits(j)] === look).slice(0, 1)).slice(0, 3);
  // a light that three switches reach (its own and two others), near the middle
  const light = best(real, (i) => (reachers(shape, i).length === 3 ? dist(i) : null)) ?? real[0]!;
  // three overlapping taps the answer is exactly; each tap outlines the switches that reach the light it clears
  const middle = whole.slice(0, 9);
  const taps = best(triplesOf(middle, middle), ([a, b, c]) => {
    const overlap = [shared(shape, a, b), shared(shape, a, c), shared(shape, b, c)].filter((s) => s.length).length;
    return overlap >= 1 && answerIs(solver, shape, [a, b, c]) ? dist(a) + dist(b) + dist(c) - overlap : null;
  }) ?? [middle[0]!];
  const start = pressAll(solver, emptyCells(shape), taps, shape);
  const play = readOrder(solver, shape, start, taps);
  let b = start;
  const rings = play.map((t) => {
    // the lit light this tap clears that the fewest switches reach
    const lights = pressTargets(shape, t).filter((x) => b[x]);
    const anchor = best(lights, (x) => reachers(shape, x).length) ?? t;
    b = solver.press(b, t, shape);
    return reachers(shape, anchor);
  });
  return [
    { kind: 'show', boards: three.map((i) => tapFig(i, WIRE_SHAPE[bits(i)]!)) },
    { kind: 'show', boards: [{ from: [], lit: [light], ring: reachers(shape, light), caption: 'reach' }] },
    { ...demo([...taps], play, play.map(() => 'back' as const)), rings },
    { kind: 'practice' },
  ];
}

/** The Stuck guide's board: the room's grid with two stuck switches inside it, apart (levels add their own) */
export function guideStuck(shape: Shape): number[] {
  const inner = cellIndexes(shape).filter((i) => touching(shape, i).length >= 4);
  const at = (r: number, c: number) => Math.min(shape.rows - 2, Math.max(1, r)) * shape.cols + Math.min(shape.cols - 2, Math.max(1, c));
  const picks = [at(1, Math.floor(shape.cols / 2)), at(3, Math.floor(shape.cols / 2) - 2)].filter((i) => inner.includes(i));
  return [...new Set(picks)].filter((i, k, xs) => xs.slice(0, k).every((j) => !touching(shape, j).includes(i)));
}

/** Stuck: a neighbour's tap flips a plated light; chase as usual; a light over a plate stays, then the top-edge fix */
function stuckGuide(solver: Solver, shape: Shape, fx: Fixer): Step[] {
  const dark = emptyCells(shape);
  const stuck = shape.stuck ?? [];
  const pressable = cellIndexes(shape).filter((i) => isPressable(shape, i));
  const dist = fromMiddle(shape);
  // 1. a tap beside a plate: its light flips
  const s = stuck[0] ?? pressable[0]!;
  const beside = [s - 1, s + 1, s + shape.cols, s - shape.cols].find((i) => touching(shape, s).includes(i) && isPressable(shape, i)) ?? pressable[0]!;
  // 2. a chase that runs through a lit stuck light and clears the board: taps off the top edge (a chase makes exactly
  //    those again), one of them under a plate so its light gets chased; the taps' shapes overlap, so it reads as a chase
  const under = stuck.map((x) => x + shape.cols).filter((i) => isPressable(shape, i) && !fx.starts.includes(i));
  const rest = pressable.filter((i) => !fx.starts.includes(i) && !under.includes(i));
  const through = best(triplesOf(under, rest), ([a, b, c]) => {
    const overlap = [overlaps(shape, a, b), overlaps(shape, a, c), overlaps(shape, b, c)].filter(Boolean).length;
    if (overlap < 2 || !isClear(chaseShape(solver, pressAll(solver, dark, [a, b, c], shape), shape).cells)) return null;
    return dist(a) + dist(b) + dist(c);
  }) ?? under.slice(0, 1);
  // 3. a chase that leaves a light over a plate: tap the top-edge light that fixes it, then chase again. The second
  //    chase runs the whole board (23 taps at the least on 6×6), so: the shortest, then the fewest lights left
  const overScrew = (cells: Cells) => stuck.some((x) => x >= shape.cols && cells[x - shape.cols]);
  const plan = (t: readonly number[]) => {
    const c1 = chaseShape(solver, pressAll(solver, dark, t, shape), shape);
    const fix = isClear(c1.cells) ? null : fx.fixFor(c1.cells);
    if (!fix) return null;
    const c2 = chaseShape(solver, pressAll(solver, c1.cells, fix, shape), shape);
    return { c1: c1.taps, left: c1.cells, fix, c2: c2.taps };
  };
  const others = pressable.filter((i) => !fx.starts.includes(i));
  const round = best(triplesOf(fx.starts, others), (t) => {
    const p = plan(t);
    if (!p || p.fix.length !== 1 || p.c1.length < 2 || !overScrew(p.left)) return null;
    return (p.c1.length + p.c2.length) * 1000 + p.left.filter(Boolean).length * 100 + dist(t[1]) + dist(t[2]);
  }) ?? best(triplesOf(fx.starts, others), (t) => (plan(t) ? 0 : null));
  const p = round ? plan(round)! : { c1: [], fix: [], c2: [] };
  return [
    { kind: 'show', boards: [tapFig(beside, 'plate')] },
    demo(through, chaseShape(solver, pressAll(solver, dark, through, shape), shape).taps, through.map(() => 'chase' as const)),
    demo(round ?? [], [...p.c1, ...p.fix, ...p.c2], [...p.c1.map(() => 'chase' as const), ...p.fix.map(() => 'edge' as const), ...p.c2.map(() => 'chase2' as const)]),
    { kind: 'practice' },
  ];
}

/** a twist room's guide: its own board (stuck and wired rooms add the guide's stuck switches or wiring to the pack's grid) */
function twistGuide(solver: Solving, kind: TwistKind, base: Shape): { lesson: Lesson; fixer: Fixer | null } {
  const shape: Shape = kind === 'wired' ? { ...base, wires: guideWiring(base) } : kind === 'stuck' ? { ...base, stuck: guideStuck(base) } : base;
  const pool = cellIndexes(shape).filter((i) => isPressable(shape, i));
  if (kind === 'stuck') {
    const fixer = createFixer(solver, shape);
    return { fixer, lesson: { steps: stuckGuide(solver, shape, fixer), shape, assist: 'fix', coach: 'shape', pool } };
  }
  const steps = kind === 'hex' ? hexGuide(solver, shape) : kind === 'cube' ? cubeGuide(solver, shape) : wiredGuide(solver, shape);
  return { fixer: null, lesson: { steps, shape, assist: 'spot', pool, tangled: true } };
}

/** how many of the lowest rows a full rectangle's practice taps come from: the first chase stays short */
export const PRACTICE_ROWS = 3;

/**
 * a room's guide: its steps on the room's own shape, assist = chase + fix, a coach line by phase.
 * Full rectangles practise on taps from the lowest rows (a short first chase that still leaves a bottom row);
 * shaped rooms on tangled boards like their levels'. Twist rooms: twistGuide.
 */
export function buildGuide(solver: Solving, pack: GuidePack): { kind: GuideKind; lesson: Lesson; fixer: Fixer | null } {
  const shape = pack.shape;
  const kind = guideKind(solver, pack);
  if (isTwist(kind)) return { kind, ...twistGuide(solver, kind, shape) };
  const fixer = createFixer(solver, shape);
  const steps = kind === 'chase' ? chaseGuide(solver, shape, fixer) : kind === 'lights' ? lightsGuide(solver, shape, fixer) : shapesGuide(solver, shape, fixer);
  const low = cellIndexes(shape).filter((i) => i >= (shape.rows - PRACTICE_ROWS) * shape.cols);
  return {
    kind, fixer,
    lesson: {
      steps, shape, assist: 'fix', coach: kind === 'shapes' ? 'shape' : 'rect',
      pool: kind === 'lights' ? low : cellIndexes(shape), ...(kind === 'lights' ? { leftover: true } : {}),
      ...(kind === 'shapes' ? { tangled: true } : {}),
    },
  };
}
