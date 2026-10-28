// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { bootModule, createFakeView, createMemoryStorage } from '../../../test/fake-ctx';
import rulesData from '../../../test/fixtures/data/rules.json';
import sound from './index';

const R = rulesData.sound;
const hz = (step: number) => 220 * 2 ** (step / 12);

class FakeParam { value = 0; setValueAtTime(v: number) { this.value = v; } exponentialRampToValueAtTime() {} }
interface Note { freq: number; at: number; type: string; detune: number; dest: unknown }
let created = 0;
let notes: Note[] = [];
let panners = 0;
class FakeNode {
  gain = new FakeParam(); frequency = new FakeParam(); detune = new FakeParam(); Q = new FakeParam(); pan = new FakeParam(); type = '';
  dest: unknown = null;
  connect(n: unknown) { this.dest = n; return n; }
  start(t: number) { notes.push({ freq: this.frequency.value, at: t, type: this.type, detune: this.detune.value, dest: (this.dest as FakeNode | null)?.dest }); }
  stop() {}
}
class FakeAudio {
  state = 'running'; currentTime = 0; destination = {};
  constructor() { created++; }
  createGain() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  createBiquadFilter() { return new FakeNode(); }
  createStereoPanner() { panners++; return new FakeNode(); }
  resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
}

afterEach(() => { vi.unstubAllGlobals(); created = 0; notes = []; panners = 0; delete (navigator as { vibrate?: unknown }).vibrate; });
const pressed = { levelId: 1, index: 0, cells: Array(25).fill(false), moves: 1, litCount: 4 };
const withVibrate = () => {
  const vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
  return vibrate;
};
const motionView = (reduced: boolean) => ({ ...createFakeView(), reducedMotion: () => reduced });

describe('sound', () => {
  test('no audio is created until a tap event', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const t = bootModule(sound);
    expect(t.state('sound')).toEqual({ enabled: true, status: 'idle' });
    expect(created).toBe(0);
    t.emit('board:pressed', pressed);
    expect(created).toBe(1);
    expect(t.state('sound').status).toBe('ready');
  });

  test('muting is remembered across reloads and stops new sounds and vibrations', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const vibrate = withVibrate();
    const storage = createMemoryStorage();
    const t = bootModule(sound, { services: { storage } });
    t.emit('sound:set', { enabled: false });
    expect(t.seen('sound:changed', { enabled: false })).toBeTruthy();
    t.emit('board:pressed', pressed);
    expect(created).toBe(0);
    expect(vibrate).not.toHaveBeenCalled();
    const again = bootModule(sound, { services: { storage } });
    expect(again.state('sound').enabled).toBe(false);
  });

  test('a browser without Web Audio stays silent and says so', () => {
    vi.stubGlobal('AudioContext', undefined);
    const t = bootModule(sound);
    expect(t.state('sound').status).toBe('unavailable');
    expect(() => t.emit('board:solved', { levelId: 1, moves: 3, par: 3 })).not.toThrow();
  });

  test('a constructor that throws is reported, not fatal', () => {
    vi.stubGlobal('AudioContext', class { constructor() { throw new Error('NotAllowedError'); } });
    const t = bootModule(sound);
    t.emit('board:pressed', pressed);
    expect(t.state('sound').status).toBe('unavailable');
    expect(t.kernel.debug.services().find((s) => s.service === 'audio')?.ok).toBe(false);
  });

  test('audio warms up just after a level starts, so the first board tap is cheap', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const t = bootModule(sound);
    t.emit('levels:started', { levelId: 1, par: 1, count: 50 });
    expect(created).toBe(0);
    t.clock.advance(0);
    expect(created).toBe(1);
    t.emit('board:pressed', pressed);
    expect(created).toBe(1);
  });

  test('haptics: the data patterns where vibrate exists; nothing for undo or restart', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const vibrate = withVibrate();
    const t = bootModule(sound);
    expect(t.kernel.debug.services().find((s) => s.service === 'haptics')?.mode).toBe('live');
    t.emit('board:pressed', pressed);
    t.emit('hints:shown', { levelId: 1, index: 3 });
    t.emit('board:solved', { levelId: 1, moves: 3, par: 3 });
    expect(vibrate.mock.calls).toEqual([[R.haptics.tap], [R.haptics.hint], [R.haptics.solved]]);
    t.emit('board:undone', { levelId: 1, index: 0, cells: pressed.cells, moves: 0 });
    t.emit('board:restarted', { levelId: 1, cells: pressed.cells });
    expect(vibrate).toHaveBeenCalledTimes(3);
  });

  test('haptics: silent where the device cannot vibrate, and the console says so', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const t = bootModule(sound);
    expect('vibrate' in navigator).toBe(false);
    expect(() => t.emit('board:pressed', pressed)).not.toThrow();
    expect(t.kernel.debug.services().find((s) => s.service === 'haptics')).toMatchObject({ mode: 'mock', ok: true });
  });

  test('the winning tap plays the arpeggio instead of the blip', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const t = bootModule(sound);
    t.emit('board:pressed', { ...pressed, litCount: 0 });
    t.emit('board:solved', { levelId: 1, moves: 1, par: 1 });
    expect(notes.map((n) => n.type)).toEqual(R.win.steps.map(() => 'sine'));
    expect(notes.map((n) => n.freq)).toEqual(R.win.steps.map(hz));
    expect(notes.map((n) => n.at)).toEqual(R.win.steps.map((_, k) => (k * R.win.stepMs) / 1000));
  });

  test('a tap detunes and pans by column (from the board shape), reusing one panner per column', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const t = bootModule(sound);
    t.emit('board:loaded', { levelId: 3001, cells: Array(49).fill(false), par: 3, shape: { cols: 7, rows: 7, mask: null } });
    t.emit('board:pressed', { ...pressed, index: 7 }); // column 0 of 7: left edge
    t.emit('board:pressed', { ...pressed, index: 13 }); // column 6: right edge
    t.emit('board:pressed', { ...pressed, index: 3 }); // centre column
    t.emit('board:pressed', { ...pressed, index: 0 }); // left edge again
    expect(notes.map((n) => n.detune)).toEqual([-R.tap.detuneCents, R.tap.detuneCents, 0, -R.tap.detuneCents]);
    expect(panners).toBe(2);
    expect(notes[0]!.type).toBe('triangle');
  });

  test('restart plays two soft descending notes', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const t = bootModule(sound);
    t.emit('board:restarted', { levelId: 1, cells: pressed.cells });
    expect(notes.map((n) => n.freq)).toEqual(R.restart.steps.map(hz));
    expect(notes[1]!.at).toBeCloseTo(R.restart.stepMs / 1000);
  });

  const solveAndOpen = (t: ReturnType<typeof bootModule>, stars: 1 | 2 | 3, sheetFirst: boolean) => {
    const done = { levelId: 4, stars, moves: 5, par: 5, hintsUsed: 0, improved: true, unlocked: 5, allSolved: false, firstSolve: true };
    const sheet = () => { t.kernel.seed('nav', { screen: 'play', sheet: 'solved' }); t.emit('nav:changed', { screen: 'play', sheet: 'solved' }); };
    if (sheetFirst) { sheet(); t.emit('progress:level_completed', done); } else { t.emit('progress:level_completed', done); sheet(); }
  };

  test('star pings: one per earned star, timed from the rules, in either event order, only once', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    for (const sheetFirst of [false, true]) {
      notes = [];
      const t = bootModule(sound, { services: { view: motionView(false) } });
      solveAndOpen(t, 2, sheetFirst);
      expect(notes.map((n) => n.freq)).toEqual([hz(24), hz(26)]);
      expect(notes.map((n) => n.at)).toEqual([R.stars.startMs / 1000, (R.stars.startMs + R.stars.stepMs) / 1000]);
      t.emit('nav:changed', { screen: 'play', sheet: 'solved' });
      expect(notes).toHaveLength(2);
    }
  });

  test('reduced motion skips the star pings (the stars appear at once)', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const t = bootModule(sound, { services: { view: motionView(true) } });
    solveAndOpen(t, 3, false);
    expect(notes).toHaveLength(0);
  });
});
