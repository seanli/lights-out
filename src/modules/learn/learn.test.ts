// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import type { Cells, LevelDef, LevelsState, Pack, Shape, SolverService } from '../../contracts';
import { createMemoryStorage, bootModule, fixtureData } from '../../../test/fake-ctx';
import { refPress, refSolve } from '../../../test/ref-solver';
import { cellIndexes, emptyCells, fitsShape, parseShape, pressTargets } from '../../lib/shape';
import learn from './index';
import { BOTTOM, blank, bottomColumns, bottomRowTable, chase, chaseRect, chaseShape, chaseSuggest, clearsBottom, createFixer, echoOf, echoOfSet, echoRows, endCells, fixFor, fixSuggest, isClear, lit, methodTaps, onlyBottom, onlyEnds, pressAll, quietPatterns, rectRule, rectTaps, rectTopSets, startCells } from './method';
import { RULES } from './lessons';
import { buildGuide, footprint, guideKind, spot } from './guides';
import { createAdvisor, kindOf } from './reference';
import { answer, emptySave, finished, nextCard, planRound, type Round } from './drill';

const solver: SolverService = {
  press: (cells, i) => refPress(cells, i),
  solve: (cells) => refSolve(cells),
  isSolvable: (cells) => refSolve(cells) !== null,
};

/** independent reference for any shape: presses from the geometry, BigInt elimination, then the lightest solution */
function refShapedSolve(shape: Shape, cells: readonly boolean[]): number[] | null {
  const vars = cellIndexes(shape);
  if (!fitsShape(shape, cells)) return null;
  const n = vars.length, B = BigInt(n);
  const pos = new Map(vars.map((g, j) => [g, j]));
  const rows = vars.map((g) => pressTargets(shape, g).reduce((row, t) => row | (1n << BigInt(pos.get(t)!)), cells[g] ? 1n << B : 0n));
  const pivots: number[] = [];
  for (let col = 0; col < n; col++) {
    const bit = 1n << BigInt(col), rank = pivots.length;
    const p = rows.findIndex((row, i) => i >= rank && (row & bit) !== 0n);
    if (p < 0) continue;
    [rows[rank], rows[p]] = [rows[p]!, rows[rank]!];
    for (let r = 0; r < n; r++) if (r !== rank && rows[r]! & bit) rows[r]! ^= rows[rank]!;
    pivots.push(col);
  }
  for (let r = pivots.length; r < n; r++) if (rows[r]! >> B) return null;
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
type RoomData = { id: string; kind: 'size' | 'shape'; cols?: number; rows?: number; picture?: string[]; idBase: number; bands: unknown[] };
const ROOM_DATA = (fixtureData.rules as { levels: { rooms: RoomData[] } }).levels.rooms;
const ROOM_NAMES = (fixtureData.copy as { levels: { rooms: Record<string, string> } }).levels.rooms;
const roomShape = (r: RoomData): Shape => (r.picture ? parseShape(r.picture) : { cols: r.cols!, rows: r.rows!, mask: null });
const PACKS: Pack[] = ROOM_DATA.map((r) => ({ id: r.id, name: ROOM_NAMES[r.id]!, kind: r.kind, shape: roomShape(r), first: r.idBase + 1, count: r.bands.length * 10 }));
const ROOM = Object.fromEntries(PACKS.map((p) => [p.id, p.shape])) as Record<string, Shape>;
/** a levels slice with the classic pack and every room, one level per room (enough for the panel's pack lookup) */
const levelsState = (): LevelsState => ({
  status: 'ready', chapters: [],
  packs: [{ id: 'classic', name: 'Classic', kind: 'classic', shape: { cols: 5, rows: 5, mask: null }, first: 1, count: 50 }, ...PACKS],
  list: PACKS.map((p): LevelDef => ({ id: p.first, cells: emptyCells(p.shape), par: 1, pack: p.id, index: 1, shape: p.shape })),
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
    expect(q('[data-learn-line="demo"]')!.textContent).toBe("D's echo");
    expect(q('[data-action="learn-echo"][data-col="3"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  test('"Go deeper" opens the extra lesson from the last step only; it is not in the list and never counts as a lesson', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'bottom-row' });
    expect(q('[data-action="learn-deeper"]')).toBeNull();
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
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
        expect(step.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length, step).toBeLessThanOrEqual(2);
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

  test('with no board: the static table and the chase line, status chase', () => {
    const t = boot();
    expect(panel(t).querySelectorAll('[data-reference]')).toHaveLength(1);
    expect(panel(t).querySelectorAll('[data-pattern-row]')).toHaveLength(7);
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

  test('the matching row gets its echo and rule as one line, and is scrolled into view', () => {
    const calls: string[] = [];
    const proto = HTMLElement.prototype as unknown as { scrollIntoView: (o?: unknown) => void };
    const original = proto.scrollIntoView;
    proto.scrollIntoView = function (this: HTMLElement) { calls.push(this.closest('[data-pattern-row]')?.getAttribute('data-pattern') ?? ''); };
    try {
      const cells = lit([0, 1, 2].map((c) => BOTTOM + c));
      const t = boot({ state: { board: boardState(cells) } });
      const rule = panel(t).querySelector<HTMLElement>('[data-reference-rule]')!;
      expect(rule.hidden).toBe(false);
      expect(rule.textContent).toBe('Echo of B');
      expect([...panel(t).querySelectorAll<HTMLElement>('[data-match="true"] [data-letter]')].map((e) => e.dataset.letter)).toEqual(['B']);
      expect(calls).toEqual(['0,1,2']);
      t.kernel.seed('board', boardState(lit([BOTTOM + 1, BOTTOM + 3])));
      t.emit('learn:set_assist', { on: false });
      expect(rule.textContent).toBe('Echo of A + D');
      expect(calls).toEqual(['0,1,2', '1,3']);
      t.kernel.seed('board', boardState(pressAll(solver, blank(), [12])));
      t.emit('learn:set_assist', { on: false });
      expect(rule.hidden).toBe(true);
    } finally {
      proto.scrollIntoView = original;
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
    const lines = { chaseClears: '{cols}×{rows} chase', straightAbove: 'straight', threeAbove: 'three', twoAside: 'two aside', aboveTwoAside: 'above + two aside', ownTaps: 'own' };
    expect(advise.rectLine(rect(4) as never, lines)).toBe('4×4 chase');
    expect(advise.rectLine(ROOM['5x6']!, lines)).toBe('straight');
    expect(advise.rectLine(ROOM.tower!, lines)).toBe('straight');
    expect(advise.rectLine(rect(6) as never, lines)).toBe('two aside');
    expect(advise.rectLine(rect(7) as never, lines)).toBe('three');
    expect(advise.rectLine(rect(8) as never, lines)).toBe('own');
    expect(advise.rectLine(rect(10) as never, lines)).toBe('above + two aside');
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
  const ROOM_IDS = PACKS.map((p) => p.id);

  test('start cells have nothing above, end cells nothing below', () => {
    expect(startCells({ cols: 4, rows: 4, mask: null })).toEqual([0, 1, 2, 3]);
    expect(endCells({ cols: 4, rows: 4, mask: null })).toEqual([12, 13, 14, 15]);
    expect([startCells(ROOM.cross!).length, endCells(ROOM.cross!).length]).toEqual([7, 7]);
    expect([startCells(ROOM.ring!).length, endCells(ROOM.ring!).length]).toEqual([10, 10]);
    expect([startCells(ROOM.diamond!).length, endCells(ROOM.diamond!).length]).toEqual([7, 7]);
    // the Ring's row above the hole collects lights; the row under it starts them
    expect(endCells(ROOM.ring!)).toEqual(expect.arrayContaining([9, 10, 11]));
    expect(startCells(ROOM.ring!)).toEqual(expect.arrayContaining([37, 38, 39]));
  });

  test('classic and full rectangles keep their chase: the any-shape chase gives the same taps and board', () => {
    const classic = { cols: 5, rows: 5, mask: null };
    for (let k = 1; k <= 40; k++) {
      const b = randomBoard(classic, k, 7);
      expect(chaseShape(roomSolver, b, classic)).toEqual(chase(solver, b));
    }
    // the fewest start taps on 5×5 are as short as the bottom-row table's top taps
    for (const e of bottomRowTable(solver)) expect(fixFor(roomSolver, classic, lit(e.bottom.map((c) => BOTTOM + c)))!.length).toBe(e.top.length);
  });

  test.each(ROOM_IDS)('%s: a chase leaves lights only on end cells; chase → fix → chase clears random boards', (id) => {
    const shape = ROOM[id]!;
    const fx = createFixer(roomSolver, shape);
    for (let k = 1; k <= 80; k++) {
      const board = randomBoard(shape, k, 2 + (k % 12));
      const c1 = chaseShape(roomSolver, board, shape);
      expect(onlyEnds(c1.cells, shape)).toBe(true);
      if (isClear(c1.cells)) continue;
      const fix = fx.fixFor(c1.cells);
      expect(fix, `${id} board ${k}`).not.toBeNull();
      expect(fix!.every((i) => fx.starts.includes(i))).toBe(true);
      expect(isClear(chaseShape(roomSolver, pressAll(roomSolver, c1.cells, fix!, shape), shape).cells), `${id} board ${k}`).toBe(true);
    }
  });

  test.each(ROOM_IDS)('%s: the fix is the fewest start taps (checked against every smaller set)', (id) => {
    const shape = ROOM[id]!;
    const fx = createFixer(roomSolver, shape);
    const leaves = (set: number[]) => chaseShape(roomSolver, pressAll(roomSolver, emptyCells(shape), set, shape), shape).cells.join();
    for (let k = 1; k <= 12; k++) {
      const left = chaseShape(roomSolver, randomBoard(shape, k * 7, 6), shape).cells;
      const fix = fx.fixFor(left);
      if (!fix) continue;
      for (let m = 0; m < 1 << fx.starts.length; m++) {
        const set = fx.starts.filter((_, b) => (m >> b) & 1);
        if (set.length < fix.length) expect(leaves(set)).not.toBe(left.join());
      }
    }
  });

  test.each(ROOM_IDS)('%s: the assist (chase → fix → chase, from the board alone) reaches dark', (id) => {
    const shape = ROOM[id]!;
    const fx = createFixer(roomSolver, shape);
    for (let k = 1; k <= 25; k++) {
      let b = randomBoard(shape, k * 13, 3 + (k % 8));
      for (let n = 0; n < 200 && !isClear(b); n++) b = roomSolver.press(b, fixSuggest(fx, b, shape)!, shape);
      expect(isClear(b), `${id} board ${k}`).toBe(true);
    }
  });
});

describe('learn: what the board guides say (proved from the solver)', () => {
  const rect = (n: number) => ({ cols: n, rows: n, mask: null });
  const letters = (sets: (number[] | null)[]) => sets.map((x) => (x ? x.map((c) => 'ABCDEFGHIJ'[c]).join('') : '-'));
  /** every full rectangle in the frozen data (5×6, 6×6, 7×7, 8×8, 10×10, the Tower) */
  const RECTS = PACKS.filter((p) => !p.shape.mask);

  test('a chase alone clears every solvable 4×4 board, so such a board would get the short chase guide (no room has one now)', () => {
    expect(rectTopSets(roomSolver, rect(4)).chaseClears).toBe(true);
    for (let k = 1; k <= 60; k++) expect(isClear(chaseShape(roomSolver, randomBoard(rect(4), k, 1 + (k % 9)), rect(4)).cells)).toBe(true);
    const g = buildGuide(roomSolver, { id: '4x4', shape: rect(4) });
    expect(g.kind).toBe('chase');
    expect(g.lesson.steps.map((x) => x.kind)).toEqual(['demo', 'demo', 'practice']);
  });

  test('5×6 and the Tower: one bottom light → the top light straight above it', () => {
    for (const id of ['5x6', 'tower']) {
      const { perLight } = rectTopSets(roomSolver, ROOM[id] as never);
      const cols = (ROOM[id] as { cols: number }).cols;
      expect(perLight, id).toEqual([...Array(cols).keys()].map((c) => [c]));
      expect(rectRule(perLight)).toBe('straightAbove');
    }
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
      twoAside: [/two to each side/, /also tap the one above/],
      aboveTwoAside: [/the top light above it and two to each side/, /skip the one above/],
      own: [/its own top taps/, /mirrors/],
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

  test('Cross and Ring: lone end lights mostly can\'t be fixed from the top edge; Diamond: each takes 5–7 taps (no table to learn)', () => {
    const lone = (id: string) => {
      const fx = createFixer(roomSolver, ROOM[id]!);
      return fx.ends.map((e) => fx.fixFor(emptyCells(ROOM[id]!).map((_, i) => i === e))?.length ?? null);
    };
    expect(lone('cross').every((x) => x === null)).toBe(true);
    expect(lone('ring').filter((x) => x === null).length).toBeGreaterThan(5);
    expect(lone('diamond').every((x) => x !== null && x >= 5 && x <= 7)).toBe(true);
  });
});

describe('learn: board guides', () => {
  const guideCopy = (fixtureData.copy as { learn: { guides: Record<string, { summary: string; steps: string[] }> } }).learn.guides;
  const bootRooms = (opts: Parameters<typeof bootModule>[1] = {}) => boot({ ...opts, services: { solver: roomSolver, ...opts.services }, state: { levels: levelsState(), ...opts.state } });
  const KIND: Record<string, string> = { '5x6': 'lights', '6x6': 'lights', '7x7': 'lights', cross: 'shapes', ring: 'shapes', diamond: 'shapes', '8x8': 'lights', '10x10': 'lights', tower: 'lights' };

  test('each room gets the guide its maths calls for, with one sentence per step', () => {
    for (const p of PACKS) {
      expect(guideKind(roomSolver, p.shape), p.id).toBe(KIND[p.id]);
      const g = buildGuide(roomSolver, p);
      expect(guideCopy[p.id]!.steps).toHaveLength(g.lesson.steps.length);
      expect(g.lesson.steps.length).toBeLessThanOrEqual(5);
      expect(g.lesson.steps.at(-1)!.kind).toBe('practice');
      expect(g.lesson.steps.filter((s) => s.kind !== 'practice').length).toBeLessThanOrEqual(4);
    }
  });

  test.each(PACKS.map((p) => p.id))('%s: every example sits on the real shape and every demo does what its words say', (id) => {
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
        // the first lights demo stops with only bottom lights; every other demo ends dark
        if (KIND[id] === 'lights' && k === 0) expect(onlyEnds(end, shape) && !isClear(end)).toBe(true);
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
      const [, spotStep, stuckStep] = g.lesson.steps as Extract<(typeof g.lesson.steps)[number], { kind: 'demo' }>[];
      // spotting: the demo taps are exactly what spotting finds, two or three of them
      expect(spot(roomSolver, shape, pressAll(roomSolver, emptyCells(shape), spotStep!.from, shape))).toEqual(spotStep!.play);
      expect((spotStep!.play as number[]).length).toBeGreaterThanOrEqual(2);
      // stuck: spotting can't clear it; chase, one top-edge tap, chase again
      expect(spot(roomSolver, shape, pressAll(roomSolver, emptyCells(shape), stuckStep!.from, shape))).toBeNull();
      expect(stuckStep!.phases!.filter((x) => x === 'edge')).toHaveLength(1);
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
    expect(t.state('learn').lessonId).toBe('guide-cross');
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

  test.each(PACKS.map((p) => p.id))('%s practice: assist walks it to dark; solving completes the guide, is saved, and touches no stars', (id) => {
    const storage = createMemoryStorage();
    const t = bootRooms({ services: { storage } });
    t.emit('learn:open', { lessonId: `guide-${id}` });
    const steps = buildGuide(roomSolver, PACKS.find((p) => p.id === id)!).lesson.steps.length;
    for (let k = 1; k < steps; k++) t.emit('learn:step', { delta: 1 });
    const p = t.state('learn').practice!;
    expect(p.cells).toHaveLength(ROOM[id]!.cols * ROOM[id]!.rows);
    expect(fitsShape(ROOM[id]!, p.cells)).toBe(true);
    t.emit('learn:set_assist', { on: true });
    for (let k = 0; k < 120 && t.state('learn').practice!.status === 'playing'; k++) {
      const s = t.state('learn').practice!.suggest!;
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

  test('the lights step: six strips on 6×6, letters A–F; tapping a strip plays that light to dark', () => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: 'guide-6x6' });
    t.emit('learn:step', { delta: 1 });
    const rows = qa('[data-action="learn-strip"]');
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => [...r.querySelectorAll<HTMLElement>('[data-letter]')].map((e) => e.dataset.letter).join(''))).toEqual(['AC', 'D', 'AE', 'BF', 'C', 'DF']);
    expect(rows[2]!.getAttribute('aria-pressed')).toBe('true');
    rows[5]!.click();
    expect(rows[5]!.getAttribute('aria-pressed')).toBe('true');
    const litIdx = () => qa('[data-mini-board="demo"] [data-mini-cell]').flatMap((e) => (e.dataset.lit === 'true' ? [Number(e.dataset.index)] : []));
    expect(litIdx()).toEqual([35]);
    const button = q('[data-action="learn-demo"]')!;
    for (let k = 0; k < 40 && button.textContent !== 'Replay'; k++) button.click();
    expect(litIdx()).toEqual([]);
  });

  test('every room in the data has a guide; the 4×4 guide is gone', () => {
    expect(Object.keys(guideCopy).sort()).toEqual(PACKS.map((p) => p.id).sort());
    expect(guideCopy['4x4']).toBeUndefined();
    const rules = fixtureData.rules as { learn: { practicePresses: Record<string, unknown> } };
    expect(Object.keys(rules.learn.practicePresses).filter((k) => k.startsWith('guide-')).sort()).toEqual(PACKS.map((p) => `guide-${p.id}`).sort());
  });

  test.each(['5x6', 'tower', '8x8', '10x10'])('%s: the several-lights demo starts from two bottom lights', (id) => {
    const shape = ROOM[id]!;
    const g = buildGuide(roomSolver, PACKS.find((p) => p.id === id)!);
    const several = g.lesson.steps[2] as Extract<(typeof g.lesson.steps)[number], { kind: 'demo' }>;
    expect(several.lit).toHaveLength(2);
    expect(several.lit!.every((i) => i >= (shape.rows - 1) * shape.cols)).toBe(true);
  });

  test.each(['5x6', '6x6', '7x7', '8x8', '10x10', 'tower'])('%s practice always needs the bottom-row step: a chase alone never clears it', (id) => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: `guide-${id}` });
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
    for (let k = 0; k < 20; k++) {
      const cells = t.state('learn').practice!.cells;
      expect(isClear(chaseShape(roomSolver, cells, ROOM[id]!).cells), `${id} board ${k}`).toBe(false);
      t.emit('learn:new_practice', {});
    }
  });

  test('the lights step on 10×10: ten rows A–J, each the lit light with its letter → its top taps; tapping a row plays it to dark', () => {
    const t = bootRooms();
    t.emit('learn:open', { lessonId: 'guide-10x10' });
    t.emit('learn:step', { delta: 1 });
    expect(q('.learn-lights')!.dataset.wide).toBe('true');
    const rows = qa('[data-action="learn-strip"]');
    expect(rows).toHaveLength(10);
    const key = rows.map((r) => r.querySelector<HTMLElement>('.learn-row--key [data-mini-cell]')!);
    expect(key.map((e) => e.dataset.letter).join('')).toBe('ABCDEFGHIJ');
    expect(key.every((e, c) => e.dataset.lit === 'true' && Number(e.dataset.index) === 90 + c)).toBe(true);
    expect(rows.map((r) => [...r.querySelectorAll<HTMLElement>('.learn-row--top [data-letter]')].map((e) => e.dataset.letter).join(''))).toEqual(['C', 'BD', 'ACE', 'BDF', 'CEG', 'DFH', 'EGI', 'FHJ', 'GI', 'H']);
    rows[9]!.click();
    const litIdx = () => qa('[data-mini-board="demo"] [data-mini-cell]').flatMap((e) => (e.dataset.lit === 'true' ? [Number(e.dataset.index)] : []));
    expect(litIdx()).toEqual([99]);
    const button = q('[data-action="learn-demo"]')!;
    for (let k = 0; k < 80 && button.textContent !== 'Replay'; k++) button.click();
    expect(litIdx()).toEqual([]);
    // up to 7 wide the rows keep both strips
    t.emit('learn:open', { lessonId: 'guide-7x7' });
    t.emit('learn:step', { delta: 1 });
    expect(q('.learn-lights')!.dataset.wide).toBeUndefined();
    expect(qa('.learn-row--key')).toHaveLength(0);
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

    test('10×10 with lights under the tap minimum: hold shows the aim bubble, sliding moves it, lifting presses; a keyboard click still presses', () => {
      const t = atPractice('10x10');
      const { fire } = layOut('10x10', 30);
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
      expect(t.state('learn').practice!.cells).toEqual(roomSolver.press(before, 1, ROOM['10x10']!));
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
    t.emit('learn:open', { lessonId: 'guide-5x6' });
    expect(q('[data-action="learn-back"]')!.getAttribute('aria-label')).toBe('Back');
    q('[data-action="learn-back"]')!.click();
    expect(t.seen('nav:back')).toEqual({});
    const before = t.all('nav:back').length;
    for (let k = 0; k < 4; k++) t.emit('learn:step', { delta: 1 });
    expect(t.all('nav:back')).toHaveLength(before + 1);
    expect(t.state('learn').lessonId).toBeNull();
    expect(t.state('learn').completed).toContain('guide-5x6');
  });
});

describe('learn: the Patterns panel on room boards', () => {
  const boardOn = (id: string, cells: Cells) => ({ status: 'playing' as const, levelId: PACKS.find((p) => p.id === id)!.first, start: cells, cells, par: 3, moves: 0, history: [], shape: ROOM[id]! });
  const bootPanel = (id: string, cells: Cells) => boot({ services: { solver: roomSolver }, state: { levels: levelsState(), board: boardOn(id, cells) } });
  const flush = (t: ReturnType<typeof boot>) => t.emit('learn:set_assist', { on: false });

  test.each(['cross', 'ring', 'diamond'])('%s: chase by row, then the board picture with the top-edge fix ringed; following it clears the board', (id) => {
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

  const RULE_LINE: Record<string, RegExp> = {
    '5x6': /straight above it/, tower: /straight above it/, '6x6': /two to each side; at the edges, also/, '7x7': /three top lights above it/,
    '8x8': /has its own top taps/, '10x10': /above it and two to each side; at the edges, skip/,
  };
  test.each(Object.keys(RULE_LINE))('%s: the rule line from the maths, the live bottom row while chasing, then the top taps under it; following them clears the board', (id) => {
    const shape = ROOM[id]!;
    const { cols, rows } = shape;
    const { perLight } = rectTopSets(roomSolver, shape as never);
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
    expect(root.querySelector('[data-reference-rule]')!.textContent).toMatch(RULE_LINE[id]!);
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

    t.kernel.seed('board', boardOn('6x6', randomBoard(ROOM['6x6']!, 2)));
    flush(t);
    expect(panel.querySelector<HTMLElement>('[data-reference]')!.dataset.referenceKind).toBe('rect');
    panel.querySelector<HTMLElement>('[data-action="guide"]')!.click();
    expect(t.seen('learn:open')).toEqual({ lessonId: 'guide-6x6' });

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
        expect(step.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length, step).toBeLessThanOrEqual(2);
        expect(step, id).not.toMatch(/echo/i);
      }
    }
  });
});
