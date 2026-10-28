// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import type { DebugService, EventRecord, ModuleDef, Snapshot } from '../../contracts';
import { bootModule, fixtureData } from '../../../test/fake-ctx';
import consoleModule from './index';
import { groupEvents, isFact } from './format';

const env = { target: 'test' as const, debug: true, buildId: 't', version: '0.0.0-test' };

/** requestAnimationFrame that only runs when the test says so */
function stubFrames() {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { queue.push(fn); return queue.length; });
  return {
    pending: () => queue.length,
    flush() { const fns = queue.splice(0); fns.forEach((fn) => fn(0)); },
  };
}

function fakeDebug(over: Partial<DebugService> = {}) {
  const changeFns = new Set<() => void>();
  let events: EventRecord[] = [];
  const snap: Snapshot = { version: 1, at: 0, slices: { nav: { screen: 'home', sheet: null } } };
  const fake = {
    events: vi.fn(() => events),
    logs: vi.fn(() => []),
    modules: vi.fn(() => []),
    services: vi.fn(() => []),
    state: vi.fn(() => ({ nav: { screen: 'home', sheet: null } })),
    snapshot: vi.fn(() => snap),
    restore: vi.fn(),
    emit: vi.fn(),
    commands: vi.fn(() => ({})),
    onChange: vi.fn((fn: () => void) => { changeFns.add(fn); return () => changeFns.delete(fn); }),
    ...over,
  };
  return {
    /** every method is a vi.fn, so tests can assert on calls */
    fake: fake as unknown as DebugService & { [K in keyof DebugService]: Mock<DebugService[K]> },
    change: () => changeFns.forEach((fn) => fn()),
    setEvents: (list: EventRecord[]) => { events = list; },
    listeners: () => changeFns.size,
  };
}

const rec = (seq: number, type: string, payload: unknown = {}, input = false): EventRecord => ({ seq, type, payload, source: input ? 'input' : 'board', at: 1700000000000 + seq, input });
const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

/** a module that exposes console commands, so the real kernel's debug.commands() has something to run */
const toy: ModuleDef = {
  manifest: { name: 'toy', emits: [], listens: [], owns: [] },
  init: () => ({ commands: { echo: (args) => `echo ${args.join(' ')}`, boom: () => { throw new Error('the toy broke'); } } }),
};

function boot(debug?: DebugService, opts: { debug?: boolean; enabled?: boolean } = {}) {
  const data = opts.enabled === false ? { ...fixtureData, flags: { ...fixtureData.flags, console: { enabled: false } } } : fixtureData;
  return bootModule(consoleModule, { data, services: { env: { ...env, debug: opts.debug ?? true }, ...(debug ? { debug } : {}) } });
}

function openConsole(frames: ReturnType<typeof stubFrames>) {
  if ($('[data-console]')?.dataset.collapsed === 'true') $<HTMLElement>('.console__bar')!.click();
  frames.flush();
}

function runLine(line: string) {
  const input = $<HTMLInputElement>('[data-console-input]')!;
  input.value = line;
  input.form!.dispatchEvent(new Event('submit', { cancelable: true }));
  return $$('.console__line').at(-1)!;
}

beforeEach(() => {
  document.body.replaceChildren();
  sessionStorage.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('console', () => {
  test('renders nothing and subscribes to nothing without #debug or with the flag off', () => {
    const a = fakeDebug();
    boot(a.fake, { debug: false });
    expect($('[data-console]')).toBeNull();
    expect(a.fake.onChange).not.toHaveBeenCalled();

    const b = fakeDebug();
    boot(b.fake, { enabled: false });
    expect($('[data-console]')).toBeNull();
    expect(b.fake.onChange).not.toHaveBeenCalled();
  });

  test('with debug: a slim bar first, then sections with the real game state', () => {
    const frames = stubFrames();
    const t = boot();
    t.kernel.seed('board', { status: 'playing', levelId: 7, start: Array(25).fill(false), cells: Array.from({ length: 25 }, (_, i) => i % 6 === 0), par: 5, moves: 2, history: [0, 6] });
    frames.flush();
    const root = $('[data-console]')!;
    expect(root.dataset.collapsed).toBe('true');
    openConsole(frames);
    expect(root.dataset.collapsed).toBe('false');
    const ids = $$('[data-console-section]').map((el) => el.dataset.consoleSection);
    expect(ids).toEqual(['state', 'events', 'log', 'modules', 'services', 'snapshots']);
    const state = $('[data-console-content="state"]')!;
    expect(state.textContent).toContain('2 deep');
    const rows = [...state.querySelectorAll('.console__grid > div')].map((r) => r.textContent);
    expect(rows).toEqual(['10000', '01000', '00100', '00010', '00001']);
    // a slice expands to full JSON
    state.querySelector<HTMLElement>('[data-slice="board"]')!.click();
    frames.flush();
    expect(state.querySelector('pre')!.textContent).toContain('"moves": 2');
    // collapsed/open state survives a reload of the module
    expect(JSON.parse(sessionStorage.getItem('lights-out:console')!).collapsed).toBe(false);
  });

  test('a shaped board draws rows × cols with its gaps as spaces', () => {
    const frames = stubFrames();
    const t = boot();
    const cross = [false, false, true, true, true, false, false];
    const mask = [...cross, ...cross, ...Array(21).fill(true), ...cross, ...cross];
    t.kernel.seed('board', { status: 'playing', levelId: 4001, start: Array(49).fill(false), cells: Array.from({ length: 49 }, (_, i) => i === 2), par: 1, moves: 0, history: [], shape: { cols: 7, rows: 7, mask } });
    frames.flush();
    openConsole(frames);
    const state = $('[data-console-content="state"]')!;
    const rows = [...state.querySelectorAll('.console__grid > div')].map((r) => r.textContent!.replace(/\u2007/g, ' '));
    expect(rows).toEqual(['  100  ', '  000  ', '0000000', '0000000', '0000000', '  000  ', '  000  ']);
    expect(state.textContent).toContain('1/49');
  });

  test('consecutive same-type events collapse into one row with a count; tap bursts too', () => {
    const frames = stubFrames();
    const d = fakeDebug();
    d.setEvents([
      rec(1, 'offline:status_changed'), rec(2, 'offline:status_changed'), rec(3, 'offline:status_changed'),
      rec(4, 'board:press', { index: 0 }, true), rec(5, 'board:pressed', { index: 0, moves: 1 }),
      rec(6, 'board:press', { index: 6 }, true), rec(7, 'board:pressed', { index: 6, moves: 2 }),
      rec(8, 'hints:request', {}, true),
    ]);
    boot(d.fake);
    openConsole(frames);
    const rows = $$('[data-console-content="events"] .console__row');
    expect(rows.map((r) => r.children[1]!.textContent)).toEqual(['hints:request', 'board:press→pressed', 'offline:status_changed']);
    expect(rows[1]!.querySelector('.console__count')!.textContent).toBe('×2');
    expect(rows[2]!.querySelector('.console__count')!.textContent).toBe('×3');
    expect(rows[1]!.classList.contains('console__row--repeat')).toBe(true);
    // inputs are marked; commands and facts are told apart
    expect(rows[0]!.dataset.input).toBe('true');
    expect(rows[2]!.dataset.input).toBeUndefined();
    expect(rows[1]!.querySelector('[data-kind="command"]')!.textContent).toBe('board:press');
    expect(rows[1]!.querySelector('[data-kind="fact"]')!.getAttribute('title')).toBe('board:pressed');
    // clear empties the view, not the record
    runLine('clear');
    frames.flush();
    expect($$('[data-console-content="events"] .console__row')).toHaveLength(0);
  });

  test('groupEvents and isFact', () => {
    const g = groupEvents([rec(1, 'a:x'), rec(2, 'a:x'), rec(3, 'b:y'), rec(4, 'a:x')], 200);
    expect(g.map((x) => [x.types.join('>'), x.count])).toEqual([['a:x', 1], ['b:y', 1], ['a:x', 2]]);
    expect(groupEvents([rec(1, 'a:x'), rec(2, 'a:x')], 1)).toHaveLength(1);
    expect(['board:press', 'board:pressed', 'offline:status_changed', 'hints:shown', 'levels:start', 'hints:request'].map(isFact))
      .toEqual([false, true, true, true, false, false]);
  });

  test('command line: emit with JSON, module commands, history, and errors in words', () => {
    const frames = stubFrames();
    const t = bootModule(toy, { services: { env } });
    // boot the console against the same kernel's real debug service
    const d = t.kernel.debug;
    const emit = vi.spyOn(d, 'emit');
    boot(d);
    openConsole(frames);

    runLine('emit nav:go {"screen": "play"}');
    expect(emit).toHaveBeenCalledWith('nav:go', { screen: 'play' });

    expect(runLine('toy.echo 1 2').textContent).toContain('echo 1 2');
    expect(runLine('help').textContent).toContain('toy.echo');

    const bad = runLine('emit nav:go {screen: play}');
    expect(bad.dataset.tone).toBe('error');
    expect(bad.textContent).toMatch(/not valid JSON/);
    expect(runLine('emit nav:go [1]').textContent).toMatch(/must be a JSON object/);
    expect(runLine('emit').textContent).toMatch(/Usage: emit/);
    const unknown = runLine('levels.nope 3');
    expect(unknown.dataset.tone).toBe('error');
    expect(unknown.textContent).toContain('Unknown command "levels.nope"');
    const boom = runLine('toy.boom');
    expect(boom.dataset.tone).toBe('error');
    expect(boom.textContent).toContain('toy.boom failed: the toy broke');
    expect(runLine('state nope').textContent).toMatch(/There is no "nope" slice/);

    // ↑ walks back through history
    const input = $<HTMLInputElement>('[data-console-input]')!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(input.value).toBe('state nope');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(input.value).toBe('toy.boom');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(input.value).toBe('state nope');
  });

  test('snapshots: save keeps up to 5 and restore hands the right one to the debug service', () => {
    const frames = stubFrames();
    let n = 0;
    const d = fakeDebug({ snapshot: vi.fn((): Snapshot => ({ version: 1, at: 1700000000000 + ++n, slices: { n } })) });
    boot(d.fake);
    openConsole(frames);
    $('[data-console-section="snapshots"]')!.click();
    frames.flush();
    for (let i = 0; i < 6; i++) { $<HTMLElement>('[data-console-snap]')!.click(); frames.flush(); }
    expect(d.fake.snapshot).toHaveBeenCalledTimes(6);
    const saved = $$('[data-snapshot]').map((el) => el.dataset.snapshot);
    expect(saved).toEqual(['6', '5', '4', '3', '2']);
    $<HTMLElement>('[data-console-restore="3"]')!.click();
    expect(d.fake.restore).toHaveBeenCalledWith(expect.objectContaining({ slices: { n: 3 } }));
    expect(runLine('restore 1').textContent).toContain('There is no snapshot #1');
    runLine('restore 6');
    expect(d.fake.restore).toHaveBeenLastCalledWith(expect.objectContaining({ slices: { n: 6 } }));
  });

  test('rendering is throttled to one per frame and skips closed sections', () => {
    const frames = stubFrames();
    const d = fakeDebug();
    const t = boot(d.fake);
    openConsole(frames);
    const inst = () => t.instance!.debug!() as { renders: number };
    const before = inst().renders;
    d.fake.events.mockClear();
    d.change(); d.change(); d.change(); d.change();
    expect(frames.pending()).toBe(1);
    frames.flush();
    expect(inst().renders).toBe(before + 1);
    expect(d.fake.events).toHaveBeenCalledTimes(1);

    // collapsed: only the bar renders, sections aren't read
    $<HTMLElement>('.console__bar')!.click();
    frames.flush();
    d.fake.events.mockClear();
    d.fake.state.mockClear();
    d.change();
    frames.flush();
    expect(d.fake.events).not.toHaveBeenCalled();
    expect(d.fake.state).not.toHaveBeenCalled();
  });

  test('stop unsubscribes and removes the console', () => {
    stubFrames();
    const d = fakeDebug();
    const t = boot(d.fake);
    expect(d.listeners()).toBe(1);
    t.instance!.stop!();
    expect(d.listeners()).toBe(0);
    expect($('[data-console]')).toBeNull();
  });
});
