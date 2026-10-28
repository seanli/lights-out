// @vitest-environment happy-dom
import { describe, expect, test } from 'vitest';
import type { Cells, SolverService } from '../../contracts';
import { SEL } from '../../contracts';
import { bootModule, createMemoryStorage, fixtureData } from '../../../test/fake-ctx';
import { refPress, refSolve } from '../../../test/ref-solver';
import tutorial from './index';

const off = (): Cells => new Array(25).fill(false);
const levelFrom = (presses: number[]) => presses.reduce<boolean[]>((c, i) => refPress(c, i), off());
const lit = (cells: Cells) => cells.filter(Boolean).length;
const refSolver: SolverService = { press: refPress, solve: refSolve, isSolvable: (c) => refSolve(c) !== null };
const copy = fixtureData.copy!.tutorial as Record<string, string[]>;

const LEVEL1 = levelFrom([12]);
const LEVEL2 = levelFrom([6, 18]);

type Storage = ReturnType<typeof createMemoryStorage>;
function boot(opts: { solver?: SolverService | null; storage?: Storage; enabled?: boolean } = {}) {
  const data = { ...fixtureData, flags: { ...fixtureData.flags, tutorial: { enabled: opts.enabled ?? true } } };
  document.body.replaceChildren();
  const services: Record<string, unknown> = {};
  if (opts.solver !== null) services.solver = opts.solver ?? refSolver;
  if (opts.storage) services.storage = opts.storage;
  const t = bootModule(tutorial, { services, data });
  const coach = t.view!.region('slot:coach');
  /** the board module's facts, built from real presses */
  let cells: Cells = off();
  let levelId = 0;
  let moves = 0;
  const load = (id: number, start: Cells) => { levelId = id; cells = start; moves = 0; t.emit('board:loaded', { levelId: id, cells, par: 2 }); };
  const press = (index: number) => {
    cells = refPress(cells, index);
    moves++;
    t.emit('board:pressed', { levelId, index, cells, moves, litCount: lit(cells) });
    if (lit(cells) === 0) t.emit('board:solved', { levelId, moves, par: 2 });
  };
  return { ...t, coach, load, press, cells: () => cells, line: () => coach.querySelector<HTMLElement>(SEL.tutorial) };
}

describe('tutorial', () => {
  test('level 1 points at a cell of the fewest-presses solution and shows the first sentence', () => {
    const t = boot();
    t.load(1, LEVEL1);
    const s = t.state('tutorial');
    expect(s).toEqual({ status: 'active', levelId: 1, step: 0, target: 12, copyKey: '1.0' });
    expect(refSolve(LEVEL1)).toContain(s.target);
    expect(t.seen('tutorial:step_shown')).toEqual({ levelId: 1, step: 0, target: 12 });
    const line = t.line()!;
    expect(line.tagName).toBe('P');
    expect(line.className).toBe('tutorial-line');
    expect(line.getAttribute('aria-live')).toBe('polite');
    expect(line.textContent).toBe(copy['1']![0]);
  });

  test('the coach sentence speaks in the full-contrast coach tone', () => {
    const t = boot();
    t.load(2, LEVEL2);
    expect(t.line()!.dataset.tone).toBe('coach');
    t.press(t.state('tutorial').target!);
    expect(t.line()!.dataset.tone).toBe('coach');
  });

  test('the target is the lowest index of the solution', () => {
    const t = boot();
    t.load(2, levelFrom([18, 6]));
    expect(t.state('tutorial').target).toBe(6);
  });

  test('pressing the target advances the step and points at the next cell', () => {
    const t = boot();
    t.load(2, LEVEL2);
    t.press(6);
    expect(t.state('tutorial')).toEqual({ status: 'active', levelId: 2, step: 1, target: 18, copyKey: '2.1' });
    expect(t.seen('tutorial:step_shown')).toEqual({ levelId: 2, step: 1, target: 18 });
    expect(t.line()!.textContent).toBe(copy['2']![1]);
  });

  test('the last sentence repeats for later steps', () => {
    const t = boot();
    t.load(2, levelFrom([0, 6, 12, 18]));
    for (const i of [0, 6]) t.press(i);
    expect(t.state('tutorial').step).toBe(2);
    expect(t.state('tutorial').copyKey).toBe(`2.${copy['2']!.length - 1}`);
    expect(t.line()!.textContent).toBe(copy['2']!.at(-1));
  });

  test('an off-target press keeps the step and recomputes a target that is in the new solution', () => {
    const t = boot();
    t.load(2, LEVEL2);
    t.press(0);
    const s = t.state('tutorial');
    expect(s.step).toBe(0);
    const solution = refSolve(t.cells())!;
    expect(solution).toContain(s.target);
    expect(s.target).toBe(Math.min(...solution));
    expect(t.all('tutorial:step_shown')).toHaveLength(2);
  });

  test('undo and restart re-point at the board in the payload', () => {
    const t = boot();
    t.load(2, LEVEL2);
    t.press(0);
    t.emit('board:undone', { levelId: 2, index: 0, cells: LEVEL2, moves: 0 });
    expect(t.state('tutorial').target).toBe(6);
    t.press(6);
    t.emit('board:restarted', { levelId: 2, cells: LEVEL2 });
    expect(t.state('tutorial')).toMatchObject({ status: 'active', target: 6 });
  });

  test('solving finishes the level, persists it, and a re-boot with the same storage shows nothing', () => {
    const storage = createMemoryStorage();
    const t = boot({ storage });
    t.load(1, LEVEL1);
    t.press(12);
    expect(t.seen('tutorial:finished')).toEqual({ levelId: 1 });
    expect(t.state('tutorial')).toMatchObject({ status: 'idle', levelId: null, target: null, copyKey: null });
    expect(storage.dump().tutorial).toEqual({ done: [1] });
    expect(t.line()).toBeNull();
    expect(t.coach.childNodes).toHaveLength(0);
    // the winning press itself shows no extra step
    expect(t.all('tutorial:step_shown')).toHaveLength(1);

    const again = boot({ storage });
    again.load(1, LEVEL1);
    expect(again.state('tutorial').status).toBe('idle');
    expect(again.all('tutorial:step_shown')).toEqual([]);
    expect(again.line()).toBeNull();
    again.load(2, LEVEL2);
    expect(again.state('tutorial').status).toBe('active');
  });

  test('status is done once every tutorial level is finished', () => {
    const storage = createMemoryStorage({ tutorial: { done: [1] } });
    const t = boot({ storage });
    expect(t.state('tutorial').status).toBe('idle');
    t.load(2, LEVEL2);
    t.press(6);
    t.press(18);
    expect(t.state('tutorial').status).toBe('done');
    expect(storage.dump().tutorial).toEqual({ done: [1, 2] });
  });

  test('non-tutorial levels stay idle and clear the sentence', () => {
    const t = boot();
    t.load(1, LEVEL1);
    t.load(3, LEVEL2);
    expect(t.state('tutorial')).toEqual({ status: 'idle', levelId: null, step: 0, target: null, copyKey: null });
    expect(t.line()).toBeNull();
    t.press(6);
    t.emit('board:solved', { levelId: 3, moves: 2, par: 2 });
    expect(t.all('tutorial:finished')).toEqual([]);
    expect(t.all('tutorial:step_shown')).toHaveLength(1);
  });

  test('skip marks every tutorial level done', () => {
    const storage = createMemoryStorage();
    const t = boot({ storage });
    t.load(1, LEVEL1);
    t.emit('tutorial:skip', {});
    expect(t.state('tutorial').status).toBe('done');
    expect(t.line()).toBeNull();
    expect(storage.dump().tutorial).toEqual({ done: [1, 2] });
    t.load(2, LEVEL2);
    expect(t.state('tutorial').status).toBe('done');
  });

  test('switched off in flags: writes done and reacts to nothing', () => {
    const t = boot({ enabled: false });
    expect(t.state('tutorial')).toEqual({ status: 'done', levelId: null, step: 0, target: null, copyKey: null });
    t.load(1, LEVEL1);
    expect(t.state('tutorial').status).toBe('done');
    expect(t.events().filter((e) => e.type.startsWith('tutorial:'))).toEqual([]);
    expect(t.line()).toBeNull();
  });

  test('no solver: no target, but the sentence still shows until the level is solved', () => {
    const t = boot({ solver: null });
    t.load(2, LEVEL2);
    expect(t.state('tutorial')).toEqual({ status: 'active', levelId: 2, step: 0, target: null, copyKey: '2.0' });
    expect(t.line()!.textContent).toBe(copy['2']![0]);
    t.press(6);
    expect(t.state('tutorial')).toMatchObject({ status: 'active', target: null });
    expect(t.line()!.textContent).toBe(copy['2']![0]);
    t.press(18);
    expect(t.seen('tutorial:finished')).toEqual({ levelId: 2 });
  });

  test('unreadable saved data starts the tutorial over', () => {
    const t = boot({ storage: createMemoryStorage({ tutorial: 'garbage' }) });
    t.load(1, LEVEL1);
    expect(t.state('tutorial').status).toBe('active');
  });

  test('the reset command forgets finished levels and coaches the current board again', () => {
    const storage = createMemoryStorage({ tutorial: { done: [1, 2] } });
    const t = boot({ storage });
    t.kernel.seed('board', { status: 'playing', levelId: 1, start: LEVEL1, cells: LEVEL1, par: 1, moves: 0, history: [] });
    t.instance!.commands!.reset!([]);
    expect(storage.dump().tutorial).toBeUndefined();
    expect(t.state('tutorial')).toMatchObject({ status: 'active', levelId: 1, step: 0, target: 12 });
    expect(t.line()!.textContent).toBe(copy['1']![0]);
  });

  test('every tutorial level has copy, and the copy says what a tap does and what the goal is', () => {
    const levels = (fixtureData.rules!.tutorial as { levels: number[] }).levels;
    for (const l of levels) expect(copy[String(l)]?.length).toBeGreaterThan(0);
    const all = Object.values(copy).flat().join(' ').toLowerCase();
    expect(all).toMatch(/every light off/);
    expect(all).toMatch(/next to it/);
  });
});
