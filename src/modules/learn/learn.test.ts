// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import type { Cells, SolverService } from '../../contracts';
import { createMemoryStorage, bootModule, fixtureData } from '../../../test/fake-ctx';
import { refPress, refSolve } from '../../../test/ref-solver';
import learn from './index';
import { BOTTOM, blank, bottomColumns, bottomRowTable, chase, chaseSuggest, clearsBottom, echoOf, echoOfSet, echoRows, isClear, lit, methodTaps, onlyBottom, pressAll, quietPatterns } from './method';
import { RULES } from './lessons';
import { createAdvisor, kindOf } from './reference';
import { answer, emptySave, finished, nextCard, planRound, type Round } from './drill';

const solver: SolverService = {
  press: (cells, i) => refPress(cells, i),
  solve: (cells) => refSolve(cells),
  isSolvable: (cells) => refSolve(cells) !== null,
};
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

  test('the bottom-row lesson: five steps; the method demo plays to dark (by tap under reduced motion)', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'bottom-row' });
    expect(qa('.learn-dots > i')).toHaveLength(5);
    t.emit('learn:step', { delta: 1 });
    t.emit('learn:step', { delta: 1 });
    const button = q('[data-action="learn-demo"]')!;
    const lit = () => qa('[data-mini-board="demo"] [data-lit="true"]').length;
    expect(lit()).toBeGreaterThan(0);
    for (let k = 0; k < 40 && lit() > 0; k++) button.click();
    expect(lit()).toBe(0);
    expect(button.textContent).toBe('Replay');
  });

  test('the echo step: pick a top light, the demo taps it and chases down to its echo', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'bottom-row' });
    t.emit('learn:step', { delta: 1 });
    q('[data-action="learn-echo"][data-col="3"]')!.click();
    const button = q('[data-action="learn-demo"]')!;
    for (let k = 0; k < 20 && button.textContent !== 'Replay'; k++) button.click();
    const bottom = qa('[data-mini-board="demo"] [data-mini-cell]').slice(20).map((e) => e.dataset.lit === 'true');
    expect(bottom).toEqual([false, false, true, true, true]);
    expect(q('[data-learn-line="demo"]')!.textContent).toBe('D echoes as ··CDE');
    expect(q('[data-action="learn-echo"][data-col="3"]')!.getAttribute('aria-pressed')).toBe('true');
  });

  test('"Go deeper" opens the extra lesson from the last step only; it is not in the list and never counts as a lesson', () => {
    const t = boot();
    t.emit('learn:open', { lessonId: 'bottom-row' });
    expect(q('[data-action="learn-deeper"]')).toBeNull();
    for (let k = 0; k < 4; k++) t.emit('learn:step', { delta: 1 });
    q('[data-action="learn-deeper"]')!.click();
    expect(t.state('learn').lessonId).toBe('echo-more');
    expect(qa('[data-rule]')).toHaveLength(5);
    expect(qa('[data-rule] [data-table-row]')).toHaveLength(7);
    for (let k = 0; k < 3; k++) t.emit('learn:step', { delta: 1 });
    expect(t.state('learn').completed).not.toContain('echo-more');
    expect(qa('[data-lesson-tile]').map((e) => e.dataset.lesson)).not.toContain('echo-more');
  });

  test('drill: any top-row set that cancels the row counts (auto-checked); a wrong Check reveals the answer; boxes persist', () => {
    const storage = createMemoryStorage();
    const t = boot({ services: { storage } });
    t.emit('learn:open', { lessonId: 'echo-more' });
    t.emit('learn:step', { delta: 1 });
    t.emit('learn:step', { delta: 1 });
    const action = q('[data-action="learn-drill"]')!;
    const drill = q('[data-drill]')!;
    expect(drill.dataset.drill).toBe('idle');
    action.click();
    expect(drill.dataset.drill).toBe('asking');
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
    expect(q('[data-learn-line="drill"]')!.textContent).toMatch(/cancels it/);
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
      expect(rule.textContent).toBe('Echo of B · Three in a row: tap above the middle one.');
      expect(calls).toEqual(['0,1,2']);
      t.kernel.seed('board', boardState(lit([BOTTOM + 1, BOTTOM + 3])));
      t.emit('learn:set_assist', { on: false });
      expect(rule.textContent).toMatch(/^Echo of A \+ D · Two with a gap/);
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
  const table = bottomRowTable(solver);
  const status = { start: 'start', chase: 'Row {row}: tap under each lit light.', match: 'match', progress: 'progress', clear: 'clear', nomatch: 'nomatch', rectBottom: 'Only the bottom row is left.' };
  const advise = createAdvisor(solver, table, status, 'shaped line');
  const rect = (n: number) => ({ cols: n, rows: n, mask: null });
  const ring = { cols: 7, rows: 7, mask: [...'XXXXXXXXXXXXXXXX...XXXX...XXXX...XXXXXXXXXXXXXXXX'].map((ch) => ch === 'X') };
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

  test('4×4 and 7×7: chase advice by the real row; only the bottom row lit points to Hint', () => {
    expect(advise({ status: 'playing', cells: on(16, [5]), shape: rect(4) })).toMatchObject({ status: 'chase', text: 'Row 2: tap under each lit light.' });
    expect(advise({ status: 'playing', cells: on(49, [40, 3]), shape: rect(7) })).toMatchObject({ status: 'chase', text: 'Row 1: tap under each lit light.' });
    expect(advise({ status: 'playing', cells: on(49, [36]), shape: rect(7) }).text).toBe('Row 6: tap under each lit light.');
    expect(advise({ status: 'playing', cells: on(49, [43, 45]), shape: rect(7) })).toMatchObject({ status: 'nomatch', text: 'Only the bottom row is left.', match: -1 });
    expect(advise({ status: 'playing', cells: on(16, [12]), shape: rect(4) }).status).toBe('nomatch');
  });

  test('shaped rooms: one calm line, whatever is lit', () => {
    expect(advise({ status: 'playing', cells: on(49, [0, 48]), shape: ring })).toMatchObject({ text: 'shaped line', match: -1 });
    expect(advise({ status: 'solved', cells: on(49, []), shape: ring }).status).toBe('clear');
  });

  test('on a 7×7 board the panel shows chase advice and no table; on a Ring it shows the shape line; classic is unchanged', () => {
    const t = boot({ state: { board: boardState(on(49, [9]), rect(7)) } });
    const root = panel(t).querySelector<HTMLElement>('[data-reference]')!;
    expect(root.dataset.referenceKind).toBe('rect');
    expect(root.querySelector('[data-reference-status]')!.textContent).toBe('Row 2: tap under each lit light.');
    expect(root.querySelectorAll('[data-match="true"]')).toHaveLength(0);
    expect(root.querySelectorAll('[data-reference-bottom] [data-lit="true"]')).toHaveLength(0);
    expect(root.querySelector('[data-action="learn"]')).toBeTruthy();

    t.kernel.seed('board', boardState(on(49, [0]), ring));
    t.emit('learn:set_assist', { on: false });
    expect(root.dataset.referenceKind).toBe('shaped');
    expect(root.querySelector('[data-reference-status]')!.textContent).toMatch(/full rectangle/);
    expect(root.querySelector('[data-reference-status]')!.getAttribute('data-tone')).toBe('coach');

    t.kernel.seed('board', boardState(lit([BOTTOM, BOTTOM + 1, BOTTOM + 2])));
    t.emit('learn:set_assist', { on: false });
    expect(root.dataset.referenceKind).toBe('classic');
    expect(root.querySelector('[data-reference-status]')!.getAttribute('data-reference-status')).toBe('match');
    expect(root.querySelectorAll('[data-pattern-row][data-match="true"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-cell]')).toHaveLength(0);
  });
});
