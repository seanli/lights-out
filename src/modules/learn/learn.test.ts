// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import { CUSTOM_LEVEL_ID, type Cells, type LevelDef, type LevelsState, type Pack, type Shape, type SolverService } from '../../contracts';
import { createMemoryStorage, bootModule, fixtureData } from '../../../test/fake-ctx';
import { refPress, refSolve } from '../../../test/ref-solver';
import { cellIndexes, emptyCells, fitsShape, hexagonShape, isPressable, isStuck, parseShape, pressTargets, touching } from '../../lib/shape';
import { cellFace, cubeShape } from '../../lib/cube';
import { WIRINGS, readableIn } from '../../lib/puzzle';
import learn from './index';
import { BOTTOM, blank, bottomColumns, bottomRowTable, chase, chaseRect, chaseShape, chaseSuggest, clearsBottom, createFixer, echoOf, echoOfSet, echoRows, endCells, fixFor, fixSuggest, isClear, lit, methodTaps, onlyBottom, onlyEnds, pressAll, quietPatterns, rectRule, rectTaps, rectTopSets, startCells } from './method';
import { RULES, type Step } from './lessons';
import { GUIDE_STEPS, buildGuide, footprint, guideKind, guideStuck, guideWiring, reachers, spot, spotOrder } from './guides';
import { createAdvisor, kindOf } from './reference';
import { answer, emptySave, finished, nextCard, planRound, type Round } from './drill';

const solver: SolverService = {
  press: (cells, i) => refPress(cells, i),
  solve: (cells) => refSolve(cells),
  isSolvable: (cells) => refSolve(cells) !== null,
};

/** GF(2) rank of the press matrix (rank = number of switches: every board has exactly one answer) */
function pressRank(shape: Shape): number {
  const cells = cellIndexes(shape);
  const pos = new Map(cells.map((g, j) => [g, j]));
  const rows = cells.map((g) => pressTargets(shape, g).reduce((m, t) => m | (1n << BigInt(pos.get(t)!)), 0n));
  let r = 0;
  for (let col = 0; col < cells.length; col++) {
    const bit = 1n << BigInt(col);
    const p = rows.findIndex((row, i) => i >= r && (row & bit) !== 0n);
    if (p < 0) continue;
    [rows[r], rows[p]] = [rows[p]!, rows[r]!];
    for (let k = 0; k < rows.length; k++) if (k !== r && rows[k]! & bit) rows[k]! ^= rows[r]!;
    r++;
  }
  return r;
}

/**
 * independent reference for any shape: the light equations (light e = xor of the switches that reach it), BigInt
 * elimination, then the lightest answer. Variables are the pressable switches only (a stuck one is never in an answer).
 */
function refShapedSolve(shape: Shape, cells: readonly boolean[]): number[] | null {
  if (!fitsShape(shape, cells)) return null;
  const vars = cellIndexes(shape).filter((g) => isPressable(shape, g));
  const lights = cellIndexes(shape);
  const n = vars.length, B = BigInt(n);
  const rows = lights.map((e) => vars.reduce((row, g, j) => (pressTargets(shape, g).includes(e) ? row | (1n << BigInt(j)) : row), cells[e] ? 1n << B : 0n));
  const pivots: number[] = [];
  for (let col = 0; col < n; col++) {
    const bit = 1n << BigInt(col), rank = pivots.length;
    const p = rows.findIndex((row, i) => i >= rank && (row & bit) !== 0n);
    if (p < 0) continue;
    [rows[rank], rows[p]] = [rows[p]!, rows[rank]!];
    for (let r = 0; r < rows.length; r++) if (r !== rank && rows[r]! & bit) rows[r]! ^= rows[rank]!;
    pivots.push(col);
  }
  for (let r = pivots.length; r < rows.length; r++) if (rows[r]! >> B) return null;
  const free = [...Array(n).keys()].filter((c) => !pivots.includes(c));
  let best: number[] | null = null;
  for (let combo = 0; combo < 1 << free.length; combo++) {
    const x = new Set<number>(free.filter((_, k) => combo & (1 << k)));
    pivots.forEach((pv, r) => {
      let bit = (rows[r]! >> B) & 1n;
      for (const f of free) if (x.has(f) && rows[r]! & (1n << BigInt(f))) bit ^= 1n;
      if (bit) x.add(pv);
    });
    if (!best || x.size < best.length) best = [...x];
  }
  return best!.map((j) => vars[j]!).sort((a, b) => a - b);
}
/** sentences in a step; the practice line's lead-in "Need help?" reads with the sentence after it */
const sentences = (step: string) => step.replace(/\bNeed help\? /g, '').split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length;
/** classic through the 5×5 reference, any other shape through the shaped one (modules never import each other) */
const roomSolver: SolverService = {
  press: (cells, i, shape) => {
    if (!shape) return refPress(cells, i);
    const out = cells.slice();
    for (const t of pressTargets(shape, i)) out[t] = !out[t];
    return out;
  },
  solve: (cells, shape) => (shape ? refShapedSolve(shape, cells) : refSolve(cells)),
  isSolvable: (cells, shape) => (shape ? refShapedSolve(shape, cells) : refSolve(cells)) !== null,
};

/** every room in the frozen data, as the levels module would make it */
type RoomData = { id: string; kind: Exclude<Pack['kind'], 'classic'>; group?: Pack['group']; cols?: number; rows?: number; side?: number; picture?: string[]; idBase: number; bands: unknown[] };
const ROOM_DATA = (fixtureData.rules as { levels: { rooms: RoomData[] } }).levels.rooms;
const ROOM_NAMES = (fixtureData.copy as { levels: { rooms: Record<string, string> } }).levels.rooms;
const roomShape = (r: RoomData): Shape => (r.picture ? parseShape(r.picture)
  : r.kind === 'hex' ? hexagonShape(r.side!) : r.kind === 'cube' ? cubeShape(r.side!) : { cols: r.cols!, rows: r.rows!, mask: null });
const PACKS: Pack[] = ROOM_DATA.map((r) => ({ id: r.id, name: ROOM_NAMES[r.id]!, kind: r.kind, group: r.group, shape: roomShape(r), first: r.idBase + 1, count: r.bands.length * 10 }));
const ROOM = Object.fromEntries(PACKS.map((p) => [p.id, p.shape])) as Record<string, Shape>;
/** the twist rooms (their own guides); the square-grid rooms keep the chase guides */
const TWIST_IDS = PACKS.filter((p) => ['hex', 'cube', 'wired', 'stuck'].includes(p.kind)).map((p) => p.id);
const SQUARE = PACKS.filter((p) => p.kind === 'size' || p.kind === 'shape');
/** a level's shape as the levels module makes it: a stuck room adds stuck cells, a wired room wiring */
const levelShape = (p: Pack): Shape => (p.kind === 'stuck' ? { ...p.shape, stuck: [8, 21, 27] } : p.kind === 'wired' ? { ...p.shape, wires: guideWiring(p.shape).map((w, i) => (i % 3 ? w : WIRINGS.teeUp)) } : p.shape);
/** a levels slice with the classic pack and every room, one level per room (enough for the panel's pack lookup) */
const levelsState = (): LevelsState => ({
  status: 'ready', chapters: [],
  packs: [{ id: 'classic', name: 'Classic', kind: 'classic', shape: { cols: 5, rows: 5, mask: null }, first: 1, count: 50 }, ...PACKS],
  list: PACKS.map((p): LevelDef => ({ id: p.first, cells: emptyCells(p.shape), par: 1, pack: p.id, index: 1, shape: levelShape(p) })),
});
/** a board from random taps on a shape (always solvable), never dark */
function randomBoard(shape: Shape, seed: number, taps = 8): Cells {
  const real = cellIndexes(shape);
  let x = seed * 2654435761 >>> 0;
  const next = () => { x = (x * 1103515245 + 12345) >>> 0; return x >>> 8; };
  let b = emptyCells(shape);
  for (let k = 0; k < taps; k++) b = roomSolver.press(b, real[next() % real.length]!, shape);
  return isClear(b) ? roomSolver.press(b, real[0]!, shape) : b;
}
const boot = (opts: Parameters<typeof bootModule>[1] = {}) => {
  document.body.replaceChildren();
  return bootModule(learn, { ...opts, services: { solver, ...opts.services } });
};
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
/** what the view's size watcher would set once laid out (happy-dom has no layout) */
const setAttrForTest = (el: HTMLElement, name: string, value: string) => el.setAttribute(name, value);
const qa = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

describe('learn: the maths', () => {
  const table = bottomRowTable(solver);

  test('the bottom-row table has exactly 7 entries, each clearing its board by chase → top taps → chase', () => {
    expect(table).toHaveLength(7);
    for (const e of table) {
      const board = lit(e.bottom.map((c) => BOTTOM + c));
      const afterTop = pressAll(solver, board, e.top);
      expect(isClear(chase(solver, afterTop).cells), `bottom ${e.bottom}`).toBe(true);
    }
    // every other non-empty bottom row is unsolvable
    for (let p = 1; p < 32; p++) {
      const cols = [0, 1, 2, 3, 4].filter((c) => (p >> c) & 1);
      const listed = table.some((e) => e.bottom.join() === cols.join());
      expect(refSolve(lit(cols.map((c) => BOTTOM + c))) !== null).toBe(listed);
    }
  });

  test('quiet patterns: 3 non-empty tap sets that leave every board unchanged', () => {
    const quiet = quietPatterns(solver);
    expect(quiet).toHaveLength(3);
    const some = pressAll(solver, blank(), [3, 7, 11, 19]);
    for (const set of quiet) {
      expect(set.length).toBeGreaterThan(0);
      expect(pressAll(solver, blank(), set)).toEqual(blank());
      expect(pressAll(solver, some, set)).toEqual(some);
    }
  });

  test('a chase leaves only the bottom row, and the full method clears random solvable boards', () => {
    for (let k = 0; k < 200; k++) {
      const taps = [...Array(25).keys()].filter((i) => ((k * 2654435761 + i * 40503) >>> 7) % 3 === 0);
      const board = pressAll(solver, blank(), taps);
      expect(onlyBottom(chase(solver, board).cells)).toBe(true);
      const set = methodTaps(solver, table, board);
      expect(set).not.toBeNull();
      expect(isClear(pressAll(solver, board, set!))).toBe(true);
    }
  });
});

describe('learn: echoes', () => {
  const table = bottomRowTable(solver);
  const letters = (cols: number[]) => 'ABCDE'.split('').map((l, c) => (cols.includes(c) ? l : '·')).join('');

  test('each top-row light echoes as the verified row', () => {
    expect([0, 1, 2, 3, 4].map((c) => letters(echoOf(solver, c)))).toEqual(['·BC·E', 'ABC··', 'AB·DE', '··CDE', 'A·CD·']);
  });

  test('every table row is the echo of its own top taps (stacked echoes cancel where they overlap)', () => {
    for (const e of table) expect(echoOfSet(solver, e.top), `top ${e.top}`).toEqual(e.bottom);
    expect(letters(echoOfSet(solver, [0, 3]))).toBe('·B·D·');
    expect(letters(echoOfSet(solver, [0, 1]))).toBe('A···E');
  });

  test('the five rules cover the seven rows, and each rule\'s taps clear its row by chase → taps → chase', () => {
    const rows = RULES.flatMap((r) => r.rows);
    expect(rows.map((r) => r.bottom.join()).sort()).toEqual(table.map((e) => e.bottom.join()).sort());
    for (const r of rows) expect(clearsBottom(solver, r.bottom, r.top), `rule row ${r.bottom}`).toBe(true);
  });

  test('how an echo is made: the row rule gives the same echo as the real chase, for every light', () => {
    for (let c = 0; c < 5; c++) expect(echoRows(c).echo).toEqual(echoOf(solver, c));
    const b = echoRows(1);
    expect(b.rows.map(letters)).toEqual(['·B···', 'ABC··', '···D·', 'AB·DE', '···D·']);
    expect(letters(b.echo)).toBe('ABC··');
  });
});

describe('learn: drill scheduling', () => {
  const rules = { cards: 10, boxes: 3, missGap: 3, saveKey: 'learn-drill' };
  const keys = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const seq = (xs: number[]) => { let k = 0; return { next: () => xs[k++ % xs.length]! }; };

  test('a round has 10 cards, never the same card twice in a row', () => {
    const q = planRound(keys, emptySave(), rules, seq([0.1, 0.1, 0.5, 0.9, 0.3]));
    expect(q).toHaveLength(10);
    for (let k = 1; k < q.length; k++) expect(q[k]).not.toBe(q[k - 1]);
  });

  test('known cards (higher box) are drawn less often than ones still being learnt', () => {
    const save = { boxes: { a: 3, b: 3, c: 3, d: 3, e: 3, f: 3 }, rounds: 1 };
    let g = 0;
    const r = { next: (() => { let x = 0.123; return () => (x = (x * 9301 + 0.4927) % 1); })() };
    for (let k = 0; k < 20; k++) g += planRound(keys, save, rules, r).filter((x) => x === 'g').length;
    expect(g / 200).toBeGreaterThan(0.22); // box 1 weighs 4× box 3 (never twice in a row): well above 1/7 uniform
  });

  test('right moves a card up a box; wrong sends it to box 1 and brings it back 3 cards later', () => {
    let round: Round = { queue: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'a', 'b', 'c'], pos: 0, right: 0, answered: null };
    let save = emptySave();
    ({ round, save } = answer(round, save, true, rules));
    expect(save.boxes.a).toBe(2);
    expect(round.right).toBe(1);
    round = nextCard(round);
    ({ round, save } = answer(round, save, false, rules));
    expect(save.boxes.b).toBe(1);
    expect(round.queue[4]).toBe('b');
    expect(round.queue).toHaveLength(10);
    for (let k = 0; k < 9; k++) round = nextCard(round);
    expect(finished(round)).toBe(true);
  });
});

describe('learn: module', () => {
  const table = bottomRowTable(solver);
  test('learn:open shows the lesson and asks nav for the learn screen', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'chase' });
    expect(t.state('learn')).toMatchObject({ lessonId: 'chase', step: 0 });
    expect(t.seen('learn:lesson_opened', { lessonId: 'chase' })).toBeTruthy();
    expect(t.seen('nav:go', { screen: 'learn' })).toBeTruthy();
    expect(q('[data-lesson-view="chase"][data-step="0"]')).toBeTruthy();
    t.emit('learn:open', {});
    expect(t.state('learn').lessonId).toBeNull();
    expect(qa('[data-lesson-tile]').map((e) => e.dataset.lesson)).toEqual(['shapes', 'order', 'chase', 'bottom-row', 'shortest']);
  });

  test('an unknown lesson is refused and nothing changes', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'nope' });
    expect(t.seen('learn:refused', { command: 'learn:open', reason: 'unknown_lesson' })).toBeTruthy();
    expect(t.seen('nav:go')).toBeUndefined();
    expect(t.state('learn').lessonId).toBeNull();
  });

  test('back on the list emits nav:back', () => {
    const t = boot();
    t.emit('learn:open', {});
    q('[data-action="learn-back"]')!.click();
    expect(t.seen('nav:back')).toEqual({});
  });

  test('finishing every step completes the lesson, and it stays completed after a reboot', () => {
    const storage = createMemoryStorage();
    const t = boot({ services: { storage } });
    t.emit('learn:open', { lessonId: 'order' });
    for (let k = 0; k < 10 && t.state('learn').lessonId; k++) q('[data-action="learn-next"]')!.click();
    expect(t.seen('learn:lesson_completed', { lessonId: 'order' })).toBeTruthy();
    expect(t.state('learn').lessonId).toBeNull();
    expect(q('[data-lesson-tile][data-lesson="order"]')!.dataset.completed).toBe('true');

    const again = boot({ services: { storage } });
    expect(again.state('learn').completed).toEqual(['order']);
    expect(q('[data-lesson-tile][data-lesson="order"]')!.dataset.completed).toBe('true');
    expect(q('[data-lesson-tile][data-lesson="shapes"]')!.dataset.completed).toBe('false');
  });

  test.each(['shapes', 'order', 'chase', 'bottom-row', 'shortest'])('%s: practice boards are solvable and solving one fires practice_solved', (id) => {
    const t = boot();
    t.emit('learn:open', { lessonId: id });
    for (let k = 0; k < 5; k++) {
      t.emit('learn:new_practice', {});
      const p = t.state('learn').practice!;
      expect(p.status).toBe('playing');
      expect(isClear(p.cells)).toBe(false);
      const answer = refSolve(p.cells);
      expect(answer).not.toBeNull();
      for (const i of answer!) t.emit('learn:press', { index: i });
      expect(t.state('learn').practice!.status).toBe('solved');
      expect(t.seen('learn:practice_solved')).toEqual({ lessonId: id, moves: answer!.length, par: answer!.length });
    }
  });

  test('practice presses happen on pointerdown on the mini board', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'shapes' });
    t.emit('learn:new_practice', {});
    const before = t.state('learn').practice!.cells;
    const cell = q('[data-mini-board="practice"] [data-mini-cell][data-index="12"]')!;
    cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(t.state('learn').practice!.cells).toEqual(refPress(before, 12));
    expect(t.state('learn').practice!.moves).toBe(1);
  });

  test('assist suggests the chase tap under a lit light in the highest lit row', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'chase' });
    t.emit('learn:new_practice', {});
    expect(t.state('learn').practice!.suggest).toBeNull();
    t.emit('learn:set_assist', { on: true });
    for (let k = 0; k < 40 && t.state('learn').practice!.status === 'playing'; k++) {
      const { cells, suggest } = t.state('learn').practice!;
      const chaseTap = chaseSuggest(cells as Cells);
      if (chaseTap !== null) {
        const row = Math.floor(suggest! / 5) - 1;
        expect(cells[suggest! - 5]).toBe(true);
        // every row above the suggested one is already dark
        expect(cells.slice(0, row * 5).some(Boolean)).toBe(false);
      }
      expect(q(`[data-mini-cell][data-index="${suggest}"]`)!.dataset.suggest).toBe('true');
      t.emit('learn:press', { index: suggest! });
    }
    expect(t.state('learn').practice!.status).toBe('solved');
  });

  test('the bottom-row lesson assist walks the full method to a dark board', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'bottom-row' });
    t.emit('learn:new_practice', {});
    t.emit('learn:set_assist', { on: true });
    for (let k = 0; k < 80 && t.state('learn').practice!.status === 'playing'; k++) t.emit('learn:press', { index: t.state('learn').practice!.suggest! });
    expect(t.state('learn').practice!.status).toBe('solved');
  });

  test('a press with no practice board or off the board is refused', () => {
    const t = boot();
    t.emit('learn:press', { index: 3 });
    expect(t.seen('learn:refused', { reason: 'no_practice' })).toBeTruthy();
    t.emit('learn:open', { lessonId: 'shapes' });
    t.emit('learn:new_practice', {});
    t.emit('learn:press', { index: 25 });
    expect(t.seen('learn:refused', { reason: 'bad_index' })).toBeTruthy();
  });

  test('the bottom-row lesson: find your row, tap its top light, chase again; the demo starts from the bottom row', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'bottom-row' });
    expect(qa('.learn-dots > i')).toHaveLength(4);
    t.emit('learn:step', { delta: 1 });
    const lit = () => qa('[data-mini-board="demo"] [data-lit="true"]').length;
    const litIdx = () => qa('[data-mini-board="demo"] [data-mini-cell]').flatMap((e, i) => (e.dataset.lit === 'true' ? [i] : []));
    expect(litIdx()).toEqual([20, 21, 22]); // B's echo, nothing above
    expect(q('[data-mini-board="demo"] [data-mark="true"]')!.dataset.index).toBe('1'); // B is marked first
    const button = q('[data-action="learn-demo"]')!;
    for (let k = 0; k < 40 && lit() > 0; k++) button.click();
    expect(lit()).toBe(0);
    expect(button.textContent).toBe('Replay');
    t.emit('learn:step', { delta: 1 });
    expect(qa('[data-table-row]')).toHaveLength(7);
    expect(qa('[data-table-row="012"] [data-letter]').map((e) => e.dataset.letter)).toEqual(['B']);
  });

  test('the echo step: pick a top light, the demo taps it and chases down to its echo', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'bottom-row' });
    q('[data-action="learn-echo"][data-col="3"]')!.click();
    const button = q('[data-action="learn-demo"]')!;
    for (let k = 0; k < 20 && button.textContent !== 'Replay'; k++) button.click();
    const bottom = qa('[data-mini-board="demo"] [data-mini-cell]').slice(20).map((e) => e.dataset.lit === 'true');
    expect(bottom).toEqual([false, false, true, true, true]);
    expect(q('[data-learn-line="demo"]')!.textContent).toBe("D's echo. Tap a letter to try another.");
    expect(q('[data-action="learn-echo"][data-col="3"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  test('"Go deeper" sits under the last idea before practice (never under the practice board); the extra lesson is not in the list and never counts', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'bottom-row' });
    expect(q('[data-action="learn-deeper"]')).toBeNull();
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
    expect(q('[data-action="learn-deeper"]')).toBeNull(); // practice
    t.emit('learn:step', { delta: -1 }); // the bottom-row list
    expect(q('[data-lesson-view] [data-kind="table"]')).not.toBeNull();
    q('[data-action="learn-deeper"]')!.click();
    expect(t.state('learn').lessonId).toBe('echo-more');
    expect(qa('[data-rule]')).toHaveLength(5);
    expect(qa('[data-rule] [data-table-row]')).toHaveLength(7);
    for (let k = 0; k < 4; k++) t.emit('learn:step', { delta: 1 });
    expect(t.state('learn').completed).not.toContain('echo-more');
    expect(qa('[data-lesson-tile]').map((e) => e.dataset.lesson)).not.toContain('echo-more');
  });

  test('drill: any top-row set that cancels the row counts (auto-checked); a wrong Check reveals the answer; boxes persist', () => {
    const storage = createMemoryStorage();
    const t = boot({ services: { storage } });
    t.emit('learn:open', { lessonId: 'echo-more' });
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
    const action = q('[data-action="learn-drill"]')!;
    const drill = q('[data-drill]')!;
    expect(drill.dataset.drill).toBe('asking'); // the first card shows at once
    const bottom = () => qa('.learn-drill .learn-row--bottom [data-mini-cell]').flatMap((e, c) => (e.dataset.lit === 'true' ? [c] : []));
    const top = (c: number) => q(`.learn-row--pick [data-col="${c}"]`)!;
    // card 1: answer with the table's taps plus a no-echo set (A·C·E): a different, still valid answer
    const entry = table.find((e) => e.bottom.join() === bottom().join())!;
    const alt = [0, 2, 4].reduce((set, c) => (set.includes(c) ? set.filter((x) => x !== c) : [...set, c]), entry.top);
    expect(alt.join()).not.toBe(entry.top.join());
    for (const c of alt) top(c).click();
    expect(drill.dataset.drill).toBe('right');
    action.click();
    // card 2: tap one wrong light and Check
    const e2 = table.find((e) => e.bottom.join() === bottom().join())!;
    const wrong = [0, 1, 2, 3, 4].find((c) => !clearsBottom(solver, e2.bottom, [c]))!;
    top(wrong).click();
    action.click();
    expect(drill.dataset.drill).toBe('wrong');
    expect(q('[data-learn-line="drill"]')!.textContent).toMatch(/tap/);
    expect(qa('.learn-row--pick [data-letter]').map((e) => Number(e.dataset.col))).toEqual(e2.top);
    const saved = storage.get('learn-drill') as { boxes: Record<string, number> };
    expect(saved.boxes[e2.bottom.join(',')]).toBe(1);
    expect(saved.boxes[entry.bottom.join(',')]).toBe(2);
    expect(t.all('learn:lesson_completed')).toHaveLength(0);
  });

  test('every lesson step is short: at most 5 steps, 2 sentences and ~25 words each', () => {
    const lessons = (fixtureData.copy as { learn: { lessons: Record<string, { steps: string[] }> } }).learn.lessons;
    for (const [id, l] of Object.entries(lessons)) {
      expect(l.steps.length, id).toBeLessThanOrEqual(5);
      for (const step of l.steps) {
        expect(step.split(/\s+/).length, step).toBeLessThanOrEqual(26);
        expect(sentences(step), step).toBeLessThanOrEqual(2);
      }
    }
  });

  test('console: table prints 7 patterns; open refuses unknown lessons', () => {
    const t = boot();
    const cmds = t.instance!.commands!;
    expect(String(cmds.table!([])).split('\n')).toHaveLength(8);
    expect(String(cmds.open!(['zzz']))).toMatch(/unknown lesson/);
    cmds.open!(['shortest']);
    expect(t.state('learn').lessonId).toBe('shortest');
  });

  test('chase helper agrees with the board: the bottom row it leaves is in the table', () => {
    const table = bottomRowTable(solver);
    const board = pressAll(solver, blank(), [1, 8, 12, 16, 24]);
    const left = bottomColumns(chase(solver, board).cells);
    expect(table.some((e) => e.bottom.join() === left.join())).toBe(true);
  });
});

describe('learn: in-game pattern reference', () => {
  const table = bottomRowTable(solver);
  const boardState = (cells: Cells, status: 'playing' | 'solved' | 'empty' = 'playing') =>
    ({ status, levelId: status === 'empty' ? null : 3, start: cells, cells, par: 5, moves: 0, history: [] });
  const panel = (t: ReturnType<typeof boot>) => t.view!.region('slot:reference');
  const statusOf = (t: ReturnType<typeof boot>) => panel(t).querySelector<HTMLElement>('[data-reference-status]')!;

  test('with no board: only the live row (no table: the panel shows what is relevant now) and the chase line', () => {
    const t = boot();
    expect(panel(t).querySelectorAll('[data-reference]')).toHaveLength(1);
    expect(panel(t).querySelectorAll('[data-pattern-row]')).toHaveLength(1);
    expect(panel(t).querySelector('[data-pattern-row]')!.getAttribute('data-match')).toBe('false');
    expect(statusOf(t).dataset.referenceStatus).toBe('chase');
  });

  test('chase while rows 1–4 have lights, naming the highest lit row', () => {
    const cells = pressAll(solver, blank(), [12, 17]);
    const t = boot({ state: { board: boardState(cells) } });
    expect(statusOf(t).dataset.referenceStatus).toBe('chase');
    expect(statusOf(t).textContent).toMatch(/Row 2/);
    expect(panel(t).querySelectorAll('[data-match="true"]')).toHaveLength(0);
  });

  test('match when only the bottom row is lit: the matched row is the computed table entry', () => {
    for (const entry of table) {
      const cells = lit(entry.bottom.map((c) => BOTTOM + c));
      const t = boot({ state: { board: boardState(cells) } });
      expect(statusOf(t).dataset.referenceStatus).toBe('match');
      const matched = panel(t).querySelectorAll<HTMLElement>('[data-pattern-row][data-match="true"]');
      expect(matched).toHaveLength(1);
      expect(matched[0]!.dataset.pattern).toBe(entry.bottom.join(','));
      const ringed = [...matched[0]!.querySelectorAll<HTMLElement>('[data-suggest="true"]')].map((e) => Number(e.dataset.index));
      expect(ringed).toEqual(entry.top);
      const live = [...panel(t).querySelectorAll<HTMLElement>('[data-reference-bottom] [data-mini-cell]')].map((e) => e.dataset.lit === 'true');
      expect(live).toEqual([0, 1, 2, 3, 4].map((c) => entry.bottom.includes(c)));
    }
  });

  test('the panel follows the board slice tap by tap through to clear, and never marks the main board', () => {
    const entry = table.find((e) => e.top.length === 2)!;
    const start = lit(entry.bottom.map((c) => BOTTOM + c));
    const t = boot({ state: { board: boardState(start) } });
    // tap one of the ringed top-row lights: still matched (part-way), then the second
    let cells = solver.press(start, entry.top[0]!);
    t.kernel.seed('board', boardState(cells));
    t.emit('learn:set_assist', { on: false }); // any event flushes watchers
    expect(statusOf(t).dataset.referenceStatus).toBe('match');
    expect(panel(t).querySelector('[data-match="true"]')!.getAttribute('data-pattern')).toBe(entry.bottom.join(','));
    cells = solver.press(cells, entry.top[1]!);
    t.kernel.seed('board', boardState(cells));
    t.emit('learn:set_assist', { on: false });
    expect(statusOf(t).dataset.referenceStatus).toBe('chase');
    cells = chase(solver, cells).cells;
    t.kernel.seed('board', boardState(cells, 'solved'));
    t.emit('learn:set_assist', { on: false });
    expect(statusOf(t).dataset.referenceStatus).toBe('clear');
    expect(document.querySelectorAll('[data-cell]')).toHaveLength(0);
  });

  test('nomatch is handled in words', () => {
    const cells = lit([BOTTOM]); // a single bottom-left light can't be solved
    const t = boot({ state: { board: boardState(cells) } });
    expect(statusOf(t).dataset.referenceStatus).toBe('nomatch');
    expect(statusOf(t).textContent!.length).toBeGreaterThan(10);
  });

  test('the matching row gets its echo and rule as one line, its taps lettered under your row', () => {
    {
      const cells = lit([0, 1, 2].map((c) => BOTTOM + c));
      const t = boot({ state: { board: boardState(cells) } });
      const rule = panel(t).querySelector<HTMLElement>('[data-reference-rule]')!;
      expect(rule.hidden).toBe(false);
      expect(rule.textContent).toBe('Echo of B');
      expect([...panel(t).querySelectorAll<HTMLElement>('[data-match="true"] [data-letter]')].map((e) => e.dataset.letter)).toEqual(['B']);
      expect(panel(t).querySelector('[data-pattern-row]')!.getAttribute('data-pattern')).toBe('0,1,2');
      t.kernel.seed('board', boardState(lit([BOTTOM + 1, BOTTOM + 3])));
      t.emit('learn:set_assist', { on: false });
      expect(rule.textContent).toBe('Echo of A + B + C');
      expect([...panel(t).querySelectorAll<HTMLElement>('[data-match="true"] [data-letter]')].map((e) => e.dataset.letter)).toEqual(['A', 'B', 'C']);
      t.kernel.seed('board', boardState(pressAll(solver, blank(), [12])));
      t.emit('learn:set_assist', { on: false });
      expect(rule.hidden).toBe(true);
      expect(panel(t).querySelector('[data-pattern-row]')!.hasAttribute('data-pattern')).toBe(false);
    }
  });

  test('"All lessons" opens the lesson list', () => {
    const t = boot();
    panel(t).querySelector<HTMLElement>('[data-action="learn"]')!.click();
    expect(t.seen('learn:open')).toEqual({});
    expect(t.seen('nav:go', { screen: 'learn' })).toBeTruthy();
  });
});

describe('learn: the reference on Variety boards', () => {
  const shapedSolver = roomSolver;
  const table = bottomRowTable(solver);
  const status = {
    start: 'start', chase: 'Row {row}: tap under each lit light.', match: 'match', progress: 'progress', clear: 'clear', nomatch: 'nomatch',
    rectBottom: 'Only the bottom row is left.', rectMatch: 'rect match', shapedFix: 'fix {n}', shapedProgress: 'finish {n}', shapedNomatch: 'no fix',
    chaseSide: 'Column {col}: tap right of each lit light.', sideMatch: 'side match', sideProgress: 'side progress', sideBottom: 'side none',
  };
  const advise = createAdvisor(shapedSolver, table, status, (shape) => createFixer(roomSolver, shape));
  const rect = (n: number) => ({ cols: n, rows: n, mask: null });
  const ring = ROOM.ring!;
  const on = (n: number, idx: number[]) => { const c = new Array<boolean>(n).fill(false); for (const i of idx) c[i] = true; return c; };
  const boardState = (cells: boolean[], shape?: { cols: number; rows: number; mask: boolean[] | null }) =>
    ({ status: 'playing' as const, levelId: 3001, start: cells, cells, par: 5, moves: 0, history: [], ...(shape ? { shape } : {}) });
  const panel = (t: ReturnType<typeof boot>) => t.view!.region('slot:reference');

  test('board kinds: absent / 5×5 = classic, other full rectangles = rect, a mask with gaps = shaped', () => {
    expect(kindOf(undefined)).toBe('classic');
    expect(kindOf(rect(5))).toBe('classic');
    expect(kindOf(rect(4))).toBe('rect');
    expect(kindOf({ cols: 7, rows: 7, mask: new Array(49).fill(true) })).toBe('rect');
    expect(kindOf(ring)).toBe('shaped');
  });

  test('4×4 and 7×7: chase advice by the real row; at bottom-row time the top taps for the player\'s row', () => {
    expect(advise({ status: 'playing', cells: on(16, [5]), shape: rect(4) })).toMatchObject({ status: 'chase', text: 'Row 2: tap under each lit light.' });
    expect(advise({ status: 'playing', cells: on(49, [40, 3]), shape: rect(7) })).toMatchObject({ status: 'chase', text: 'Row 1: tap under each lit light.' });
    expect(advise({ status: 'playing', cells: on(49, [36]), shape: rect(7) }).text).toBe('Row 6: tap under each lit light.');
    // bottom C and E lit on 7×7: B C D xor D E F = B C E F
    expect(advise({ status: 'playing', cells: on(49, [44, 46]), shape: rect(7) })).toMatchObject({ status: 'match', text: 'rect match', rect: { bottom: [2, 4], taps: [1, 2, 4, 5] } });
    // 4×4: a lone bottom light can't be cleared from the top (a chase clears every solvable board)
    expect(advise({ status: 'playing', cells: on(16, [12]), shape: rect(4) })).toMatchObject({ status: 'nomatch', text: 'Only the bottom row is left.' });
  });

  const letters = (sets: (number[] | null)[]) => sets.map((x) => (x ? x.map((c) => 'ABCDEFG'[c]).join('') : '-'));

  test('per-light top taps from the solver: 7×7 three above, 6×6 its own sets, 4×4 chasing clears everything', () => {
    expect(letters(rectTopSets(shapedSolver, rect(7) as never).perLight)).toEqual(['AB', 'ABC', 'BCD', 'CDE', 'DEF', 'EFG', 'FG']);
    expect(letters(rectTopSets(shapedSolver, rect(6) as never).perLight)).toEqual(['AC', 'D', 'AE', 'BF', 'C', 'DF']);
    expect(rectTopSets(shapedSolver, rect(4) as never).chaseClears).toBe(true);
    expect(rectTopSets(shapedSolver, rect(7) as never).chaseClears).toBe(false);
  });

  test('the strip\'s taps then a chase clear random 6×6 and 7×7 bottom-row-only boards', () => {
    for (const n of [6, 7]) {
      const shape = rect(n) as never;
      const { perLight } = rectTopSets(shapedSolver, shape);
      for (let p = 1; p < 1 << n; p++) {
        const bottom = [...Array(n).keys()].filter((c) => (p >> c) & 1);
        const taps = rectTaps(perLight, bottom)!;
        let b = on(n * n, bottom.map((c) => (n - 1) * n + c));
        for (const t of taps) b = shapedSolver.press(b, t, shape);
        expect(chaseRect(shapedSolver, b, shape).every((x) => !x), `${n}×${n} bottom ${bottom}`).toBe(true);
      }
    }
  });

  test('the strategy line per size, picked from the maths', () => {
    const lines = { chaseClears: '{cols}×{rows} chase', straightAbove: 'straight', threeAbove: 'three', twoAside: 'two aside', aboveTwoAside: 'above + two aside', ownTaps: 'own', oneRow: 'only {pattern}: {taps}', fewRows: 'few', side: 'side', sideFew: 'side few' };
    expect(advise.rectLine(rect(4) as never, lines)).toBe('4×4 chase');
    expect(advise.rectLine({ cols: 5, rows: 6, mask: null }, lines)).toBe('straight');
    expect(advise.rectLine({ cols: 8, rows: 16, mask: null }, lines)).toBe('own');
    expect(advise.rectLine(rect(6) as never, lines)).toBe('two aside');
    expect(advise.rectLine(rect(7) as never, lines)).toBe('three');
    expect(advise.rectLine(rect(8) as never, lines)).toBe('own');
    expect(advise.rectLine(rect(10) as never, lines)).toBe('above + two aside');
    // 9×9: a chase leaves the bottom row dark or A C E G I, and one top tap fixes that (no lone light has its own taps)
    const say = (cols: readonly number[]) => cols.map((c) => 'ABCDEFGHIJKLMNOPQRST'[c]).join(' ');
    expect(advise.rectLine(rect(9) as never, lines, say)).toBe('only A C E G I: A');
    expect(advise.rectLine(rect(11) as never, lines, say)).toBe('few');
  });

  test('9×9 at bottom-row time: the panel shows the top tap for the one row a chase can leave', () => {
    const sets = rectTopSets(shapedSolver, rect(9) as never);
    expect(sets.chaseClears).toBe(false);
    expect(sets.rows).toBe(1);
    expect(sets.perLight.every((x) => x === null)).toBe(true);
    expect(sets.possibleRows(4)).toEqual([[0, 2, 4, 6, 8]]);
    expect(advise({ status: 'playing', cells: on(81, [72, 74, 76, 78, 80]), shape: rect(9) })).toMatchObject({ status: 'match', text: 'rect match', rect: { bottom: [0, 2, 4, 6, 8], taps: [0] } });
  });

  test('every bottom row a chase can leave is cleared by its top taps then a chase, on rectangles 3 to 12 wide', () => {
    for (const [cols, rows] of [[3, 3], [4, 4], [4, 7], [9, 9], [11, 11], [12, 5], [5, 12], [8, 16], [10, 3]] as const) {
      const shape = { cols, rows, mask: null } as never;
      const sets = rectTopSets(shapedSolver, shape);
      const all = sets.possibleRows(1 << 12)!;
      expect(all.length, `${cols}×${rows}`).toBe(sets.rows);
      for (const bottom of all) {
        const taps = sets.tapsFor(bottom);
        expect(taps, `${cols}×${rows} bottom ${bottom}`).not.toBeNull();
        let b = on(cols * rows, bottom.map((c) => (rows - 1) * cols + c));
        for (const t of taps!) b = shapedSolver.press(b, t, shape);
        expect(chaseRect(shapedSolver, b, shape).every((x) => !x), `${cols}×${rows} bottom ${bottom}`).toBe(true);
      }
    }
  });

  test('shaped rooms: chase by the row of the first light above an end cell, then the start-cell fix ringed, then progress', () => {
    // (0,0) lit: row 1 has a light with a cell below it
    expect(advise({ status: 'playing', cells: on(49, [0, 48]), shape: ring })).toMatchObject({ status: 'chase', text: 'Row 1: tap under each lit light.' });
    // lights only on end cells (row 2 above the hole, bottom row): the fix, ringed
    const fx = createFixer(roomSolver, ring);
    let seed = 1;
    while ((fx.fixFor(chaseShape(roomSolver, randomBoard(ring, seed), ring).cells)?.length ?? 0) < 2) seed++;
    const left = chaseShape(roomSolver, randomBoard(ring, seed), ring).cells;
    const fix = fx.fixFor(left)!;
    expect(advise({ status: 'playing', cells: left, shape: ring })).toMatchObject({ status: 'match', text: `fix ${fix.length}`, shaped: { ring: fix } });
    // one of the fix taps done: finish the rest (not "chase row 1", which would undo it)
    const p = advise({ status: 'playing', cells: roomSolver.press(left, fix[0]!, ring), shape: ring });
    expect(p).toMatchObject({ status: 'match', text: `finish ${fix.length - 1}`, shaped: { ring: fix.slice(1) } });
    expect(advise({ status: 'solved', cells: on(49, []), shape: ring }).status).toBe('clear');
  });

  test('on a 7×7 board the panel shows chase advice, then the strip pair; on a Ring chase advice; classic is unchanged', () => {
    const t = boot({ state: { board: boardState(on(49, [9]), rect(7)) }, services: { solver: shapedSolver } });
    const root = panel(t).querySelector<HTMLElement>('[data-reference]')!;
    expect(root.dataset.referenceKind).toBe('rect');
    expect(root.querySelector('[data-reference-status]')!.textContent).toBe('Row 2: tap under each lit light.');
    expect(root.querySelector('[data-reference-rule]')!.textContent).toMatch(/three top lights above it/);
    expect(root.querySelectorAll('[data-match="true"]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-reference-bottom] [data-lit="true"]')).toHaveLength(0);
    expect(root.querySelector('[data-action="learn"]')).toBeTruthy();
    // while chasing: the live bottom row (7 lights, dark), no top taps yet
    expect(root.querySelector<HTMLElement>('.reference__rect')!.hidden).toBe(false);
    expect(root.querySelectorAll('[data-reference-bottom]')).toHaveLength(1);
    expect([...root.querySelectorAll<HTMLElement>('[data-reference-bottom] [data-mini-cell]')].map((e) => Number(e.dataset.index))).toEqual([42, 43, 44, 45, 46, 47, 48]);
    expect(root.querySelectorAll('.reference__rect [data-letter]')).toHaveLength(0);

    t.kernel.seed('board', boardState(on(49, [42]), rect(7)));
    t.emit('learn:set_assist', { on: false });
    expect(root.querySelector<HTMLElement>('.reference__rect')!.hidden).toBe(false);
    expect([...root.querySelectorAll<HTMLElement>('.reference__rect [data-letter]')].map((e) => e.dataset.letter)).toEqual(['A', 'B']);
    expect([...root.querySelectorAll<HTMLElement>('[data-reference-bottom] [data-lit="true"]')].map((e) => Number(e.dataset.index))).toEqual([42]);

    t.kernel.seed('board', boardState(on(49, [0]), ring));
    t.emit('learn:set_assist', { on: false });
    expect(root.dataset.referenceKind).toBe('shaped');
    expect(root.querySelector('[data-reference-status]')!.textContent).toBe('Row 1: tap under each lit light.');
    expect(root.querySelector<HTMLElement>('[data-reference-rule]')!.hidden).toBe(true);
    expect(root.querySelector<HTMLElement>('[data-reference-shape]')!.hidden).toBe(true);
    expect(root.querySelector('[data-reference-status]')!.getAttribute('data-tone')).toBe('coach');

    t.kernel.seed('board', boardState(lit([BOTTOM, BOTTOM + 1, BOTTOM + 2])));
    t.emit('learn:set_assist', { on: false });
    expect(root.dataset.referenceKind).toBe('classic');
    expect(root.querySelector('[data-reference-status]')!.getAttribute('data-reference-status')).toBe('match');
    expect(root.querySelectorAll('[data-pattern-row][data-match="true"]')).toHaveLength(1);
    expect(root.querySelector<HTMLElement>('.reference__rect')!.hidden).toBe(true);
    expect(root.querySelectorAll('[data-reference-bottom]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-reference-bottom] [data-lit="true"]')).toHaveLength(3);
    expect(document.querySelectorAll('[data-cell]')).toHaveLength(0);
  });
});

describe('learn: any shape — chase, start and end cells, the start-cell fix', () => {
  /** every square-grid room, plus stuck switches on the Stuck room's grid (the guide's, and a level's) */
  const stuckRoom = ROOM.stuck!;
  const SHAPES: Record<string, Shape> = {
    ...Object.fromEntries(SQUARE.map((p) => [p.id, p.shape])),
    'stuck (guide)': { ...stuckRoom, stuck: guideStuck(stuckRoom) },
    'stuck (level)': { ...stuckRoom, stuck: [8, 21, 27] },
  };
  const ROOM_IDS = Object.keys(SHAPES);

  test('start cells have nothing above, end cells nothing below', () => {
    expect(startCells({ cols: 4, rows: 4, mask: null })).toEqual([0, 1, 2, 3]);
    expect(endCells({ cols: 4, rows: 4, mask: null })).toEqual([12, 13, 14, 15]);
    expect([startCells(ROOM.ring!).length, endCells(ROOM.ring!).length]).toEqual([10, 10]);
    expect([startCells(ROOM.diamond!).length, endCells(ROOM.diamond!).length]).toEqual([7, 7]);
    // the Ring's row above the hole collects lights; the row under it starts them
    expect(endCells(ROOM.ring!)).toEqual(expect.arrayContaining([9, 10, 11]));
    expect(startCells(ROOM.ring!)).toEqual(expect.arrayContaining([37, 38, 39]));
    // a stuck switch can't be pressed: the light over it is an end light (a chase can't clear it), and it never starts
    const s: Shape = { cols: 4, rows: 4, mask: null, stuck: [1, 9] };
    expect(startCells(s)).toEqual([0, 2, 3]);
    expect(endCells(s)).toEqual([5, 12, 13, 14, 15]);
  });

  test('classic and full rectangles keep their chase: the any-shape chase gives the same taps and board', () => {
    const classic = { cols: 5, rows: 5, mask: null };
    for (let k = 1; k <= 40; k++) {
      const b = randomBoard(classic, k, 7);
      expect(chaseShape(roomSolver, b, classic)).toEqual(chase(solver, b));
    }
    // the bottom-row table and the any-shape fixer both pick the fix with the fewest taps in all (fewer top lights only
    // break a tie), so they agree; for B·D that is A·B·C (3 + 8 = 11 taps), not the fewer top lights A·D (2 + 13 = 15)
    const total = (b: Cells, top: readonly number[]) => top.length + chase(solver, pressAll(solver, b, top)).taps.length;
    for (const e of bottomRowTable(solver)) {
      const b = lit(e.bottom.map((c) => BOTTOM + c));
      expect(fixFor(roomSolver, classic, b)).toEqual(e.top);
      if (e.bottom.join() === '1,3') expect([total(b, e.top), total(b, [0, 3])]).toEqual([11, 15]);
    }
  });

  test.each(ROOM_IDS)('%s: a chase leaves lights only on end cells; chase → fix → chase clears random boards', (id) => {
    const shape = SHAPES[id]!;
    const fx = createFixer(roomSolver, shape);
    for (let k = 1; k <= 80; k++) {
      const board = randomBoard(shape, k, 2 + (k % 12));
      const c1 = chaseShape(roomSolver, board, shape);
      expect(onlyEnds(c1.cells, shape)).toBe(true);
      expect(c1.taps.some((t) => isStuck(shape, t))).toBe(false);
      if (isClear(c1.cells)) continue;
      const fix = fx.fixFor(c1.cells);
      expect(fix, `${id} board ${k}`).not.toBeNull();
      expect(fix!.every((i) => fx.starts.includes(i))).toBe(true);
      expect(isClear(chaseShape(roomSolver, pressAll(roomSolver, c1.cells, fix!, shape), shape).cells), `${id} board ${k}`).toBe(true);
    }
  });

  test.each(ROOM_IDS)('%s: the fix takes the fewest taps in all, start taps plus the chase after (checked against every other fix)', (id) => {
    const shape = SHAPES[id]!;
    const fx = createFixer(roomSolver, shape);
    const leaves = (set: number[]) => chaseShape(roomSolver, pressAll(roomSolver, emptyCells(shape), set, shape), shape).cells.join();
    const total = (left: Cells, set: number[]) => set.length + chaseShape(roomSolver, pressAll(roomSolver, left, set, shape), shape).taps.length;
    for (let k = 1; k <= 12; k++) {
      const left = chaseShape(roomSolver, randomBoard(shape, k * 7, 6), shape).cells;
      const fix = fx.fixFor(left);
      if (!fix) continue;
      expect(isClear(chaseShape(roomSolver, pressAll(roomSolver, left, fix, shape), shape).cells)).toBe(true);
      for (let m = 0; m < 1 << fx.starts.length; m++) {
        const set = fx.starts.filter((_, b) => (m >> b) & 1);
        if (leaves(set) !== left.join()) continue;
        expect(total(left, fix)).toBeLessThanOrEqual(total(left, set));
      }
    }
  });

  test.each(ROOM_IDS)('%s: the assist (chase → fix → chase, from the board alone) reaches dark, never on a stuck switch', (id) => {
    const shape = SHAPES[id]!;
    const fx = createFixer(roomSolver, shape);
    for (let k = 1; k <= 25; k++) {
      let b = randomBoard(shape, k * 13, 3 + (k % 8));
      for (let n = 0; n < 200 && !isClear(b); n++) {
        const t = fixSuggest(fx, b, shape)!;
        expect(isPressable(shape, t)).toBe(true);
        b = roomSolver.press(b, t, shape);
      }
      expect(isClear(b), `${id} board ${k}`).toBe(true);
    }
  });
});

describe('learn: what the board guides say (proved from the solver)', () => {
  const rect = (n: number) => ({ cols: n, rows: n, mask: null });
  const letters = (sets: (number[] | null)[]) => sets.map((x) => (x ? x.map((c) => 'ABCDEFGHIJ'[c]).join('') : '-'));
  /** every full-rectangle room in the frozen data (7×7, 8×8, the Tower; a stuck or wired room's grid is a twist) */
  const RECTS = PACKS.filter((p) => p.kind === 'size');

  test('a chase alone clears every solvable 4×4 board, so such a board would get the short chase guide (no room has one now)', () => {
    expect(rectTopSets(roomSolver, rect(4)).chaseClears).toBe(true);
    for (let k = 1; k <= 60; k++) expect(isClear(chaseShape(roomSolver, randomBoard(rect(4), k, 1 + (k % 9)), rect(4)).cells)).toBe(true);
    const g = buildGuide(roomSolver, { id: '4x4', shape: rect(4) });
    expect(g.kind).toBe('chase');
    expect(g.lesson.steps.map((x) => x.kind)).toEqual(['demo', 'demo', 'practice']);
  });

  /** the old way, by trying all 2^cols top-row sets: the reference the linear rectTopSets must match */
  const bruteTopSets = (shape: { cols: number; rows: number; mask: null }) => {
    const { cols, rows } = shape;
    const best = new Map<number, number[]>();
    let chaseClears = true;
    for (let t = 0; t < 1 << cols; t++) {
      const top = [...Array(cols).keys()].filter((c) => (t >> c) & 1);
      const left = chaseRect(roomSolver, pressAll(roomSolver, emptyCells(shape), top, shape), shape);
      let echo = 0;
      for (let c = 0; c < cols; c++) if (left[(rows - 1) * cols + c]) echo |= 1 << c;
      if (t && echo) chaseClears = false;
      const had = best.get(echo);
      if (!had || top.length < had.length) best.set(echo, top);
    }
    return { perLight: Array.from({ length: cols }, (_, c) => best.get(1 << c) ?? null), chaseClears };
  };

  test.each([[4, 4], [5, 5], [5, 6], [6, 6], [7, 7], [8, 8], [9, 9], [10, 10], [8, 16], [6, 16], [11, 7]])('%i×%i: the linear top-row sets match trying every top-row set', (cols, rows) => {
    const shape = { cols, rows, mask: null } as const;
    const { perLight, chaseClears } = rectTopSets(roomSolver, shape);
    expect({ perLight, chaseClears }).toEqual(bruteTopSets(shape));
  });

  test('a 20×30 custom board: its top-row sets take 20 chases, not 2^20 (well under 200 ms), and they clear their lights', () => {
    const shape = { cols: 20, rows: 30, mask: null } as const;
    const t0 = performance.now();
    const { perLight } = rectTopSets(roomSolver, shape);
    expect(performance.now() - t0).toBeLessThan(200);
    for (const [c, top] of perLight.entries()) {
      if (!top) continue;
      const b = pressAll(roomSolver, emptyCells(shape).map((_, i) => i === 29 * 20 + c), top, shape);
      expect(isClear(chaseRect(roomSolver, b, shape)), `light ${c}`).toBe(true);
    }
  });

  test('5×6 and 6×16: one bottom light → the top light straight above it (custom boards)', () => {
    for (const shape of [{ cols: 5, rows: 6, mask: null }, { cols: 6, rows: 16, mask: null }]) {
      const { perLight } = rectTopSets(roomSolver, shape as never);
      expect(perLight, `${shape.cols}×${shape.rows}`).toEqual([...Array(shape.cols).keys()].map((c) => [c]));
      expect(rectRule(perLight)).toBe('straightAbove');
    }
  });

  test('the 8×16 Tower: each bottom light has its own top lights, no short rule; H mirrors A, G mirrors B, and so on', () => {
    const { perLight } = rectTopSets(roomSolver, { cols: 8, rows: 16, mask: null });
    expect(letters(perLight)).toEqual(['CG', 'BDFH', 'ACG', 'B', 'G', 'BFH', 'ACEG', 'BF']);
    expect(rectRule(perLight)).toBeNull();
    for (let c = 0; c < 8; c++) expect(perLight[7 - c], `${c}`).toEqual(perLight[c]!.map((x) => 7 - x).sort((a, b) => a - b));
  });

  test('6×6: one bottom light → the top lights two to each side of it; A and F also the one above', () => {
    const rule = (c: number, n: number) => [c - 2, c, c + 2].filter((x) => x >= 0 && x < n && (x !== c || c === 0 || c === n - 1));
    expect(rectTopSets(roomSolver, rect(6)).perLight).toEqual([0, 1, 2, 3, 4, 5].map((c) => rule(c, 6)));
    expect(letters(rectTopSets(roomSolver, rect(6)).perLight)).toEqual(['AC', 'D', 'AE', 'BF', 'C', 'DF']);
    expect(rectRule(rectTopSets(roomSolver, rect(6)).perLight)).toBe('twoAside');
  });

  test('7×7: one bottom light → the three top lights above it, two at an edge', () => {
    expect(rectTopSets(roomSolver, rect(7)).perLight).toEqual([0, 1, 2, 3, 4, 5, 6].map((c) => [c - 1, c, c + 1].filter((x) => x >= 0 && x < 7)));
    expect(rectRule(rectTopSets(roomSolver, rect(7)).perLight)).toBe('threeAbove');
  });

  test('8×8: each bottom light has its own top taps, no short rule; H mirrors A, G mirrors B, and so on', () => {
    const { perLight } = rectTopSets(roomSolver, rect(8));
    expect(letters(perLight)).toEqual(['CE', 'BF', 'AG', 'H', 'A', 'BH', 'CG', 'DF']);
    expect(rectRule(perLight)).toBeNull();
    for (let c = 0; c < 8; c++) expect(perLight[7 - c], `${c}`).toEqual(perLight[c]!.map((x) => 7 - x).sort((a, b) => a - b));
  });

  test('10×10: one bottom light → the top light above it and two to each side; for A and J not the one above', () => {
    const { perLight } = rectTopSets(roomSolver, rect(10));
    expect(letters(perLight)).toEqual(['C', 'BD', 'ACE', 'BDF', 'CEG', 'DFH', 'EGI', 'FHJ', 'GI', 'H']);
    const rule = (c: number) => [c - 2, c, c + 2].filter((x) => x >= 0 && x < 10 && (x !== c || (c > 0 && c < 9)));
    expect(perLight).toEqual([...Array(10).keys()].map(rule));
    expect(rectRule(perLight)).toBe('aboveTwoAside');
  });

  test('several bottom lights: each one\'s top taps in turn (twice cancels), then a chase, clears every bottom row of every full rectangle', () => {
    for (const { id, shape } of RECTS) {
      const { cols, rows } = shape;
      const { perLight } = rectTopSets(roomSolver, shape as never);
      for (let p = 1; p < 1 << cols; p++) {
        const bottom = [...Array(cols).keys()].filter((c) => (p >> c) & 1);
        let b = emptyCells(shape).map((_, i) => i >= (rows - 1) * cols && bottom.includes(i - (rows - 1) * cols));
        for (const c of bottom) b = pressAll(roomSolver, b, perLight[c]!, shape);
        expect(isClear(chaseShape(roomSolver, b, shape).cells), `${id} ${bottom}`).toBe(true);
      }
    }
  });

  test('each full rectangle\'s guide says its own rule (the words follow the maths)', () => {
    const guides = (fixtureData.copy as { learn: { guides: Record<string, { steps: string[] }> } }).learn.guides;
    const SAYS: Record<string, RegExp[]> = {
      straightAbove: [/straight above/],
      threeAbove: [/three top lights above/],
      twoAside: [/two places left and right of it/, /also tap the one above/],
      aboveTwoAside: [/the top light above it and the ones two places left and right/, /skip the one above/],
      own: [/its own top lights/, /flipped left to right/],
    };
    for (const { id, shape } of RECTS) {
      const rule = rectRule(rectTopSets(roomSolver, shape as never).perLight) ?? 'own';
      const g = buildGuide(roomSolver, PACKS.find((p) => p.id === id)!);
      const k = g.lesson.steps.findIndex((x) => x.kind === 'lights');
      for (const re of SAYS[rule]!) expect(guides[id]!.steps[k], id).toMatch(re);
      // no other rule's words
      for (const [other, res] of Object.entries(SAYS)) if (other !== rule) expect(res.every((re) => re.test(guides[id]!.steps[k]!)), `${id} says ${other}`).toBe(false);
    }
  });

  test('Ring: lone end lights mostly can\'t be fixed from the top edge; Diamond: each takes 5–7 taps (no table to learn)', () => {
    const lone = (id: string) => {
      const fx = createFixer(roomSolver, ROOM[id]!);
      return fx.ends.map((e) => fx.fixFor(emptyCells(ROOM[id]!).map((_, i) => i === e))?.length ?? null);
    };
    expect(lone('ring').filter((x) => x === null).length).toBeGreaterThan(5);
    expect(lone('diamond').every((x) => x !== null && x >= 5 && x <= 7)).toBe(true);
  });
});

describe('learn: board guides', () => {
  const guideCopy = (fixtureData.copy as { learn: { guides: Record<string, { summary: string; steps: string[] }> } }).learn.guides;
  const bootRooms = (opts: Parameters<typeof bootModule>[1] = {}) => boot({ ...opts, services: { solver: roomSolver, ...opts.services }, state: { levels: levelsState(), ...opts.state } });
  const KIND: Record<string, string> = {
    '7x7': 'lights', ring: 'shapes', diamond: 'shapes', stuck: 'stuck', hex: 'hex', cube: 'cube', wired: 'wired', '8x8': 'lights', tower: 'lights',
  };

  test('each room gets the guide its maths (or, for a twist, its kind) calls for, with one sentence per step', () => {
    expect(Object.keys(KIND).sort()).toEqual(PACKS.map((p) => p.id).sort());
    for (const p of PACKS) {
      expect(guideKind(roomSolver, p), p.id).toBe(KIND[p.id]);
      const g = buildGuide(roomSolver, p);
      expect(g.lesson.steps).toHaveLength(GUIDE_STEPS[g.kind]);
      expect(guideCopy[p.id]!.steps).toHaveLength(g.lesson.steps.length);
      expect(g.lesson.steps.length).toBeLessThanOrEqual(5);
      expect(g.lesson.steps.at(-1)!.kind).toBe('practice');
      expect(g.lesson.steps.filter((s) => s.kind !== 'practice').length).toBeLessThanOrEqual(4);
    }
    // a stuck or wired room's pack is a plain grid: its kind, not its shape, picks the guide
    expect(guideKind(roomSolver, { kind: 'size', shape: ROOM.stuck! })).toBe('lights');
  });

  test.each(SQUARE.map((p) => p.id))('%s: every example sits on the real shape and every demo does what its words say', (id) => {
    const shape = ROOM[id]!;
    const g = buildGuide(roomSolver, PACKS.find((p) => p.id === id)!);
    const fx = createFixer(roomSolver, shape);
    g.lesson.steps.forEach((step, k) => {
      if (step.kind === 'demo') {
        const start = step.lit ? emptyCells(shape).map((_, i) => step.lit!.includes(i)) : pressAll(roomSolver, emptyCells(shape), step.from, shape);
        const play = step.play as number[];
        expect(fitsShape(shape, start)).toBe(true);
        expect(isClear(start)).toBe(false);
        expect(play.every((i) => cellIndexes(shape).includes(i))).toBe(true);
        expect(step.phases).toHaveLength(play.length);
        const end = pressAll(roomSolver, start, play, shape);
        // a chase-only demo (a lights guide's first, a shaped room's chase) stops with only end lights; every other ends dark
        if ((KIND[id] === 'lights' && k === 0) || (KIND[id] === 'shapes' && k === 1)) expect(onlyEnds(end, shape) && !isClear(end)).toBe(true);
        else expect(isClear(end), `${id} step ${k + 1}`).toBe(true);
        // a chase tap always goes under a lit light; top-edge taps are start cells
        let b = start;
        play.forEach((t, n) => {
          const phase = step.phases![n];
          if (phase === 'chase' || phase === 'chase2') expect(b[t - shape.cols], `${id} step ${k + 1} tap ${n + 1}`).toBe(true);
          if (phase === 'edge' || phase === 'top') expect(fx.starts).toContain(t);
          b = roomSolver.press(b, t, shape);
        });
      }
      if (step.kind === 'show') {
        // three real tap shapes, a plus first, each named for what it is
        expect(step.boards[0]!.caption).toBe('plus');
        expect(new Set(step.boards.map((b) => b.caption)).size).toBe(3);
        for (const b of step.boards) expect(footprint(shape, b.from[0]!)).toBe(b.caption);
      }
      if (step.kind === 'lights') {
        for (const r of step.rows) {
          const b = pressAll(roomSolver, emptyCells(shape).map((_, i) => i === r.bottom), r.top, shape);
          expect(isClear(chaseShape(roomSolver, b, shape).cells)).toBe(true);
        }
      }
    });
    if (KIND[id] === 'shapes') {
      const [, stuckStep, fixStep] = g.lesson.steps as Extract<(typeof g.lesson.steps)[number], { kind: 'demo' }>[];
      // no spotting step: levels are tangled, so the guide leads with chase and fix (decision 69)
      expect(g.lesson.steps.map((x) => x.kind)).toEqual(['show', 'demo', 'demo', 'practice']);
      expect(g.lesson.tangled).toBe(true);
      // the chase: spotting couldn't clear the board either; it stops with end lights ("n lights left, with nothing below")
      expect(spot(roomSolver, shape, pressAll(roomSolver, emptyCells(shape), stuckStep!.from, shape))).toBeNull();
      expect(stuckStep!.phases!.every((x) => x === 'chase')).toBe(true);
      expect(stuckStep!.end).toBe('stuckShape');
      // then from exactly what it left: one top-edge tap, chase again, all dark
      const left = pressAll(roomSolver, pressAll(roomSolver, emptyCells(shape), stuckStep!.from, shape), stuckStep!.play as number[], shape);
      expect(emptyCells(shape).map((_, i) => fixStep!.lit!.includes(i))).toEqual(left);
      expect(fixStep!.phases![0]).toBe('edge');
      expect(fixStep!.phases!.filter((x) => x === 'edge')).toHaveLength(1);
    }
  });

  test('the Learn list: Basics (the five lessons, unchanged) then Board guides, one tile per room with its picture and name', () => {
    const t = bootRooms();
    t.emit('learn:open', {});
    const sections = qa('[data-learn-section]');
    expect(sections.map((s) => s.dataset.learnSection)).toEqual(['basics', 'boards']);
    expect([...sections[0]!.querySelectorAll<HTMLElement>('[data-lesson-tile]')].map((e) => e.dataset.lesson)).toEqual(['shapes', 'order', 'chase', 'bottom-row', 'shortest']);
    const guides = [...sections[1]!.querySelectorAll<HTMLElement>('[data-lesson-tile]')];
    expect(guides.map((e) => e.dataset.lesson)).toEqual(PACKS.map((p) => `guide-${p.id}`));
    for (const [k, tile] of guides.entries()) {
      expect(tile.dataset.completed).toBe('false');
      expect(tile.querySelector('.room-glyph')).toBeTruthy();
      expect(tile.textContent).toContain(PACKS[k]!.name);
    }
    guides[3]!.click();
    expect(t.state('learn').lessonId).toBe(`guide-${PACKS[3]!.id}`);
  });

  test('without the rooms (no levels module) there are no guides, and opening one is refused', () => {
    const t = boot();
    t.emit('learn:open', {});
    expect(q('[data-learn-section="boards"]')).toBeNull();
    t.emit('learn:open', { lessonId: 'guide-ring' });
    expect(t.seen('learn:refused', { command: 'learn:open', reason: 'unknown_lesson' })).toBeTruthy();
  });

  test('a room with no guide copy, or copy that doesn\'t fit its board, gets no guide', () => {
    const copy = fixtureData.copy as { learn: { guides: Record<string, unknown> } };
    const { diamond: _gone, ...guides } = copy.learn.guides;
    const data = { ...fixtureData, copy: { ...copy, learn: { ...copy.learn, guides: { ...guides, ring: { summary: 'Ring', steps: ['Too short.'] } } } } };
    const t = bootRooms({ data: data as typeof fixtureData });
    t.emit('learn:open', {});
    expect(qa('[data-learn-section="boards"] [data-lesson-tile]').map((e) => e.dataset.lesson)).toEqual(PACKS.filter((p) => !['ring', 'diamond'].includes(p.id)).map((p) => `guide-${p.id}`));
    t.emit('learn:open', { lessonId: 'guide-ring' });
    expect(t.seen('learn:refused', { command: 'learn:open', reason: 'unknown_lesson' })).toBeTruthy();
  });

  test('a guide is drawn on its own shape: gaps keep their slot, empty, and are never cells or buttons', () => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: 'guide-ring' });
    const figs = qa('[data-mini-board="show"]');
    expect(figs).toHaveLength(3);
    for (const f of figs) {
      expect(f.querySelectorAll('[data-mini-cell]')).toHaveLength(40);
      expect(f.querySelectorAll('[data-gap]')).toHaveLength(9);
      expect(f.querySelectorAll('[data-gap][data-mini-cell], [data-gap] button')).toHaveLength(0);
      expect(f.querySelectorAll('[data-mark="true"]')).toHaveLength(1);
    }
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
    const board = q('[data-mini-board="practice"]')!;
    expect(board.querySelectorAll('button[data-mini-cell]')).toHaveLength(40);
    expect(board.querySelectorAll('button[data-gap]')).toHaveLength(0);
    t.emit('learn:press', { index: 24 }); // the hole
    expect(t.seen('learn:refused', { command: 'learn:press', reason: 'bad_index' })).toBeTruthy();
  });

  test.each(['ring', 'diamond', 'hex', 'cube', 'wired'])('%s practice is like its levels: every tap of the shortest answer overlaps another, none shows whole', (id) => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: `guide-${id}` });
    const g = buildGuide(roomSolver, PACKS.find((p) => p.id === id)!);
    for (let k = 1; k < g.lesson.steps.length; k++) t.emit('learn:step', { delta: 1 });
    const shape = g.lesson.shape!;
    for (let n = 0; n < 6; n++) {
      const start = t.state('learn').practice!.start;
      const answer = roomSolver.solve(start, shape)!;
      expect(answer.length, id).toBeGreaterThanOrEqual(2);
      expect(readableIn(shape, start, answer), `${id} board ${n}`).toBe(0);
      for (const a of answer) expect(answer.some((b) => b !== a && pressTargets(shape, a).some((x) => pressTargets(shape, b).includes(x))), `${id} tap ${a}`).toBe(true);
      t.emit('learn:new_practice', {});
    }
  });

  test.each(PACKS.map((p) => p.id))('%s practice: assist walks it to dark; solving completes the guide, is saved, and touches no stars', (id) => {
    const storage = createMemoryStorage();
    const t = bootRooms({ services: { storage } });
    t.emit('learn:open', { lessonId: `guide-${id}` });
    const g = buildGuide(roomSolver, PACKS.find((p) => p.id === id)!);
    for (let k = 1; k < g.lesson.steps.length; k++) t.emit('learn:step', { delta: 1 });
    const p = t.state('learn').practice!;
    const shape = g.lesson.shape!;
    expect(p.cells).toHaveLength(ROOM[id]!.cols * ROOM[id]!.rows);
    expect(fitsShape(shape, p.cells)).toBe(true);
    // solvable, and its answer never needs a stuck switch
    expect(refShapedSolve(shape, p.cells)!.every((i) => isPressable(shape, i))).toBe(true);
    t.emit('learn:set_assist', { on: true });
    for (let k = 0; k < 120 && t.state('learn').practice!.status === 'playing'; k++) {
      const s = t.state('learn').practice!.suggest!;
      expect(isPressable(shape, s)).toBe(true);
      expect(q(`[data-mini-board="practice"] [data-mini-cell][data-index="${s}"]`)!.dataset.suggest).toBe('true');
      t.emit('learn:press', { index: s });
    }
    expect(t.state('learn').practice!.status).toBe('solved');
    expect(t.seen('learn:practice_solved', { lessonId: `guide-${id}` })).toBeTruthy();
    expect(t.seen('learn:lesson_completed', { lessonId: `guide-${id}` })).toBeTruthy();
    expect(t.events().some((e) => e.type.startsWith('progress:') || e.type.startsWith('board:'))).toBe(false);
    expect((storage.get('learn') as { completed: string[] }).completed).toEqual([`guide-${id}`]);
    const again = bootRooms({ services: { storage } });
    again.emit('learn:open', {});
    expect(q(`[data-lesson-tile][data-lesson="guide-${id}"]`)!.dataset.completed).toBe('true');
  });

  test('the lights step: the top row over the bottom row; a bottom light picks, its top lights to tap are ringed and lettered', () => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: 'guide-7x7' });
    t.emit('learn:step', { delta: 1 });
    const letters = qa('[data-action="learn-strip"]');
    expect(letters.map((e) => e.dataset.letter).join('')).toBe('ABCDEFG');
    expect(letters.every((e) => e.tagName === 'BUTTON')).toBe(true);
    expect(letters[3]!.getAttribute('aria-pressed')).toBe('true');
    expect(letters[3]!.dataset.lit).toBe('true');
    // each light is read aloud with its top lights to tap (the maths: the three above, two at an edge)
    expect(letters.map((e) => e.getAttribute('aria-label'))).toEqual([
      'Bottom light A: tap A and B', 'Bottom light B: tap A, B and C', 'Bottom light C: tap B, C and D', 'Bottom light D: tap C, D and E',
      'Bottom light E: tap D, E and F', 'Bottom light F: tap E, F and G', 'Bottom light G: tap F and G']);
    // no board on this step (a tall board's two ends never fit at once): the top strip sits over the bottom strip
    expect(q('[data-mini-board]')).toBeNull();
    const ringed = () => qa('[data-lights-top] [data-suggest="true"]').map((e) => `${e.dataset.index}${e.dataset.letter}`);
    expect(ringed()).toEqual(['2C', '3D', '4E']);
    expect(q('[data-learn-line="demo"]')!.textContent).toBe('Bottom light D: tap C, D and E');
    letters[6]!.click();
    expect(letters[6]!.getAttribute('aria-pressed')).toBe('true');
    expect(letters[3]!.dataset.lit).toBe('false');
    expect(ringed()).toEqual(['5F', '6G']);
    expect(q('[data-learn-line="demo"]')!.textContent).toBe('Bottom light G: tap F and G');
  });

  test('every room in the data has a guide; the retired rooms\' guides are gone', () => {
    expect(Object.keys(guideCopy).sort()).toEqual(PACKS.map((p) => p.id).sort());
    for (const gone of ['4x4', '5x6', '6x6', '10x10', 'cross']) expect(guideCopy[gone], gone).toBeUndefined();
  });

  test.each(['tower', '8x8'])('%s: the several-lights demo starts from two bottom lights', (id) => {
    const shape = ROOM[id]!;
    const g = buildGuide(roomSolver, PACKS.find((p) => p.id === id)!);
    const several = g.lesson.steps[2] as Extract<(typeof g.lesson.steps)[number], { kind: 'demo' }>;
    expect(several.lit).toHaveLength(2);
    expect(several.lit!.every((i) => i >= (shape.rows - 1) * shape.cols)).toBe(true);
  });

  test.each(['7x7', '8x8', 'tower'])('%s practice always needs the bottom-row step: a chase alone never clears it', (id) => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: `guide-${id}` });
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
    for (let k = 0; k < 20; k++) {
      const cells = t.state('learn').practice!.cells;
      expect(isClear(chaseShape(roomSolver, cells, ROOM[id]!).cells), `${id} board ${k}`).toBe(false);
      t.emit('learn:new_practice', {});
    }
  });

  test('the lights step on 8×8 and the Tower: bottom lights A–H, each with its own top lights (H is A mirrored)', () => {
    for (const id of ['8x8', 'tower']) {
      const t = bootRooms();
      t.emit('learn:open', { lessonId: `guide-${id}` });
      t.emit('learn:step', { delta: 1 });
      const letters = qa('[data-action="learn-strip"]');
      expect(letters.map((e) => e.dataset.letter).join(''), id).toBe('ABCDEFGH');
      const taps = letters.map((e) => e.getAttribute('aria-label')!.split('tap ')[1]);
      if (id === '8x8') expect(taps).toEqual(['C and E', 'B and F', 'A and G', 'H', 'A', 'B and H', 'C and G', 'D and F']);
      letters[7]!.click();
      const shape = ROOM[id]!;
      const top = qa('[data-lights-top] [data-suggest="true"]').map((e) => Number(e.dataset.index));
      // tapping them, then chasing, clears a board whose only light is bottom H
      const start = emptyCells(shape).map((_, i) => i === shape.cols * shape.rows - 1);
      expect(isClear(chaseShape(roomSolver, pressAll(roomSolver, start, top, shape), shape).cells), id).toBe(true);
    }
  });

  describe('practice input on big boards', () => {
    const rect = (x: number, y: number, w: number, h: number) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect;
    /** lays the practice board out like a browser would: `slot` px per light, no padding */
    const layOut = (id: string, slot: number) => {
      const { cols, rows } = ROOM[id]!;
      const board = q('[data-mini-board="practice"]')!;
      board.getBoundingClientRect = () => rect(0, 0, cols * slot, rows * slot);
      board.querySelectorAll<HTMLElement>('[data-mini-cell]').forEach((el) => {
        const i = Number(el.dataset.index);
        el.getBoundingClientRect = () => rect((i % cols) * slot, Math.floor(i / cols) * slot, slot - 4, slot - 4);
      });
      const at = (i: number) => ({ x: (i % cols) * slot + slot / 2, y: Math.floor(i / cols) * slot + slot / 2 });
      const fire = (type: string, i: number, dx = 0, dy = 0) => {
        const { x, y } = at(i);
        board.querySelector(`[data-mini-cell][data-index="${i}"]`)!.dispatchEvent(new PointerEvent(type, { clientX: x + dx, clientY: y + dy, pointerId: 1, isPrimary: true, button: 0, bubbles: true, cancelable: true }));
      };
      return { board, fire };
    };
    const atPractice = (id: string) => {
      const t = bootRooms();
      t.emit('learn:open', { lessonId: `guide-${id}` });
      for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
      return t;
    };
    const moves = (t: ReturnType<typeof boot>) => t.state('learn').practice!.moves;

    test('8×8 with lights under the tap minimum: hold shows the aim bubble, sliding moves it, lifting presses; a keyboard click still presses', () => {
      const t = atPractice('8x8');
      const { fire } = layOut('8x8', 30);
      const before = t.state('learn').practice!.cells;
      fire('pointerdown', 0);
      expect(moves(t)).toBe(0);
      const bubble = q('[data-aim-bubble]')!;
      expect(bubble.dataset.open).toBe('true');
      expect(q('[data-mini-board="practice"] [data-aimed="true"]')!.dataset.index).toBe('0');
      fire('pointermove', 0, 30, 0); // one light to the right
      expect(q('[data-mini-board="practice"] [data-aimed="true"]')!.dataset.index).toBe('1');
      fire('pointerup', 0, 30, 0);
      expect(t.seen('learn:press')).toEqual({ index: 1 });
      expect(moves(t)).toBe(1);
      expect(t.state('learn').practice!.cells).toEqual(roomSolver.press(before, 1, ROOM['8x8']!));
      expect(bubble.dataset.open).toBe('false');
      // the click that follows a lift presses nothing more; a keyboard click (detail 0) does
      q('[data-mini-board="practice"] [data-index="1"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      expect(moves(t)).toBe(1);
      q('[data-mini-board="practice"] [data-index="5"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
      expect(moves(t)).toBe(2);
      // lifting off the board presses nothing
      fire('pointerdown', 0);
      fire('pointermove', 0, -200, -200);
      fire('pointerup', 0, -200, -200);
      expect(moves(t)).toBe(2);
    });

    test('the aim tip shows only after a drag or a miss, and gives way again after a clean tap', () => {
      const t = atPractice('8x8');
      const { board, fire } = layOut('8x8', 30);
      setAttrForTest(board, 'data-aim', 'true');
      const line = () => q('[data-learn-line="practice"]')!.textContent;
      const tip = 'Small lights: hold one, slide to aim, lift to tap.';
      expect(line()).not.toBe(tip);
      fire('pointerdown', 0); fire('pointerup', 0); // a clean tap
      expect(line()).not.toBe(tip);
      fire('pointerdown', 0); fire('pointermove', 0, 30, 0); fire('pointerup', 0, 30, 0); // a drag
      expect(line()).toBe(tip);
      fire('pointerdown', 5); fire('pointerup', 5);
      expect(line()).not.toBe(tip);
      fire('pointerdown', 0); fire('pointermove', 0, -200, -200); fire('pointerup', 0, -200, -200); // a miss
      expect(line()).toBe(tip);
      expect(moves(t)).toBe(3);
    });

    test('8×8 with full-size lights presses on pointerdown, no bubble', () => {
      const t = atPractice('8x8');
      const { fire } = layOut('8x8', 50);
      fire('pointerdown', 9);
      expect(moves(t)).toBe(1);
      expect(q('[data-aim-bubble]')).toBeNull();
    });

    test('the Tower scrolls with the page: a tap presses when lifted, a swipe never presses', () => {
      const t = atPractice('tower');
      const { board, fire } = layOut('tower', 56);
      expect(board.dataset.tall).toBe('true');
      expect(q('.learn-stage--practice')!.dataset.tall).toBe('true');
      fire('pointerdown', 37);
      expect(moves(t)).toBe(0);
      fire('pointerup', 37);
      expect(t.seen('learn:press')).toEqual({ index: 37 });
      expect(moves(t)).toBe(1);
      fire('pointerdown', 52);
      fire('pointermove', 52, 0, -60);
      fire('pointerup', 52, 0, -60);
      expect(moves(t)).toBe(1);
      expect(q('[data-aim-bubble]')).toBeNull();
    });
  });

  test('opened from a level, Back and Done go straight back there', () => {
    const t = bootRooms({ state: { nav: { screen: 'play', sheet: null, previous: 'home' } } });
    t.emit('learn:open', { lessonId: 'guide-7x7' });
    expect(q('[data-action="learn-back"]')!.getAttribute('aria-label')).toBe('Back');
    q('[data-action="learn-back"]')!.click();
    expect(t.seen('nav:back')).toEqual({});
    const before = t.all('nav:back').length;
    for (let k = 0; k < 4; k++) t.emit('learn:step', { delta: 1 });
    expect(t.all('nav:back')).toHaveLength(before + 1);
    expect(t.state('learn').lessonId).toBeNull();
    expect(t.state('learn').completed).toContain('guide-7x7');
  });
});

describe('learn: the Patterns panel on room boards', () => {
  /** a level of this room on the board, with the level's own shape (a stuck or wired level adds its switches) */
  const boardOn = (id: string, cells: Cells) => ({ status: 'playing' as const, levelId: PACKS.find((p) => p.id === id)!.first, start: cells, cells, par: 3, moves: 0, history: [], shape: levelShape(PACKS.find((p) => p.id === id)!) });
  const bootPanel = (id: string, cells: Cells) => boot({ services: { solver: roomSolver }, state: { levels: levelsState(), board: boardOn(id, cells) } });
  const flush = (t: ReturnType<typeof boot>) => t.emit('learn:set_assist', { on: false });

  test.each(['ring', 'diamond'])('%s: chase by row, then the board picture with the top-edge fix ringed; following it clears the board', (id) => {
    const shape = ROOM[id]!;
    const fx = createFixer(roomSolver, shape);
    let seed = 1;
    while (isClear(chaseShape(roomSolver, randomBoard(shape, seed, 5), shape).cells)) seed++;
    let cells = randomBoard(shape, seed, 5);
    const t = bootPanel(id, cells);
    const root = t.view!.region('slot:reference').querySelector<HTMLElement>('[data-reference]')!;
    const status = root.querySelector<HTMLElement>('[data-reference-status]')!;
    const picture = root.querySelector<HTMLElement>('[data-reference-shape]')!;
    expect(root.dataset.referenceKind).toBe('shaped');
    // chasing: the row of the first light with a cell below it
    for (let n = 0; n < 60 && !onlyEnds(cells, shape); n++) {
      const next = chaseShape(roomSolver, cells, shape).taps[0]!;
      expect(status.textContent).toBe(`Row ${Math.floor(next / shape.cols)}: tap under each lit light.`);
      expect(picture.hidden).toBe(true);
      cells = roomSolver.press(cells, next, shape);
      t.kernel.seed('board', boardOn(id, cells));
      flush(t);
    }
    // only end lights: the picture, lit like the board, the fix ringed
    const fix = fx.fixFor(cells)!;
    expect(picture.hidden).toBe(false);
    expect(status.textContent).toMatch(/^Tap the ringed top-edge light/);
    expect(picture.querySelectorAll('[data-mini-cell]')).toHaveLength(cellIndexes(shape).length);
    expect([...picture.querySelectorAll<HTMLElement>('[data-suggest="true"]')].map((e) => Number(e.dataset.index))).toEqual(fix);
    expect([...picture.querySelectorAll<HTMLElement>('[data-lit="true"]')].map((e) => Number(e.dataset.index))).toEqual(cellIndexes(shape).filter((i) => cells[i]));
    // tap the ringed ones (the panel keeps the rest ringed), then chase: dark
    for (const [k, f] of fix.entries()) {
      cells = roomSolver.press(cells, f, shape);
      t.kernel.seed('board', boardOn(id, cells));
      flush(t);
      if (k < fix.length - 1) expect([...picture.querySelectorAll<HTMLElement>('[data-suggest="true"]')].map((e) => Number(e.dataset.index))).toEqual(fix.slice(k + 1));
    }
    expect(isClear(chaseShape(roomSolver, cells, shape).cells)).toBe(true);
    expect(document.querySelectorAll('[data-cell]')).toHaveLength(0); // never the main board
  });

  /** the rule line's words by the rule the maths finds (none: each light its own) */
  const RULE_LINE: Record<string, RegExp> = { straightAbove: /straight above it/, threeAbove: /three top lights above it/, own: /has its own top lights to tap/ };
  test.each(PACKS.filter((p) => p.kind === 'size').map((p) => p.id))('%s: the rule line from the maths, the live bottom row while chasing, then the top taps under it; following them clears the board', (id) => {
    const shape = ROOM[id]!;
    const { cols, rows } = shape;
    const { perLight } = rectTopSets(roomSolver, shape as never);
    const ruleLine = RULE_LINE[rectRule(perLight) ?? 'own']!;
    let seed = 1;
    while (isClear(chaseShape(roomSolver, randomBoard(shape, seed, 6), shape).cells)) seed++;
    let cells = randomBoard(shape, seed, 6);
    const t = bootPanel(id, cells);
    const root = t.view!.region('slot:reference').querySelector<HTMLElement>('[data-reference]')!;
    const status = root.querySelector<HTMLElement>('[data-reference-status]')!;
    const taps = () => [...root.querySelectorAll<HTMLElement>('.reference__rect .learn-row--top [data-letter]')].map((e) => e.dataset.letter).join('');
    const liveLit = () => [...root.querySelectorAll<HTMLElement>('[data-reference-bottom] [data-mini-cell]')].flatMap((e) => (e.dataset.lit === 'true' ? [Number(e.dataset.index)] : []));
    const bottomLit = () => [...Array(cols).keys()].map((c) => (rows - 1) * cols + c).filter((i) => cells[i]);
    expect(root.dataset.referenceKind).toBe('rect');
    expect(root.querySelector('[data-reference-rule]')!.textContent).toMatch(ruleLine);
    expect(root.querySelectorAll('[data-reference-bottom]')).toHaveLength(1);
    expect(root.querySelectorAll('[data-reference-bottom] [data-mini-cell]')).toHaveLength(cols);
    // chasing: the row to work on, and the board's bottom row as it is now (on the Tower it is far below)
    for (let n = 0; n < 400 && !onlyEnds(cells, shape); n++) {
      const next = chaseShape(roomSolver, cells, shape).taps[0]!;
      expect(status.textContent).toBe(`Row ${Math.floor(next / cols)}: tap under each lit light.`);
      expect(liveLit()).toEqual(bottomLit());
      expect(taps()).toBe('');
      cells = roomSolver.press(cells, next, shape);
      t.kernel.seed('board', boardOn(id, cells));
      flush(t);
    }
    // bottom-row time: the top taps the maths gives for this row, lettered
    const want = rectTaps(perLight, bottomLit().map((i) => i % cols))!;
    expect(liveLit()).toEqual(bottomLit());
    expect(taps()).toBe(want.map((c) => 'ABCDEFGHIJ'[c]).join(''));
    for (const [k, c] of want.entries()) {
      cells = roomSolver.press(cells, c, shape);
      t.kernel.seed('board', boardOn(id, cells));
      flush(t);
      if (k < want.length - 1) expect(taps()).toBe(want.map((x) => 'ABCDEFGHIJ'[x]).join(''));
    }
    expect(isClear(chaseShape(roomSolver, cells, shape).cells)).toBe(true);
    expect(document.querySelectorAll('[data-cell]')).toHaveLength(0); // never the main board
  });

  test('room boards link to their guide; classic keeps "All lessons"', () => {
    const t = bootPanel('ring', randomBoard(ROOM.ring!, 2));
    const panel = t.view!.region('slot:reference');
    const guide = panel.querySelector<HTMLElement>('[data-action="guide"]')!;
    expect(guide.hidden).toBe(false);
    expect(panel.querySelector<HTMLElement>('[data-action="learn"]')!.hidden).toBe(true);
    guide.click();
    expect(t.seen('learn:open')).toEqual({ lessonId: 'guide-ring' });
    expect(t.state('learn').lessonId).toBe('guide-ring');

    t.kernel.seed('board', boardOn('8x8', randomBoard(ROOM['8x8']!, 2)));
    flush(t);
    expect(panel.querySelector<HTMLElement>('[data-reference]')!.dataset.referenceKind).toBe('rect');
    panel.querySelector<HTMLElement>('[data-action="guide"]')!.click();
    expect(t.seen('learn:open')).toEqual({ lessonId: 'guide-8x8' });

    t.kernel.seed('board', { status: 'playing', levelId: 3, start: lit([12]), cells: lit([12]), par: 1, moves: 0, history: [] });
    flush(t);
    expect(panel.querySelector<HTMLElement>('[data-action="guide"]')!.hidden).toBe(true);
    expect(panel.querySelector<HTMLElement>('[data-action="learn"]')!.hidden).toBe(false);
  });
});

describe('learn: guide copy', () => {
  test('short and plain: at most 4 steps plus practice, 2 sentences and ~26 words a step, and no 5×5-only words', () => {
    const guides = (fixtureData.copy as { learn: { guides: Record<string, { summary: string; steps: string[] }> } }).learn.guides;
    for (const [id, g] of Object.entries(guides)) {
      expect(g.steps.length, id).toBeLessThanOrEqual(5);
      for (const step of g.steps) {
        expect(step.split(/\s+/).length, step).toBeLessThanOrEqual(26);
        expect(sentences(step), step).toBeLessThanOrEqual(2);
        expect(step, id).not.toMatch(/echo/i);
      }
    }
  });
});

describe('learn: first-time-player review', () => {
  const bootRooms = (opts: Parameters<typeof bootModule>[1] = {}) => boot({ ...opts, services: { solver: roomSolver, ...opts.services }, state: { levels: levelsState(), ...opts.state } });
  const line = (kind: 'demo' | 'practice') => q(`[data-learn-line="${kind}"]`)!.textContent;
  const playToEnd = () => {
    const button = q('[data-action="learn-demo"]')!;
    for (let k = 0; k < 200 && button.textContent !== 'Replay'; k++) button.click();
  };
  const RECTS = PACKS.filter((p) => p.kind === 'size').map((p) => p.id);

  test('a demo that stops with lights on says how many are left; "All dark." only when it is', () => {
    const t = bootRooms();
    for (const id of RECTS) {
      t.emit('learn:open', { lessonId: `guide-${id}` });
      playToEnd();
      const left = qa('[data-mini-board="demo"] [data-lit="true"]').length;
      expect(left, id).toBeGreaterThan(0);
      expect(line('demo'), id).toBe(`${left} ${left === 1 ? 'light' : 'lights'} left in the bottom row.`);
    }
    t.emit('learn:open', { lessonId: 'chase' });
    t.emit('learn:step', { delta: 1 });
    t.emit('learn:step', { delta: 1 });
    playToEnd();
    expect(line('demo')).toBe('3 lights left in the bottom row: the chase can\'t reach them.');
    t.emit('learn:open', { lessonId: 'order' });
    playToEnd();
    expect(line('demo')).toBe('Back to the start: the taps cancelled.');
    t.emit('learn:open', { lessonId: 'guide-ring' });
    t.emit('learn:step', { delta: 1 });
    playToEnd();
    expect(line('demo')).toMatch(/^\d+ lights? left, with nothing below to chase them\.$/);
    t.emit('learn:step', { delta: 1 });
    playToEnd();
    expect(line('demo')).toBe('All dark.');
  });

  test('phase lines read "Phase: tap n of N"; a top light tapped a second time says it cancels', () => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: 'guide-7x7' });
    expect(line('demo')).toMatch(/^Chase down: tap 1 of \d+$/);
    const several = buildGuide(roomSolver, PACKS.find((p) => p.id === '7x7')!).lesson.steps[2] as unknown as { play: number[]; phases: (string | null)[] };
    const play = several.play;
    const again = play.findIndex((tap, k) => several.phases[k] === 'top' && play.slice(0, k).includes(tap));
    expect(again).toBeGreaterThan(0);
    t.emit('learn:step', { delta: 1 });
    t.emit('learn:step', { delta: 1 });
    expect(line('demo')).toBe('Top row: tap 1 of ' + play.length);
    const button = q('[data-action="learn-demo"]')!;
    for (let k = 0; k < again; k++) button.click();
    expect(line('demo')).toBe(`${'ABCDEFG'[play[again]! % 7]} again: it cancels.`);
  });

  test('rectangle guides put the column letters over every demo and the size in the eyebrow; other guides just the step', () => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: 'guide-7x7' });
    expect(q('.screen-header .eyebrow')!.textContent).toBe('7×7 · Step 1 of 4');
    expect(qa('.learn-picker--static .learn-pick').map((e) => e.textContent).join('')).toBe('ABCDEFG');
    t.emit('learn:step', { delta: 1 });
    t.emit('learn:step', { delta: 1 });
    expect(qa('.learn-picker--static .learn-pick').map((e) => e.textContent).join('')).toBe('ABCDEFG');
    t.emit('learn:open', { lessonId: 'guide-ring' });
    expect(q('.screen-header .eyebrow')!.textContent).toBe('Step 1 of 4');
    // a stuck room's grid is a full rectangle, but its guide is not a bottom-row one: no size, no letters
    t.emit('learn:open', { lessonId: 'guide-stuck' });
    expect(q('.screen-header .eyebrow')!.textContent).toBe('Step 1 of 4');
    t.emit('learn:step', { delta: 1 });
    expect(qa('.learn-picker--static')).toHaveLength(0);
    t.emit('learn:open', { lessonId: 'bottom-row' });
    t.emit('learn:step', { delta: 1 });
    expect(qa('.learn-picker--static .learn-pick').map((e) => e.textContent).join('')).toBe('ABCDE');
  });

  test('shaped rooms: while a top-edge tap is next, every top-edge light is outlined and the one used is dotted', () => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: 'guide-ring' });
    for (let k = 0; k < 2; k++) t.emit('learn:step', { delta: 1 });
    const outlined = qa('[data-mini-board="demo"] [data-ring="true"]').map((e) => Number(e.dataset.index));
    expect(outlined).toEqual(startCells(ROOM['ring']!));
    expect(line('demo')).toMatch(/^Top-edge light: tap 1 of/);
    const dot = qa('[data-mini-board="demo"] [data-mark="true"]').map((e) => Number(e.dataset.index));
    expect(dot).toHaveLength(1);
    expect(outlined).toContain(dot[0]);
    q('[data-action="learn-demo"]')!.click();
    expect(qa('[data-mini-board="demo"] [data-ring="true"]')).toHaveLength(0);
  });

  test.each(RECTS)('%s practice: a short first chase leaves one or two bottom lights; the line follows chase → bottom lights → chase again', (id) => {
    const shape = ROOM[id]!;
    const fx = createFixer(roomSolver, shape);
    const t = bootRooms();
    t.emit('learn:open', { lessonId: `guide-${id}` });
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
    for (let n = 0; n < 8; n++) {
      const start = t.state('learn').practice!.cells;
      const c1 = chaseShape(roomSolver, start, shape);
      expect(c1.taps.length, `${id} first chase`).toBeLessThanOrEqual(2 * shape.cols);
      expect(roomSolver.isSolvable(start, shape)).toBe(true);
      const left = cellIndexes(shape).filter((i) => c1.cells[i]);
      expect(left.length).toBeGreaterThanOrEqual(1);
      expect(left.length).toBeLessThanOrEqual(2);
      expect(left.every((i) => i >= (shape.rows - 1) * shape.cols)).toBe(true);
      expect(line('practice')).toBe('Chase: tap under each lit light.');
      for (const i of c1.taps) t.emit('learn:press', { index: i });
      const fix = fx.fixFor(c1.cells)!;
      const L = (i: number) => 'ABCDEFGHIJ'[i % shape.cols];
      const list = (xs: number[]) => (xs.length < 2 ? L(xs[0]!) : `${xs.slice(0, -1).map(L).join(', ')} and ${L(xs.at(-1)!)}`);
      const bottom = `${left.length > 1 ? 'Bottom lights' : 'Bottom light'} ${list(left)}: tap ${list(fix)}, then chase again.`;
      expect(line('practice')).toBe(bottom);
      t.emit('learn:press', { index: fix[0]! });
      expect(line('practice')).toBe(fix.length > 1 ? bottom : 'Chase again.');
      for (const i of fix.slice(1)) t.emit('learn:press', { index: i });
      expect(line('practice')).toBe('Chase again.');
      for (const i of chaseShape(roomSolver, t.state('learn').practice!.cells, shape).taps) t.emit('learn:press', { index: i });
      expect(t.state('learn').practice!.status).toBe('solved');
      t.emit('learn:new_practice', {});
    }
  });

  test('lesson 2 practice: two or three shapes that never touch, so spotting whole shapes clears every board', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'order' });
    t.emit('learn:step', { delta: 1 });
    t.emit('learn:step', { delta: 1 });
    const classic = { cols: 5, rows: 5, mask: null };
    for (let n = 0; n < 30; n++) {
      const taps = spot(roomSolver, classic, t.state('learn').practice!.cells);
      expect(taps, `board ${n}`).not.toBeNull();
      expect(taps!.length).toBeGreaterThanOrEqual(2);
      expect(taps!.length).toBeLessThanOrEqual(3);
      t.emit('learn:new_practice', {});
    }
  });

  test('lesson 2 step 2: each Replay taps the same three lights in another order, always to dark; every tap to come is dotted', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'order' });
    t.emit('learn:step', { delta: 1 });
    expect(qa('[data-mini-board="demo"] [data-mark="true"]').map((e) => Number(e.dataset.index))).toEqual([0, 13, 21]);
    const firstTaps: number[] = [];
    const dots = () => qa('[data-mini-board="demo"] [data-mark="true"]').map((e) => Number(e.dataset.index));
    for (let round = 0; round < 3; round++) {
      q('[data-action="learn-demo"]')!.click();
      firstTaps.push([0, 13, 21].find((i) => !dots().includes(i))!);
      playToEnd();
      expect(line('demo')).toBe('All dark.');
      q('[data-action="learn-demo"]')!.click(); // Replay: the next order
    }
    expect(new Set(firstTaps).size).toBe(3);
  });

  test('lesson 1 practice: a wrong tap says "tap it again to undo it"; undoing clears the line', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'shapes' });
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
    const answer = solver.solve(t.state('learn').practice!.cells)![0]!;
    const wrong = answer === 0 ? 24 : 0;
    t.emit('learn:press', { index: wrong });
    expect(line('practice')).toBe('Not that one. Tap it again to undo it.');
    t.emit('learn:press', { index: wrong });
    expect(line('practice')).toBe('');
    t.emit('learn:press', { index: answer });
    expect(t.state('learn').practice!.status).toBe('solved');
  });

  test('lesson 5 has Assist: it rings a shortest answer, so following it solves at par', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'shortest' });
    for (let k = 0; k < 4; k++) t.emit('learn:step', { delta: 1 }); // past the A·C·E demo, the four fixes and the Restart move
    expect(q('[data-action="learn-assist"]')).not.toBeNull();
    t.emit('learn:set_assist', { on: true });
    const par = solver.solve(t.state('learn').practice!.start)!.length;
    for (let k = 0; k < 30 && t.state('learn').practice!.status === 'playing'; k++) t.emit('learn:press', { index: t.state('learn').practice!.suggest! });
    expect(t.state('learn').practice!.moves).toBe(par);
  });

  test('lesson 5: chasing counts every tap it makes (none dotted); A·C·E then a chase is all dark; then B·D\'s four fixes and their taps', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'shortest' });
    const caps = () => qa('.learn-caption').map((e) => e.textContent);
    const boards = qa('[data-mini-board="show"]');
    // the chasing board: no dots, and its count is every tap the method makes (a light tapped twice counts twice)
    expect(boards[0]!.querySelectorAll('[data-mark="true"]')).toHaveLength(0);
    let b = pressAll(solver, blank(), [0, 4, 12, 20, 24]);
    let taps = 0;
    const tab = bottomRowTable(solver);
    for (; taps < 60 && !isClear(b); taps++) {
      const c = chaseSuggest(b) ?? tab.find((e) => e.bottom.join() === bottomColumns(b).join())!.top[0]!;
      b = solver.press(b, c);
    }
    expect(caps()[0]).toBe(`Chasing: ${taps} taps`);
    expect(taps).toBeGreaterThan(9);
    expect(caps()[1]).toBe('Shortest: 5 taps');
    // A·C·E, then the chase: dark again
    t.emit('learn:step', { delta: 1 });
    expect(t.instance!.debug!()).toMatchObject({ demo: { demoAt: 0 } });
    expect(isClear(pressAll(solver, blank(), [0, 2, 4, 5, 7, 9, 15, 17, 19, 20, 22, 24]))).toBe(true);
    // four fixes for B·D, each with its letters and every tap it takes
    t.emit('learn:step', { delta: 1 });
    expect(qa('[data-mini-board="show"]')).toHaveLength(4);
    expect(caps()).toEqual(['A and D: 15 taps', 'C, D and E: 11 taps', 'A, B and C: 11 taps', 'B and E: 15 taps']);
  });

  test('lesson 5, the Restart move: the fix that lands on par first, then one chase; all dark in par taps', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'shortest' });
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
    expect(q('.learn-text')!.textContent).toMatch(/^For par: chase once to find your row, then Restart\./);
    const button = q('[data-action="learn-demo"]')!;
    const lines: string[] = [q('[data-learn-line="demo"]')!.textContent!];
    for (let k = 0; k < 20 && button.textContent !== 'Replay'; k++) { button.click(); lines.push(q('[data-learn-line="demo"]')!.textContent!); }
    const par = solver.solve(pressAll(solver, blank(), [0, 4, 12, 20, 24]))!.length;
    expect(lines.at(-1)).toBe(`All dark in ${par} taps: that's par.`);
    expect(lines.filter((l) => l.startsWith('Top row'))).toHaveLength(2); // A and E
    expect(lines.filter((l) => /^Chase/.test(l))).toHaveLength(par - 2);
  });

  test('the Restart button (lesson 5 practice): the same board from its start, taps back to 0, even once solved', () => {
    const t = boot();
    t.emit('learn:restart_practice', {});
    expect(t.seen('learn:refused', { command: 'learn:restart_practice', reason: 'no_practice' })).toBeTruthy();
    t.emit('learn:open', { lessonId: 'shortest' });
    for (let k = 0; k < 4; k++) t.emit('learn:step', { delta: 1 });
    const start = t.state('learn').practice!.start;
    const answer = solver.solve(start)!;
    t.emit('learn:press', { index: answer[0]! });
    expect(t.state('learn').practice!.moves).toBe(1);
    q('[data-action="learn-restart"]')!.click();
    expect(t.state('learn').practice).toMatchObject({ cells: start, start, moves: 0, status: 'playing' });
    for (const i of answer) t.emit('learn:press', { index: i });
    expect(t.state('learn').practice!.status).toBe('solved');
    t.emit('learn:restart_practice', {});
    expect(t.state('learn').practice).toMatchObject({ cells: start, moves: 0, status: 'playing' });
    // other lessons have no Restart button
    t.emit('learn:open', { lessonId: 'chase' });
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
    expect(q('[data-action="learn-restart"]')).toBeNull();
  });

  test('a tap on a demo board steps it (and pauses an auto-play)', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'chase' });
    t.emit('learn:step', { delta: 1 });
    expect(t.instance!.debug!()).toMatchObject({ demo: { demoAt: 0 } });
    q('[data-mini-board="demo"]')!.click();
    expect(t.instance!.debug!()).toMatchObject({ demo: { demoAt: 1 } });
    expect(q('[data-action="learn-demo"]')!.textContent).toBe('Next tap');
  });

  test('copy: no "Stuck" lead-ins (Stuck is a board) and no screws (the stuck switch is a plate)', () => {
    const learnCopy = JSON.stringify((fixtureData.copy as { learn: unknown }).learn);
    expect(learnCopy).not.toMatch(/Stuck[?:]/);
    expect(learnCopy).not.toMatch(/screw/i);
  });

  test('copy: the shared words (no "top taps", no "two to each side"), one practice-line pattern', () => {
    const c = (fixtureData.copy as { learn: { lessons: Record<string, { steps: string[] }>; guides: Record<string, { steps: string[]; summary: string }> } }).learn;
    const all = [...Object.values(c.lessons).flatMap((l) => l.steps), ...Object.values(c.guides).flatMap((g) => [...g.steps, g.summary])];
    for (const x of all) {
      expect(x).not.toMatch(/top taps|two to each side|the echo's top light/);
    }
    for (const id of RECTS) expect(c.guides[id]!.steps.at(-1)).toMatch(/^Your turn: .*Need help\? Assist rings the next tap\.$/);
  });
});

describe('learn: the twist guides (Hex, Cube, Wired, Stuck)', () => {
  const bootRooms = (opts: Parameters<typeof bootModule>[1] = {}) => boot({ ...opts, services: { solver: roomSolver, ...opts.services }, state: { levels: levelsState(), ...opts.state } });
  const pack = (id: string) => PACKS.find((p) => p.id === id)!;
  const guideOf = (id: string) => buildGuide(roomSolver, pack(id));
  type Demo = Extract<Step, { kind: 'demo' }>;
  type Show = Extract<Step, { kind: 'show' }>;
  const demos = (id: string) => guideOf(id).lesson.steps.filter((s): s is Demo => s.kind === 'demo');
  const shows = (id: string) => guideOf(id).lesson.steps.filter((s): s is Show => s.kind === 'show');
  const startOf = (shape: Shape, s: { from: number[]; lit?: number[] }) =>
    (s.lit ? emptyCells(shape).map((_, i) => s.lit!.includes(i)) : pressAll(roomSolver, emptyCells(shape), s.from, shape));
  const litOf = (cells: Cells) => cells.flatMap((on, i) => (on ? [i] : []));
  const captions = (fixtureData.copy as { learn: { captions: Record<string, string> } }).learn.captions;
  const STEPS: Record<string, string[]> = {
    hex: ['show', 'show', 'demo', 'practice'], cube: ['show', 'show', 'demo', 'practice'],
    wired: ['show', 'show', 'demo', 'practice'], stuck: ['show', 'demo', 'demo', 'practice'],
  };

  test.each(TWIST_IDS)('%s: every picture and demo sits on the board, demos end dark, no tap is ever on a stuck switch', (id) => {
    const g = guideOf(id);
    const shape = g.lesson.shape!;
    expect(g.lesson.steps.map((s) => s.kind)).toEqual(STEPS[id]);
    expect(g.lesson.pool!.every((i) => isPressable(shape, i))).toBe(true);
    for (const step of g.lesson.steps) {
      if (step.kind === 'show') {
        for (const b of step.boards) {
          const cells = startOf(shape, b);
          expect(fitsShape(shape, cells)).toBe(true);
          expect(isClear(cells)).toBe(false);
          expect(b.from.every((i) => isPressable(shape, i))).toBe(true);
          expect(captions[b.caption!], b.caption).toBeTruthy();
        }
      }
      if (step.kind === 'demo') {
        const start = startOf(shape, step);
        const play = step.play as number[];
        expect(fitsShape(shape, start)).toBe(true);
        expect(isClear(start)).toBe(false);
        expect(play.every((i) => isPressable(shape, i))).toBe(true);
        expect(step.phases).toHaveLength(play.length);
        expect(isClear(pressAll(roomSolver, start, play, shape)), `${id} demo`).toBe(true);
      }
    }
  });

  /** a "side by side" demo: two touching taps that are the board's whole shortest answer; both centres start dark,
   *  two arcs of three lights (the shared lights cancel), and after the first tap the second shape shows whole */
  const expectSideBySide = (shape: Shape, step: Extract<Step, { kind: 'demo' }>) => {
    const start = startOf(shape, step);
    const [a, b] = step.play as number[];
    expect(step.play).toHaveLength(2);
    expect(step.phases).toEqual(['pair', 'pair']);
    expect(pressTargets(shape, a!)).toContain(b);
    expect([...step.from].sort((x, y) => x - y)).toEqual(refShapedSolve(shape, start));
    expect(start[a!] || start[b!]).toBe(false);
    expect(litOf(start)).toHaveLength(6);
    const after = roomSolver.press(start, a!, shape);
    expect(litOf(after).sort((x, y) => x - y)).toEqual([...pressTargets(shape, b!)].sort((x, y) => x - y));
  };

  test('Hex: a flower of seven, then fewer at the edge; two flowers sharing two lights; two side by side, as in levels', () => {
    const shape = guideOf('hex').lesson.shape!;
    expect(shape).toEqual(ROOM.hex);
    const [one, two] = shows('hex');
    expect(one!.boards.map((b) => b.caption)).toEqual(['hexMiddle', 'hexEdge']);
    expect(pressTargets(shape, one!.boards[0]!.from[0]!)).toHaveLength(7);
    expect(pressTargets(shape, one!.boards[1]!.from[0]!).length).toBeLessThan(7);
    const [a, b] = two!.boards[0]!.from;
    const both = pressTargets(shape, a!).filter((x) => pressTargets(shape, b!).includes(x));
    expect(both).toHaveLength(2);
    expect(two!.boards[0]!.ring).toEqual(both);
    // the shared lights are dark, both centres lit
    const cells = startOf(shape, two!.boards[0]!);
    expect(both.every((x) => !cells[x]) && cells[a!] && cells[b!]).toBe(true);
    expectSideBySide(shape, demos('hex')[0]!);
    expect(guideOf('hex').lesson.tangled).toBe(true);
  });

  test('Cube: on the net, a face\'s middle flips a plain plus; a front corner\'s plus reaches three faces; two side by side', () => {
    const shape = guideOf('cube').lesson.shape!;
    expect(shape).toEqual(cubeShape(3));
    const faces = (i: number) => new Set(pressTargets(shape, i).map((t) => cellFace(3, t)!.face.id));
    const [one, two] = shows('cube');
    expect(faces(one!.boards[0]!.from[0]!).size).toBe(1);
    expect(faces(two!.boards[0]!.from[0]!).size).toBe(3);
    expect(cellFace(3, two!.boards[0]!.from[0]!)!.face.id).toBe('front');
    const [pair] = demos('cube');
    expectSideBySide(shape, pair!);
    for (const t of pair!.play as number[]) expect(cellFace(3, t)!.face.id).toBe('front');
  });

  test('Wired: a fixed gentle wiring with one answer per board; three switches, a light\'s switches outlined, then work back from the lit lights', () => {
    const shape = guideOf('wired').lesson.shape!;
    expect(shape.wires).toEqual(guideWiring(ROOM.wired!));
    expect(pressRank(shape)).toBe(25);
    const [three, reach] = shows('wired');
    expect(new Set(three!.boards.map((b) => b.caption)).size).toBe(3);
    for (const b of three!.boards) expect(litOf(startOf(shape, b)).sort((x, y) => x - y)).toEqual([...pressTargets(shape, b.from[0]!)].sort((x, y) => x - y));
    const light = reach!.boards[0]!.lit![0]!;
    expect(reach!.boards[0]!.ring).toEqual(reachers(shape, light));
    expect(reach!.boards[0]!.ring).toContain(light);
    for (const s of reach!.boards[0]!.ring!) expect(pressTargets(shape, s)).toContain(light);
    // each tap outlines the switches that reach one of the lights it clears
    const [back] = demos('wired');
    let b = startOf(shape, back!);
    (back!.play as number[]).forEach((t, k) => {
      const ring = back!.rings![k]!;
      expect(ring).toContain(t);
      expect(pressTargets(shape, t).some((x) => b[x] && reachers(shape, x).join() === ring.join())).toBe(true);
      b = roomSolver.press(b, t, shape);
    });
    expect(back!.phases!.every((p) => p === 'back')).toBe(true);
  });

  test('Stuck: two plates apart; a tap beside one flips it; a chase runs through a lit stuck light; a light over a plate needs the top-edge fix', () => {
    const g = guideOf('stuck');
    const shape = g.lesson.shape!;
    const stuck = shape.stuck!;
    expect(stuck).toEqual(guideStuck(ROOM.stuck!));
    expect(stuck.length).toBeGreaterThanOrEqual(2);
    for (const s of stuck) expect(touching(shape, s)).toHaveLength(4);
    expect(stuck.every((s, k) => stuck.slice(k + 1).every((o) => !touching(shape, s).includes(o)))).toBe(true);
    expect(g.lesson).toMatchObject({ assist: 'fix', coach: 'shape' });
    // 1. a tap beside a plate: the plate's light flips
    const fig = shows('stuck')[0]!.boards[0]!;
    const near = stuck.find((s) => touching(shape, s).includes(fig.from[0]!))!;
    expect(near).toBeDefined();
    expect(startOf(shape, fig)[near]).toBe(true);
    // 2. a plain chase that taps under a lit stuck light
    const [through, round] = demos('stuck');
    let b = startOf(shape, through!);
    let under = false;
    for (const t of through!.play as number[]) {
      expect(b[t - shape.cols]).toBe(true);
      if (isStuck(shape, t - shape.cols)) under = true;
      b = roomSolver.press(b, t, shape);
    }
    expect(under).toBe(true);
    // 3. chase → one top-edge tap → chase again; the first chase leaves a light over a screw
    const phases = round!.phases!;
    expect(phases.filter((p) => p === 'edge')).toHaveLength(1);
    const edge = phases.indexOf('edge');
    expect(phases.slice(0, edge).every((p) => p === 'chase') && phases.slice(edge + 1).every((p) => p === 'chase2')).toBe(true);
    const left = pressAll(roomSolver, startOf(shape, round!), (round!.play as number[]).slice(0, edge), shape);
    expect(stuck.some((s) => left[s - shape.cols])).toBe(true);
    expect(startCells(shape)).toContain((round!.play as number[])[edge]);
  });

  test('mini boards draw each grid as the play board does: a honeycomb, the cube\'s six faces, spokes, screws', () => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: 'guide-hex' });
    const hex = q('[data-mini-board="show"]')!;
    expect(hex.dataset.miniGrid).toBe('hex');
    expect(hex.querySelectorAll('[data-mini-cell]')).toHaveLength(cellIndexes(ROOM.hex!).length);
    expect(hex.querySelectorAll('[data-gap]')).toHaveLength(0);
    // two half-columns per light, odd rows half a light right, trimmed to the lights the hexagon uses
    const cells = [...hex.querySelectorAll<HTMLElement>('[data-mini-cell]')];
    for (const c of cells) expect(c.style.gridColumn).toMatch(/^\d+ \/ span 2$/);
    const first = (i: number) => Number(hex.querySelector<HTMLElement>(`[data-index="${i}"]`)!.style.gridColumn.split(' ')[0]);
    const cols = ROOM.hex!.cols;
    expect(Math.min(...cells.map((c) => first(Number(c.dataset.index))))).toBe(1);
    expect(first(3 * cols + 1) - first(3 * cols)).toBe(2); // neighbours in a row: a light apart
    expect(first(2 * cols + 1) - first(3 * cols)).toBe(1); // row 3 (odd) sits half a light right of row 2
    expect(hex.querySelector<HTMLElement>(`[data-index="${3 * cols}"]`)!.style.gridRow).toBe('4');

    t.emit('learn:open', { lessonId: 'guide-cube' });
    const net = q('[data-mini-board="show"]')!;
    expect(net.dataset.miniGrid).toBe('cube');
    expect(net.querySelectorAll('[data-mini-cell]')).toHaveLength(54);
    expect(net.querySelectorAll('.mini-face')).toHaveLength(6);
    expect(net.querySelectorAll('[data-gap]')).toHaveLength(0);
    // a seam track after every face: the up face's first light (net column 3) sits in grid column 5
    expect(net.querySelector<HTMLElement>('[data-index="3"]')!.style.gridColumn).toBe('5');

    t.emit('learn:open', { lessonId: 'guide-wired' });
    const wires = guideWiring(ROOM.wired!);
    for (const board of qa('[data-mini-board="show"]')) {
      for (const cell of board.querySelectorAll<HTMLElement>('[data-mini-cell]')) {
        const bits = wires[Number(cell.dataset.index)]!;
        expect(cell.querySelectorAll('.cell__wires .cell__pad')).toHaveLength(bits.toString(2).replace(/0/g, '').length);
      }
    }

    t.emit('learn:open', { lessonId: 'guide-stuck' });
    const screws = qa('[data-mini-board="show"] [data-stuck="true"]');
    expect(screws.map((e) => Number(e.dataset.index))).toEqual(guideStuck(ROOM.stuck!));
    expect(screws.every((e) => e.querySelector('.cell__stuck'))).toBe(true);
  });

  test('Stuck practice: a stuck switch only shakes; a press on it is refused and counts nothing; the coach line follows chase → top-edge fix', () => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: 'guide-stuck' });
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
    const g = guideOf('stuck');
    const shape = g.lesson.shape!;
    const s = shape.stuck![0]!;
    const before = t.state('learn').practice!;
    const cell = q(`[data-mini-board="practice"] [data-index="${s}"]`)!;
    expect(cell.dataset.stuck).toBe('true');
    expect(cell.getAttribute('aria-label')).toMatch(/stuck/);
    cell.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    expect(cell.hasAttribute('data-jam')).toBe(true);
    expect(t.all('learn:press')).toHaveLength(0);
    t.emit('learn:press', { index: s });
    expect(t.seen('learn:refused', { command: 'learn:press', reason: 'stuck' })).toBeTruthy();
    expect(t.state('learn').practice).toEqual(before);
    // the coach: chase, then (lights left over the bottom and the screws) the top-edge fix, then chase again
    const line = () => q('[data-learn-line="practice"]')!.textContent;
    for (let n = 0; n < 6; n++) {
      const cells = t.state('learn').practice!.cells;
      const c1 = chaseShape(roomSolver, cells, shape);
      if (!c1.taps.length || isClear(c1.cells)) { t.emit('learn:new_practice', {}); continue; }
      expect(line()).toBe('Chase: tap under each lit light.');
      for (const i of c1.taps) t.emit('learn:press', { index: i });
      expect(line()).toMatch(/^Left over: tap the top-edge lights? Assist rings, then chase again\.$/);
      return;
    }
    throw new Error('no practice board needed the fix');
  });

  test.each(['hex', 'cube', 'wired'])('%s practice: Assist rings the shortest answer in spotting order, so following it solves at par', (id) => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: `guide-${id}` });
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
    t.emit('learn:set_assist', { on: true });
    for (let n = 0; n < 5; n++) {
      const shape = guideOf(id).lesson.shape!;
      const start = t.state('learn').practice!.start;
      const par = refShapedSolve(shape, start)!.length;
      expect(t.state('learn').practice!.suggest).toBe(spotOrder(roomSolver, shape, start)![0]);
      for (let k = 0; k < 30 && t.state('learn').practice!.status === 'playing'; k++) t.emit('learn:press', { index: t.state('learn').practice!.suggest! });
      expect(t.state('learn').practice).toMatchObject({ status: 'solved', moves: par });
      t.emit('learn:new_practice', {});
    }
  });

  describe('the Patterns panel on a twist board: the room\'s tip and its guide (stuck switches: chase and the ringed fix)', () => {
    const tips = (fixtureData.copy as { learn: { reference: { tips: Record<string, string> } } }).learn.reference.tips;
    const boardOn = (id: string, cells: Cells, levelId = pack(id).first) => ({ status: 'playing' as const, levelId, start: cells, cells, par: 3, moves: 0, history: [], shape: levelShape(pack(id)) });

    test.each(TWIST_IDS.filter((id) => id !== 'stuck'))('%s', (id) => {
      const shape = levelShape(pack(id));
      const t = boot({ services: { solver: roomSolver }, state: { levels: levelsState(), board: boardOn(id, randomBoard(shape, 3, 5)) } });
      const root = t.view!.region('slot:reference').querySelector<HTMLElement>('[data-reference]')!;
      const status = root.querySelector<HTMLElement>('[data-reference-status]')!;
      expect(root.dataset.referenceKind).toBe(id);
      expect(status.textContent).toBe(tips[id]);
      expect(status.dataset.referenceStatus).toBe('tip');
      expect(status.dataset.tone).toBe('coach');
      expect(root.querySelector<HTMLElement>('[data-reference-rule]')!.hidden).toBe(true);
      expect(root.querySelector<HTMLElement>('.reference__body')!.hidden).toBe(true);
      const guide = root.querySelector<HTMLElement>('[data-action="guide"]')!;
      expect(guide.hidden).toBe(false);
      guide.click();
      expect(t.seen('learn:open')).toEqual({ lessonId: `guide-${id}` });
      expect(document.querySelectorAll('[data-cell]')).toHaveLength(0); // never the main board
      // solved: the usual line
      t.kernel.seed('board', { ...boardOn(id, emptyCells(shape)), status: 'solved' });
      t.emit('learn:set_assist', { on: false });
      expect(status.textContent).toBe('All dark. Solved.');
    });

    test('a custom board with a twist links to that twist\'s guide', () => {
      const t = boot({ services: { solver: roomSolver }, state: { levels: levelsState(), board: boardOn('hex', randomBoard(ROOM.hex!, 4, 4), CUSTOM_LEVEL_ID) } });
      const root = t.view!.region('slot:reference').querySelector<HTMLElement>('[data-reference]')!;
      expect(root.dataset.referenceKind).toBe('hex');
      root.querySelector<HTMLElement>('[data-action="guide"]')!.click();
      expect(t.seen('learn:open')).toEqual({ lessonId: 'guide-hex' });
    });

    test('stuck: chase advice by row, then a picture of the board with its plates and the top-edge fix ringed; the guide link', () => {
      const shape = levelShape(pack('stuck'));
      const fx = createFixer(roomSolver, shape);
      // a board whose chase leaves lights over a plate: one start tap and two more, fixed by one top-edge tap
      const dark = emptyCells(shape);
      const from = [fx.starts[2]!, 2 * shape.cols + 2, 3 * shape.cols + 4].filter((i) => isPressable(shape, i));
      const start = pressAll(roomSolver, dark, from, shape);
      const t = boot({ services: { solver: roomSolver }, state: { levels: levelsState(), board: boardOn('stuck', start) } });
      const root = t.view!.region('slot:reference').querySelector<HTMLElement>('[data-reference]')!;
      const status = root.querySelector<HTMLElement>('[data-reference-status]')!;
      expect(root.dataset.referenceKind).toBe('stuck');
      expect(status.dataset.referenceStatus).toBe('chase');
      expect(status.textContent).toMatch(/^Row \d+: tap under each lit light\.$/);
      const left = chaseShape(roomSolver, start, shape).cells;
      t.kernel.seed('board', boardOn('stuck', left));
      t.emit('learn:set_assist', { on: false });
      const fix = fx.fixFor(left);
      if (fix) {
        expect(status.dataset.referenceStatus).toBe('match');
        const ringed = [...root.querySelectorAll<HTMLElement>('[data-reference-shape] [data-suggest="true"]')].map((e) => Number(e.dataset.index));
        expect(ringed).toEqual(fix);
        expect(root.querySelectorAll('[data-reference-shape] [data-stuck="true"] .cell__stuck')).toHaveLength(shape.stuck!.length);
      } else {
        expect(isClear(left)).toBe(true);
      }
      expect(root.querySelector<HTMLElement>('[data-action="guide"]')!.hidden).toBe(false);
      expect(document.querySelectorAll('[data-cell]')).toHaveLength(0); // never the main board
    });

    test('board kinds: a honeycomb or a cube by its grid, else wiring, else stuck switches', () => {
      expect(kindOf(ROOM.hex)).toBe('hex');
      expect(kindOf(ROOM.cube)).toBe('cube');
      expect(kindOf(levelShape(pack('wired')))).toBe('wired');
      expect(kindOf(levelShape(pack('stuck')))).toBe('stuck');
      expect(kindOf({ ...ROOM.hex!, stuck: [24] })).toBe('hex');
      expect(kindOf(ROOM.stuck)).toBe('rect');
      // custom square boards with a twist get the tip, never the bottom-row reading
      expect(kindOf({ cols: 20, rows: 30, mask: null, stuck: [45, 300] })).toBe('stuck');
      expect(kindOf({ cols: 20, rows: 30, mask: null, wires: new Array(600).fill(WIRINGS.cross) })).toBe('wired');
      expect(kindOf({ cols: 20, rows: 30, mask: null })).toBe('rect');
    });

    test('a board wider than tall is read sideways: chase column by column, then the right column and its left-column taps', () => {
      const shape: Shape = { cols: 9, rows: 5, mask: null };
      const advise = createAdvisor(roomSolver, bottomRowTable(solver), {
        start: 's', chase: 'Row {row}', match: 'm', progress: 'p', clear: 'c', nomatch: 'n', rectBottom: 'rb', rectMatch: 'rm',
        shapedFix: 'f', shapedProgress: 'fp', shapedNomatch: 'fn', chaseSide: 'Column {col}', sideMatch: 'side match', sideProgress: 'side progress', sideBottom: 'side none',
      });
      // a light in column 3 (row 2): chase it rightwards
      const one = emptyCells(shape).map((_, i) => i === 2 * 9 + 2);
      expect(advise({ status: 'playing', cells: one, shape })).toMatchObject({ status: 'chase', text: 'Column 3' });
      // chased all the way: only the right column is left; its left-column taps, then a chase rightwards, clear it
      const right = emptyCells(shape).map((_, i) => i % 9 === 8 && (i === 8 || i === 3 * 9 + 8));
      const a = advise({ status: 'playing', cells: right, shape });
      expect(a).toMatchObject({ status: 'match', text: 'side match', rect: { bottom: [0, 3] } });
      let b = right;
      for (const r of a.rect!.taps) b = roomSolver.press(b, r * 9, shape);
      for (let c = 0; c < 8; c++) for (let r = 0; r < 5; r++) if (b[r * 9 + c]) b = roomSolver.press(b, r * 9 + c + 1, shape);
      expect(isClear(b)).toBe(true);
      // in the panel: "Your column", numbered taps, the rule says sideways
      const cells = right;
      const t = boot({ services: { solver: roomSolver }, state: { levels: levelsState(), board: { status: 'playing' as const, levelId: CUSTOM_LEVEL_ID, start: cells, cells, par: 9, moves: 0, history: [], shape } } });
      const root = t.view!.region('slot:reference').querySelector<HTMLElement>('[data-reference]')!;
      expect(root.querySelector('.reference__rect .caption')!.textContent).toBe('Your column');
      expect([...root.querySelectorAll<HTMLElement>('[data-reference-bottom] [data-mini-cell]')].map((e) => e.dataset.lit)).toEqual(['true', 'false', 'false', 'true', 'false']);
      expect([...root.querySelectorAll<HTMLElement>('.reference__rect .learn-row--top [data-suggest="true"]')].map((e) => e.dataset.letter)).toEqual(a.rect!.taps.map((r) => String(r + 1)));
      expect(root.querySelector('[data-reference-rule]')!.textContent).toMatch(/^Chase sideways\./);
    });

    test('a 20×30 custom board opens in the panel at once: rect reading by its rows; with stuck switches, the tip', () => {
      const shape: Shape = { cols: 20, rows: 30, mask: null };
      const cells = emptyCells(shape).map((_, i) => i === 21 || i === 599);
      const custom = (s: Shape) => ({ status: 'playing' as const, levelId: CUSTOM_LEVEL_ID, start: cells, cells, par: 9, moves: 0, history: [], shape: s });
      const t0 = performance.now();
      const t = boot({ services: { solver: roomSolver }, state: { levels: levelsState(), board: custom(shape) } });
      const root = t.view!.region('slot:reference').querySelector<HTMLElement>('[data-reference]')!;
      expect(root.dataset.referenceKind).toBe('rect');
      expect(root.querySelector('[data-reference-status]')!.textContent).toBe('Row 2: tap under each lit light.');
      expect(root.querySelector('[data-reference-rule]')!.textContent).not.toBe('');
      expect(performance.now() - t0).toBeLessThan(1000);
      t.kernel.seed('board', custom({ ...shape, stuck: [45, 300] }));
      t.emit('learn:set_assist', { on: false });
      expect(root.dataset.referenceKind).toBe('stuck');
      expect(root.querySelector('[data-reference-status]')!.textContent).toBe(tips.stuck);
    });
  });
});
