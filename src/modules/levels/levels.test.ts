import { describe, expect, test } from 'vitest';
import { bootModule, fixtureData } from '../../../test/fake-ctx';
import { refPress, refSolve } from '../../../test/ref-solver';
import type { LevelsState, ProgressState, SolverService } from '../../contracts';
import levels from './index';

// modules never import each other: inject the independent reference solver
const solver: SolverService = { press: refPress, solve: refSolve, isSolvable: (c) => refSolve(c) !== null };
const rules = (fixtureData.rules as { levels: Record<string, unknown> }).levels;
const target = rules.pars as number[];

function withRules(patch: Record<string, unknown>) {
  return { ...fixtureData, rules: { ...fixtureData.rules, levels: { ...rules, ...patch } } };
}
const boot = (opts: Parameters<typeof bootModule>[1] = {}) => bootModule(levels, { services: { solver }, ...opts });
const progress = (unlockedUpTo: number): ProgressState => ({
  status: 'ready',
  save: { version: 1, results: {}, pendingHints: {}, lastLevel: 1 },
  unlockedUpTo,
});

describe('levels', () => {
  const t = boot();
  const state = t.state('levels') as LevelsState;

  test('makes one level per par, with chapters named from copy', () => {
    expect(state.status).toBe('ready');
    expect(state.list.map((l) => l.id)).toEqual(target.map((_, i) => i + 1));
    expect(state.chapters).toEqual([
      { id: 'first-light', name: 'First light', from: 1, to: 20 },
      { id: 'crossfade', name: 'Crossfade', from: 21, to: 40 },
      { id: 'blackout', name: 'Blackout', from: 41, to: 50 },
    ]);
    expect(t.seen('levels:generated')).toEqual({ count: target.length, pars: target });
  });

  test('every par is the solver’s fewest presses and matches the data', () => {
    for (const level of state.list) {
      expect(refSolve(level.cells)?.length).toBe(level.par);
      expect(level.par).toBe(target[level.id - 1]);
    }
  });

  test('every board is different', () => {
    const keys = state.list.map((l) => l.cells.map(Number).join(''));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('same seed gives the same levels; another seed gives others; the session rng is never used', () => {
    expect((boot({ seed: 999 }).state('levels') as LevelsState).list).toEqual(state.list);
    const other = boot({ data: withRules({ seed: 2 }) }).state('levels') as LevelsState;
    expect(other.list.map((l) => l.par)).toEqual(target);
    expect(other.list).not.toEqual(state.list);
  });

  test('generates fast enough', () => {
    const t0 = performance.now();
    boot();
    const ms = performance.now() - t0;
    console.log(`levels: ${target.length} levels in ${ms.toFixed(1)} ms with the reference solver (the real one is faster)`);
    expect(ms).toBeLessThan(1000);
  });

  test('when tries run out it keeps the closest board and warns with the real par', () => {
    const b = boot({ data: withRules({ pars: [15, 15], maxTries: 1, chapters: [{ id: 'first-light', from: 1, to: 2 }] }) });
    const s = b.state('levels') as LevelsState;
    expect(s.status).toBe('ready');
    for (const l of s.list) {
      expect(refSolve(l.cells)?.length).toBe(l.par);
      expect(l.par).toBeLessThanOrEqual(15);
    }
    const missed = s.list.filter((l) => l.par !== 15);
    expect(missed.length).toBeGreaterThan(0); // a random 15-press board is rarely par 15
    const warns = b.kernel.debug.logs().filter((r) => r.level === 'warn' && r.source === 'levels');
    expect(warns.map((w) => w.msg)).toEqual(missed.map((l) => expect.stringContaining(`Level ${l.id} has par ${l.par}, not 15`)));
  });

  test.each([
    [[{ id: 'first-light', from: 1, to: 20 }, { id: 'blackout', from: 41, to: 50 }], /No chapter covers levels 21–40/],
    [[{ id: 'first-light', from: 1, to: 20 }, { id: 'crossfade', from: 21, to: 40 }], /No chapter covers levels 41–50/],
    [[{ id: 'first-light', from: 2, to: 50 }], /No chapter covers level 1\b/],
    [[{ id: 'first-light', from: 1, to: 30 }, { id: 'crossfade', from: 25, to: 50 }], /starts at level 25, which an earlier chapter already covers/],
    [[{ id: 'first-light', from: 1, to: 51 }], /run to level 51, but there are only 50 levels/],
    [[{ id: 'nameless', from: 1, to: 50 }], /"nameless" has no name/],
  ])('chapters must cover every level exactly once (%#)', (chapters, message) => {
    expect(() => boot({ data: withRules({ chapters }) })).toThrow(message);
  });

  test('data with a par no board can have is rejected before init', () => {
    expect(() => boot({ data: withRules({ pars: [1, 16] }) })).toThrow(/A par must be 1–15/);
  });

  test('start loads the board and says so', () => {
    const b = boot();
    b.emit('levels:start', { levelId: 7 });
    const level = state.list[6]!;
    expect(b.seen('board:load')).toEqual({ levelId: 7, cells: level.cells, par: level.par });
    expect(b.seen('levels:started')).toEqual({ levelId: 7, par: level.par, count: 50 });
    expect(b.all('levels:refused')).toEqual([]);
  });

  test('refuses unknown levels', () => {
    const b = boot();
    for (const levelId of [0, 51, 2.5, -1]) {
      b.emit('levels:start', { levelId });
      expect(b.seen('levels:refused')).toEqual({ levelId, reason: 'unknown' });
    }
    expect(b.all('board:load')).toEqual([]);
  });

  test('refuses locked levels when progress exists; everything is open without it', () => {
    const b = boot({ state: { progress: progress(3) } });
    b.emit('levels:start', { levelId: 4 });
    expect(b.seen('levels:refused')).toEqual({ levelId: 4, reason: 'locked' });
    b.emit('levels:start', { levelId: 3 });
    expect(b.seen('levels:started', { levelId: 3 })).toBeTruthy();
    expect(b.all('board:load').length).toBe(1);

    const open = boot();
    open.emit('levels:start', { levelId: 50 });
    expect(open.seen('levels:started', { levelId: 50 })).toBeTruthy();
  });

  test('refuses while not ready, and shows a failed generation as an error', () => {
    const broken: SolverService = { ...solver, solve: () => null };
    const b = boot({ services: { solver: broken } });
    const s = b.state('levels') as LevelsState;
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/Couldn't make the levels/);
    expect(b.all('levels:generated')).toEqual([]);
    b.emit('levels:start', { levelId: 1 });
    expect(b.seen('levels:refused')).toEqual({ levelId: 1, reason: 'not_ready' });
  });

  test('console commands', () => {
    const b = boot();
    const cmd = b.instance!.commands!;
    expect(String(cmd.list!([])).split('\n')[0]).toBe(`1: ${target[0]}`);
    cmd.start!(['5']);
    expect(b.seen('levels:started', { levelId: 5 })).toBeTruthy();
    expect(cmd.start!([])).toMatch(/Usage/);
  });
});
