// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest';
import type { CustomSettings, ProgressState, SolverService, State } from '../../contracts';
import { CUSTOM_LEVEL_ID, SEL } from '../../contracts';
import { cellCount, isPressable, shapeProblem } from '../../lib/shape';
import { bootModule, createMemoryStorage } from '../../../test/fake-ctx';
import solverModule from '../solver/index';
import custom from './index';

const DEFAULTS: CustomSettings = { grid: 'square', cols: 6, rows: 6, hexSide: 4, cubeSide: 3, twist: 'none', difficulty: 'medium' };
const realSolver = (): SolverService => bootModule(solverModule, {}).kernel.service('solver')!;

const progress = (open: boolean): ProgressState => ({
  status: 'ready', save: { version: 1, results: {}, pendingHints: {}, lastLevel: 0 }, unlockedUpTo: 1, varietyOpen: open,
});

interface Opts { stored?: unknown; state?: Partial<State>; solver?: SolverService; seed?: number }
function boot({ stored, state = {}, solver = realSolver(), seed }: Opts = {}) {
  const storage = createMemoryStorage(stored === undefined ? {} : { custom: stored });
  const t = bootModule(custom, { services: { solver, storage }, state, ...(seed === undefined ? {} : { seed }) });
  return { ...t, storage };
}
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const radio = (key: string, value: string) => $<HTMLButtonElement>(`[data-custom-option="${key}"][data-value="${value}"]`);
const stepBtn = (key: string, step: 1 | -1) => $<HTMLButtonElement>(`[data-custom-size="${key}"] [data-step="${step}"]`);
const value = (key: string) => $(`[data-custom-size="${key}"] [data-custom-value]`).textContent;

beforeEach(() => document.body.replaceChildren());

describe('custom: settings', () => {
  test('a new player starts from the defaults, idle, nothing played', () => {
    const t = boot();
    expect(t.state('custom')).toEqual({ status: 'idle', settings: DEFAULTS, played: 0, label: null });
  });

  test('stored settings come back; unreadable ones are replaced by the defaults', () => {
    const mine: CustomSettings = { grid: 'hex', cols: 8, rows: 12, hexSide: 5, cubeSide: 4, twist: 'stuck', difficulty: 'boss' };
    expect(boot({ stored: { version: 1, settings: mine } }).state('custom').settings).toEqual(mine);
    for (const bad of [
      { version: 1, settings: { ...mine, cols: 99 } },
      { version: 1, settings: { ...mine, grid: 'triangle' } },
      { version: 1, settings: { grid: 'hex' } },
      { version: 2, settings: mine },
      'garbage',
      null,
    ]) {
      document.body.replaceChildren();
      expect(boot({ stored: bad }).state('custom').settings).toEqual(DEFAULTS);
    }
    // a stored wired hex (never written by this module) keeps the hex and drops the wiring
    document.body.replaceChildren();
    expect(boot({ stored: { version: 1, settings: { ...mine, twist: 'wired' } } }).state('custom').settings).toEqual({ ...mine, twist: 'none' });
  });

  test('custom:set merges, validates and saves; a bad value is refused and changes nothing', () => {
    const t = boot();
    t.emit('custom:set', { settings: { cols: 8, difficulty: 'hard' } });
    const want = { ...DEFAULTS, cols: 8, difficulty: 'hard' };
    expect(t.state('custom').settings).toEqual(want);
    expect(t.storage.dump().custom).toEqual({ version: 1, settings: want });

    t.emit('custom:set', { settings: { cols: 11 } });
    expect(t.seen('custom:refused')).toEqual({ command: 'custom:set', reason: 'bad_settings' });
    t.emit('custom:set', { settings: { difficulty: 'nightmare' } as unknown as Partial<CustomSettings> });
    expect(t.all('custom:refused').length).toBe(2);
    expect(t.state('custom').settings).toEqual(want);
    expect(t.storage.dump().custom).toEqual({ version: 1, settings: want });
  });

  test('wired needs the square: picking hex or cube turns it off; asking for it there is refused', () => {
    const t = boot();
    t.emit('custom:set', { settings: { twist: 'wired' } });
    expect(t.state('custom').settings.twist).toBe('wired');
    t.emit('custom:set', { settings: { grid: 'hex' } });
    expect(t.state('custom').settings).toMatchObject({ grid: 'hex', twist: 'none' });
    t.emit('custom:set', { settings: { twist: 'wired' } });
    expect(t.seen('custom:refused')).toEqual({ command: 'custom:set', reason: 'bad_settings' });
    t.emit('custom:set', { settings: { grid: 'cube', twist: 'wired' } });
    expect(t.all('custom:refused').length).toBe(2);
    expect(t.state('custom').settings).toMatchObject({ grid: 'hex', twist: 'none' });
    t.emit('custom:set', { settings: { grid: 'square', twist: 'wired' } });
    expect(t.state('custom').settings).toMatchObject({ grid: 'square', twist: 'wired' });
    t.emit('custom:set', { settings: { grid: 'cube' } });
    expect(t.state('custom').settings).toMatchObject({ grid: 'cube', twist: 'none' });
  });

  test('custom:open is refused until the other boards open; no progress slice means open', () => {
    const t = boot({ state: { progress: progress(false) } });
    t.emit('custom:open', {});
    expect(t.seen('custom:refused')).toEqual({ command: 'custom:open', reason: 'locked' });
    t.emit('custom:play', {});
    expect(t.seen('custom:refused')).toEqual({ command: 'custom:play', reason: 'locked' });
    expect(t.all('nav:go')).toEqual([]);
    expect(t.all('board:load')).toEqual([]);
    t.kernel.seed('progress', progress(true));
    t.emit('custom:open', {});
    expect(t.seen('nav:go')).toEqual({ screen: 'custom' });

    document.body.replaceChildren();
    const u = boot();
    u.emit('custom:open', {});
    expect(u.seen('nav:go')).toEqual({ screen: 'custom' });
  });
});

describe('custom: making a puzzle', () => {
  const cases: [string, Partial<CustomSettings>, string][] = [
    ['square', { cols: 7, rows: 7, difficulty: 'hard' }, 'Square 7×7 · Hard'],
    ['square stuck', { cols: 6, rows: 8, twist: 'stuck' }, 'Square 6×8 · Stuck · Medium'],
    ['square wired', { cols: 5, rows: 5, twist: 'wired', difficulty: 'easy' }, 'Square 5×5 · Wired · Easy'],
    ['hex', { grid: 'hex', hexSide: 4, difficulty: 'boss' }, 'Hex · 37 lights · Boss'],
    ['hex stuck', { grid: 'hex', hexSide: 3, twist: 'stuck', difficulty: 'easy' }, 'Hex · 19 lights · Stuck · Easy'],
    ['cube', { grid: 'cube', cubeSide: 3, difficulty: 'medium' }, 'Cube 3×3×3 · Medium'],
    ['cube 4 stuck', { grid: 'cube', cubeSide: 4, twist: 'stuck', difficulty: 'hard' }, 'Cube 4×4×4 · Stuck · Hard'],
  ];
  for (const [what, settings, label] of cases) {
    test(`${what}: board:load under CUSTOM_LEVEL_ID with a sound shape, solvable in exactly par presses`, () => {
      const solver = realSolver();
      const t = boot({ solver });
      t.emit('custom:set', { settings });
      t.emit('custom:play', {});
      const load = t.seen('board:load')!;
      expect(load.levelId).toBe(CUSTOM_LEVEL_ID);
      expect(load.shape).toBeDefined();
      expect(shapeProblem(load.shape!)).toBeNull();
      expect(load.par).toBeGreaterThan(0);
      expect(load.cells.some(Boolean)).toBe(true);
      const solution = solver.solve(load.cells, load.shape)!;
      expect(solution.length).toBe(load.par);
      expect(solution.every((i) => isPressable(load.shape!, i))).toBe(true);
      if (settings.twist === 'stuck') expect(load.shape!.stuck!.length).toBeGreaterThan(0);
      if (settings.twist === 'wired') expect(load.shape!.wires!.length).toBe(load.shape!.cols * load.shape!.rows);
      expect(t.state('custom')).toMatchObject({ status: 'playing', played: 1, label });
      expect(t.seen('custom:started')).toEqual({ par: load.par, label, puzzle: 1 });
      // the board loads first, then the fact, then the screen changes
      const order = t.events().map((e) => e.type).filter((x) => ['board:load', 'custom:started', 'nav:go'].includes(x));
      expect(order).toEqual(['board:load', 'custom:started', 'nav:go']);
      expect(t.seen('nav:go')).toEqual({ screen: 'play' });
    });
  }

  test('par follows the difficulty as a share of the lights; each play is a new puzzle', () => {
    const t = boot();
    t.emit('custom:set', { settings: { cols: 10, rows: 10, difficulty: 'easy' } });
    t.emit('custom:play', {});
    const easy = t.seen('board:load')!;
    expect(easy.par).toBeLessThanOrEqual(10);
    t.emit('custom:set', { settings: { difficulty: 'boss' } });
    t.emit('custom:play', {});
    const boss = t.seen('board:load')!;
    expect(boss.par).toBeGreaterThan(easy.par * 2);
    expect(boss.par).toBeLessThanOrEqual(33);
    t.emit('custom:play', {});
    expect(t.seen('board:load')!.cells).not.toEqual(boss.cells);
    expect(t.state('custom').played).toBe(3);
    expect(t.seen('custom:started')!.puzzle).toBe(3);
  });

  test('the same session seed makes the same puzzle (replay)', () => {
    const make = () => {
      document.body.replaceChildren();
      const t = boot({ seed: 7 });
      t.emit('custom:set', { settings: { grid: 'hex', twist: 'stuck' } });
      t.emit('custom:play', {});
      return t.seen('board:load');
    };
    expect(make()).toEqual(make());
  });

  test('when no puzzle can be made: status error with a plain message, refused no_puzzle; the next good play clears it', () => {
    const real = realSolver();
    let broken = true;
    const solver: SolverService = { ...real, solve: (c, s) => (broken ? null : real.solve(c, s)) };
    const t = boot({ solver });
    t.emit('custom:play', {});
    expect(t.seen('custom:refused')).toEqual({ command: 'custom:play', reason: 'no_puzzle' });
    expect(t.state('custom')).toMatchObject({ status: 'error', played: 0 });
    expect(t.state('custom').error).toMatch(/Couldn't make that puzzle/);
    expect(t.all('board:load')).toEqual([]);
    expect(t.all('nav:go')).toEqual([]);
    expect($('[data-custom-error]').hidden).toBe(false);
    broken = false;
    t.emit('custom:play', {});
    expect(t.state('custom').status).toBe('playing');
    expect(t.state('custom').error).toBeUndefined();
    expect($('[data-custom-error]').hidden).toBe(true);
  });

  test('fast: the biggest boards at boss take well under 150ms', () => {
    const t = boot();
    const worst: Partial<CustomSettings>[] = [
      { grid: 'square', cols: 10, rows: 16, twist: 'none', difficulty: 'boss' },
      { grid: 'square', cols: 10, rows: 16, twist: 'stuck', difficulty: 'boss' },
      { grid: 'square', cols: 10, rows: 16, twist: 'wired', difficulty: 'boss' },
      { grid: 'cube', cubeSide: 4, twist: 'stuck', difficulty: 'boss' },
      { grid: 'hex', hexSide: 5, twist: 'none', difficulty: 'boss' },
    ];
    for (const settings of worst) {
      t.emit('custom:set', { settings });
      const times: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        t.emit('custom:play', {});
        times.push(performance.now() - t0);
      }
      times.sort((a, b) => a - b);
      expect(t.state('custom').status, JSON.stringify(settings)).toBe('playing');
      expect(times[1], `${JSON.stringify(settings)}: ${times.map(Math.round).join(', ')}ms`).toBeLessThan(150);
    }
  });
});

describe('custom: the screen', () => {
  test('header with back; Board, Size, Twist, Difficulty as radio groups; Play in the bar', () => {
    const t = boot();
    expect($('[data-screen="custom"] .screen-header__title strong').textContent).toBe('Custom');
    expect($('[data-screen="custom"] .screen-header__title .eyebrow').textContent).toBe('Make your own');
    for (const key of ['grid', 'twist', 'difficulty']) {
      const group = $(`[data-custom-group="${key}"]`);
      expect(group.getAttribute('role')).toBe('radiogroup');
      expect(document.getElementById(group.getAttribute('aria-labelledby')!)).not.toBeNull();
    }
    expect(radio('grid', 'square').getAttribute('aria-checked')).toBe('true');
    expect(radio('grid', 'hex').getAttribute('aria-checked')).toBe('false');
    expect(radio('difficulty', 'medium').getAttribute('tabindex')).toBe('0');
    expect(radio('difficulty', 'hard').getAttribute('tabindex')).toBe('-1');
    expect(radio('difficulty', 'boss').querySelector('.skull')).not.toBeNull();
    expect($('[data-custom-name]').textContent).toBe('Square 6×6');
    expect($('[data-custom-summary]').textContent).toBe('36 lights · about 6 presses');
    $<HTMLButtonElement>(SEL.action('custom-back')).click();
    expect(t.all('nav:back')).toEqual([{}]);
    $<HTMLButtonElement>(SEL.action('custom-play')).click();
    expect(t.all('custom:play')).toEqual([{}]);
  });

  test('tapping a choice sets it and repaints in place', () => {
    const t = boot();
    const hex = radio('grid', 'hex');
    hex.click();
    expect(t.seen('custom:set')).toEqual({ settings: { grid: 'hex' } });
    expect(radio('grid', 'hex')).toBe(hex);
    expect(hex.getAttribute('aria-checked')).toBe('true');
    expect(radio('grid', 'square').getAttribute('aria-checked')).toBe('false');
    expect($('[data-custom-name]').textContent).toBe('Hex · 37 lights');
    expect($('[data-custom-summary]').textContent).toBe('About 6 presses to clear');
    expect($('[data-custom-preview] .room-glyph [data-odd]')).not.toBeNull();
    radio('difficulty', 'boss').click();
    expect(t.state('custom').settings.difficulty).toBe('boss');
    expect($('[data-custom-summary]').textContent).toBe('About 12 presses to clear');
    const before = t.all('custom:set').length;
    radio('difficulty', 'boss').click(); // already chosen
    expect(t.all('custom:set').length).toBe(before);
  });

  test('size: square shows width and height; hex its side and lights; cube its edge', () => {
    const t = boot();
    const shown = () => [...document.querySelectorAll<HTMLElement>('[data-custom-size]')].filter((el) => !el.hidden).map((el) => el.dataset.customSize);
    expect(shown()).toEqual(['cols', 'rows']);
    expect($('[data-custom-lights]').hidden).toBe(true);
    stepBtn('cols', 1).click();
    expect(t.seen('custom:set')).toEqual({ settings: { cols: 7 } });
    expect(value('cols')).toBe('7');
    stepBtn('rows', -1).click();
    expect(value('rows')).toBe('5');

    t.emit('custom:set', { settings: { grid: 'hex' } });
    expect(shown()).toEqual(['hexSide']);
    expect($('[data-custom-lights]').textContent).toBe('37 lights');
    stepBtn('hexSide', 1).click();
    expect($('[data-custom-lights]').textContent).toBe('61 lights');
    // at the edge: the button says so and does nothing
    expect(stepBtn('hexSide', 1).getAttribute('aria-disabled')).toBe('true');
    const sets = t.all('custom:set').length;
    stepBtn('hexSide', 1).click();
    expect(t.all('custom:set').length).toBe(sets);
    expect(t.state('custom').settings.hexSide).toBe(5);

    t.emit('custom:set', { settings: { grid: 'cube' } });
    expect(shown()).toEqual(['cubeSide']);
    expect(value('cubeSide')).toBe('3');
    expect($('[data-custom-lights]').textContent).toBe('54 lights');
    expect($('[data-custom-name]').textContent).toBe('Cube 3×3×3');
    expect(stepBtn('cubeSide', -1).getAttribute('aria-disabled')).toBe('true');
    // each grid keeps its own size
    t.emit('custom:set', { settings: { grid: 'square' } });
    expect(value('cols')).toBe('7');
    expect(value('rows')).toBe('5');
  });

  test('wired is disabled off the square, with a note why; tapping it then does nothing', () => {
    const t = boot();
    const wired = radio('twist', 'wired');
    expect(wired.hasAttribute('aria-disabled')).toBe(false);
    expect($('[data-custom-wired-note]').hidden).toBe(true);
    expect($('[data-custom-note]').textContent).toBe('A press flips its light and the ones touching it.');
    radio('grid', 'cube').click();
    expect(wired.getAttribute('aria-disabled')).toBe('true');
    expect($('[data-custom-wired-note]').hidden).toBe(false);
    expect(wired.getAttribute('aria-describedby')).toBe($('[data-custom-wired-note]').id);
    const sets = t.all('custom:set').length;
    wired.click();
    expect(t.all('custom:set').length).toBe(sets);
    expect(t.state('custom').settings.twist).toBe('none');
  });

  test('arrow keys move the choice within a group, skipping a disabled option', () => {
    const t = boot();
    const key = (el: HTMLElement, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key(radio('difficulty', 'medium'), 'ArrowRight');
    expect(t.state('custom').settings.difficulty).toBe('hard');
    expect(document.activeElement).toBe(radio('difficulty', 'hard'));
    key(radio('difficulty', 'hard'), 'End');
    expect(t.state('custom').settings.difficulty).toBe('boss');
    key(radio('difficulty', 'boss'), 'ArrowRight');
    expect(t.state('custom').settings.difficulty).toBe('easy'); // wraps
    t.emit('custom:set', { settings: { grid: 'hex', twist: 'stuck' } });
    key(radio('twist', 'stuck'), 'ArrowRight');
    expect(t.state('custom').settings.twist).toBe('none'); // past wired, which hex can't have
    key(radio('twist', 'none'), 'ArrowLeft');
    expect(t.state('custom').settings.twist).toBe('stuck');
  });
});
