// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { bootModule, createFakeView, createMemoryStorage } from '../../../test/fake-ctx';
import rulesData from '../../../test/fixtures/data/rules.json';
import sound from './index';
import { db2a, peakOf, renderGlass, renderRestart, renderTake, renderUndo, renderWin, type Click, type Glass } from './synth';

const R = rulesData.sound;
const SR = 48000;

// ---- a fake AudioContext that keeps the real rendered samples, so tests can listen to them ----
class FakeParam { value = 0; setValueAtTime(v: number) { this.value = v; } setTargetAtTime() {} }
class FakeBuffer {
  data: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) { this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length)); }
  copyToChannel(d: Float32Array, i: number) { this.data[i]!.set(d); }
  get ms() { return (this.length / this.sampleRate) * 1000; }
}
class FakeNode {
  gain = new FakeParam(); pan = new FakeParam(); playbackRate = new FakeParam(); buffer: FakeBuffer | null = null;
  dest: FakeNode | null = null;
  constructor(public kind: string) { this.gain.value = 1; this.playbackRate.value = 1; }
  connect(n: FakeNode) { this.dest = n; return n; }
  start(at: number) {
    const g = this.dest!;
    played.push({ buffer: this.buffer!, at, rate: this.playbackRate.value, gain: g.gain.value, pan: g.dest?.kind === 'panner' ? g.dest.pan.value : 0, panner: g.dest?.kind === 'panner' ? g.dest : null });
  }
}
interface Played { buffer: FakeBuffer; at: number; rate: number; gain: number; pan: number; panner: FakeNode | null }
let created = 0;
let played: Played[] = [];
class FakeAudio {
  state = 'running'; currentTime = 0; destination = new FakeNode('destination'); sampleRate = SR;
  constructor() { created++; }
  createGain() { return new FakeNode('gain'); }
  createBufferSource() { return new FakeNode('source'); }
  createStereoPanner() { return new FakeNode('panner'); }
  createBuffer(ch: number, len: number, rate: number) { return new FakeBuffer(ch, len, rate); }
  resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
}

afterEach(() => { vi.unstubAllGlobals(); created = 0; played = []; delete (navigator as { vibrate?: unknown }).vibrate; });
const cellsWith = (on: boolean, index = 0, n = 25) => Array.from({ length: n }, (_, i) => (i === index ? on : false));
const press = (index: number, on: boolean, n = 25) => ({ levelId: 1, index, cells: cellsWith(on, index, n), moves: 1, litCount: on ? 1 : 3 });
const withVibrate = () => {
  const vibrate = vi.fn(() => true);
  Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true, writable: true });
  return vibrate;
};
const motionView = (reduced: boolean) => ({ ...createFakeView(), reducedMotion: () => reduced });
/** boot, start a level and let the warm-up finish */
const warm = (opts: Parameters<typeof bootModule>[1] = {}) => {
  vi.stubGlobal('AudioContext', FakeAudio);
  const t = bootModule(sound, opts);
  t.emit('levels:started', { levelId: 1, par: 1, count: 50 });
  t.clock.advance(0);
  return t;
};
interface Info { takes: { on: number; off: number }; built: string[]; stars: number; building: string[]; steps: number }
const info = (t: ReturnType<typeof bootModule>) => t.instance!.debug!() as Info;
/** mean squared frequency, relative: how bright a sound is */
const brightness = (x: Float32Array) => { let d = 0, e = 0; for (let i = 1; i < x.length; i++) { d += (x[i]! - x[i - 1]!) ** 2; e += x[i]! ** 2; } return d / e; };
/** ms until the sound stays 60 dB under its own peak */
const msTo60 = (x: Float32Array, sr = SR) => { const floor = peakOf(x) * 1e-3; let last = x.length - 1; while (last > 0 && Math.abs(x[last]!) < floor) last--; return (last / sr) * 1000; };
const seeded = (seed: number) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

describe('sound', () => {
  test('no audio is created until a tap event', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const t = bootModule(sound);
    expect(t.state('sound')).toEqual({ enabled: true, status: 'idle' });
    expect(created).toBe(0);
    t.emit('board:pressed', press(0, true));
    expect(created).toBe(1);
    expect(t.state('sound').status).toBe('ready');
    expect(played).toHaveLength(1); // a tap before the warm-up still clicks: one take is made on the spot
  });

  test('after a level starts, every sound is built in many short steps, taps first and the win last', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const t = bootModule(sound);
    t.emit('levels:started', { levelId: 1, par: 1, count: 50 });
    expect(created).toBe(0);
    t.clock.advance(0);
    expect(created).toBe(1);
    const state = info(t);
    expect(state.takes).toEqual({ on: R.takes, off: R.takes });
    expect(state.built).toEqual(['hint', 'undo', 'restart', 'win']);
    expect(state.stars).toBe(R.stars.hz.length);
    expect(state.building).toEqual([]);
    // one take per step, and the win in slices: far more steps than sounds
    expect(state.steps).toBeGreaterThan(2 * R.takes + 6 + R.win.relays);
    t.emit('board:pressed', press(0, true));
    expect(created).toBe(1);
  });

  test('switching a light on plays a brighter click than switching one off', () => {
    const t = warm();
    for (let k = 0; k < 24; k++) t.emit('board:pressed', press(12, k % 2 === 0));
    const avg = (side: number) => { const b = played.filter((_, k) => k % 2 === side).map((p) => brightness(p.buffer.data[0]!)); return b.reduce((x, y) => x + y) / b.length; };
    expect(avg(0)).toBeGreaterThan(avg(1) * 1.3);
    expect(new Set(played.filter((_, k) => k % 2 === 0).map((p) => p.buffer)).size).toBeGreaterThan(1);
  });

  test('forty taps in a row never repeat a take back to back, and vary a little in pitch and level', () => {
    const t = warm();
    for (let k = 0; k < 40; k++) t.emit('board:pressed', press(12, true));
    for (let k = 1; k < played.length; k++) expect(played[k]!.buffer).not.toBe(played[k - 1]!.buffer);
    for (const p of played) {
      expect(Math.abs(p.rate - 1)).toBeLessThanOrEqual(R.vary.pitch + 1e-9);
      expect(Math.abs(20 * Math.log10(p.gain))).toBeLessThanOrEqual(R.vary.db + 1e-9);
      expect(peakOf(p.buffer.data[0]!) * p.gain).toBeLessThanOrEqual(db2a(-6)); // never louder than -6 dBFS
    }
    expect(new Set(played.map((p) => p.rate)).size).toBeGreaterThan(30);
  });

  test('pan follows the column and stays subtle on any width; one panner per position', () => {
    const t = warm();
    t.emit('board:loaded', { levelId: 9001, cells: Array(100).fill(false), par: 9, shape: { cols: 10, rows: 10, mask: null } });
    for (let c = 0; c < 10; c++) t.emit('board:pressed', press(50 + c, true, 100));
    expect(played[0]!.pan).toBeCloseTo(-R.pan);
    expect(played[9]!.pan).toBeCloseTo(R.pan);
    expect(played.map((p) => p.pan)).toEqual([...played.map((p) => p.pan)].sort((a, b) => a - b));
    t.emit('board:loaded', { levelId: 9501, cells: Array(80).fill(false), par: 9, shape: { cols: 5, rows: 16, mask: null } });
    t.emit('board:pressed', press(79, true, 80)); // the tower's bottom-right cell
    expect(played.at(-1)!.pan).toBeCloseTo(R.pan);
    expect(played.every((p) => Math.abs(p.pan) <= R.pan + 1e-9)).toBe(true);
    const panners = new Set(played.map((p) => p.panner).filter(Boolean));
    expect(panners.size).toBe(new Set(played.map((p) => p.pan).filter((p) => p !== 0)).size);
  });

  test('the winning tap clicks off, then the win plays; a boss level gets its own fuller win, no louder', () => {
    const t = warm();
    t.emit('board:pressed', { levelId: 1, index: 3, cells: Array(25).fill(false), moves: 3, litCount: 0 });
    t.emit('board:solved', { levelId: 1, moves: 3, par: 3 });
    expect(played).toHaveLength(2);
    expect(played[0]!.buffer.numberOfChannels).toBe(1);
    const win = played[1]!.buffer;
    expect(win.numberOfChannels).toBe(2);
    t.emit('levels:started', { levelId: 10, par: 9, count: 50, boss: true });
    t.clock.advance(150); // warm-up waits out the quiet window after a press
    t.emit('board:solved', { levelId: 10, moves: 9, par: 9 });
    const boss = played.at(-1)!.buffer;
    expect(boss).not.toBe(win);
    expect(boss.numberOfChannels).toBe(2);
    expect(Math.max(peakOf(boss.data[0]!), peakOf(boss.data[1]!))).toBeLessThanOrEqual(Math.max(peakOf(win.data[0]!), peakOf(win.data[1]!)) * 1.001);
    expect(boss.ms).toBeLessThanOrEqual(win.ms * 1.15);
    // the next ordinary level is back to the ordinary win
    t.emit('levels:started', { levelId: 11, par: 3, count: 50 });
    t.emit('board:solved', { levelId: 11, moves: 3, par: 3 });
    expect(played.at(-1)!.buffer).toBe(win);
  });

  test('warm-up steps wait out a quiet window after each press, so taps keep their frames', () => {
    const t = warm();
    t.emit('levels:started', { levelId: 10, par: 9, count: 50, boss: true });
    t.emit('board:pressed', press(0, true));
    t.clock.advance(100);
    t.emit('board:solved', { levelId: 10, moves: 9, par: 9 });
    const early = played.at(-1)!.buffer;
    t.clock.advance(60);
    t.emit('board:solved', { levelId: 10, moves: 9, par: 9 });
    expect(played.at(-1)!.buffer).not.toBe(early); // the boss win was built once the window passed
  });

  test('undo, restart and hint each have their own short sound', () => {
    const t = warm();
    t.emit('board:pressed', press(0, true));
    t.emit('board:undone', { levelId: 1, index: 0, cells: cellsWith(false), moves: 0 });
    t.emit('board:restarted', { levelId: 1, cells: cellsWith(false) });
    t.emit('hints:shown', { levelId: 1, index: 3 });
    const [tap, undo, restart, hint] = played.map((p) => p.buffer);
    expect(new Set([tap, undo, restart, hint]).size).toBe(4);
    expect(undo!.ms).toBeLessThan(60);
    expect(restart!.ms).toBeGreaterThan(R.restart.flicks[1]!.atMs); // two flicks
    expect(restart!.ms).toBeLessThan(200);
    expect(hint!.ms).toBeLessThan(250);
  });

  test('muting is remembered across reloads and stops new sounds and vibrations', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const vibrate = withVibrate();
    const storage = createMemoryStorage();
    const t = bootModule(sound, { services: { storage } });
    t.emit('sound:set', { enabled: false });
    expect(t.seen('sound:changed', { enabled: false })).toBeTruthy();
    t.emit('board:pressed', press(0, true));
    expect(created).toBe(0);
    expect(vibrate).not.toHaveBeenCalled();
    const again = bootModule(sound, { services: { storage } });
    expect(again.state('sound').enabled).toBe(false);
    again.emit('sound:set', { enabled: true });
    expect(played).toHaveLength(1); // turning it on clicks the switch
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
    t.emit('board:pressed', press(0, true));
    expect(t.state('sound').status).toBe('unavailable');
    expect(t.kernel.debug.services().find((s) => s.service === 'audio')?.ok).toBe(false);
  });

  test('haptics: the data patterns where vibrate exists; nothing for undo or restart', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const vibrate = withVibrate();
    const t = bootModule(sound);
    expect(t.kernel.debug.services().find((s) => s.service === 'haptics')?.mode).toBe('live');
    t.emit('board:pressed', press(0, true));
    t.emit('hints:shown', { levelId: 1, index: 3 });
    t.emit('board:solved', { levelId: 1, moves: 3, par: 3 });
    expect(vibrate.mock.calls).toEqual([[R.haptics.tap], [R.haptics.hint], [R.haptics.solved]]);
    t.emit('board:undone', { levelId: 1, index: 0, cells: cellsWith(false), moves: 0 });
    t.emit('board:restarted', { levelId: 1, cells: cellsWith(false) });
    expect(vibrate).toHaveBeenCalledTimes(3);
  });

  test('haptics: silent where the device cannot vibrate, and the console says so', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const t = bootModule(sound);
    expect('vibrate' in navigator).toBe(false);
    expect(() => t.emit('board:pressed', press(0, true))).not.toThrow();
    expect(t.kernel.debug.services().find((s) => s.service === 'haptics')).toMatchObject({ mode: 'mock', ok: true });
  });

  const solveAndOpen = (t: ReturnType<typeof bootModule>, stars: 1 | 2 | 3, sheetFirst: boolean) => {
    const done = { levelId: 4, stars, moves: 5, par: 5, hintsUsed: 0, improved: true, unlocked: 5, allSolved: false, firstSolve: true };
    const sheet = () => { t.kernel.seed('nav', { screen: 'play', sheet: 'solved' }); t.emit('nav:changed', { screen: 'play', sheet: 'solved' }); };
    if (sheetFirst) { sheet(); t.emit('progress:level_completed', done); } else { t.emit('progress:level_completed', done); sheet(); }
  };

  test('star ticks: one rising glass tick per earned star, timed from the rules, in either event order, only once', () => {
    for (const sheetFirst of [false, true]) {
      played = [];
      const t = warm({ services: { view: motionView(false) } });
      solveAndOpen(t, 2, sheetFirst);
      expect(played.map((p) => p.at)).toEqual([R.stars.startMs / 1000, (R.stars.startMs + R.stars.stepMs) / 1000]);
      expect(brightness(played[1]!.buffer.data[0]!)).toBeGreaterThan(brightness(played[0]!.buffer.data[0]!));
      t.emit('nav:changed', { screen: 'play', sheet: 'solved' });
      expect(played).toHaveLength(2);
    }
  });

  test('reduced motion skips the star ticks (the stars appear at once)', () => {
    const t = warm({ services: { view: motionView(true) } });
    solveAndOpen(t, 3, false);
    expect(played).toHaveLength(0);
  });
});

describe('synth (the Wall switch numbers in rules.json)', () => {
  const on = R.on as Click, off = R.off as Click;
  test('taps peak where the rules say (never above -6 dBFS) and fall silent within 120ms, neighbour ticks included', () => {
    const rnd = seeded(1);
    for (const c of [on, off]) {
      for (let k = 0; k < 6; k++) {
        const x = renderTake(SR, c, rnd, R.ceilingHz, R.vary.filter, R.neighbours);
        expect(20 * Math.log10(peakOf(x))).toBeCloseTo(c.peakDb!, 3);
        expect(msTo60(x)).toBeLessThan(120);
        expect(msTo60(x)).toBeGreaterThan(R.neighbours.atMs.at(-1)!); // the neighbours' ticks are in it
      }
    }
  });

  test('the same seed builds the same takes; another seed builds different ones', () => {
    const a = renderTake(SR, on, seeded(3), R.ceilingHz, R.vary.filter, R.neighbours);
    const b = renderTake(SR, on, seeded(3), R.ceilingHz, R.vary.filter, R.neighbours);
    const c = renderTake(SR, on, seeded(4), R.ceilingHz, R.vary.filter, R.neighbours);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  test('undo, restart, hint, stars and win stay at their levels; the win settles within ~2.2s', () => {
    const rnd = seeded(2);
    const level = (x: Float32Array) => 20 * Math.log10(peakOf(x));
    expect(level(renderUndo(SR, R.undo, off, rnd, R.ceilingHz))).toBeCloseTo(R.undo.peakDb, 3);
    expect(level(renderRestart(SR, { ...R.restart, flicks: R.restart.flicks as { click: 'on' | 'off'; atMs: number; db: number }[] }, { on, off }, rnd, R.ceilingHz))).toBeCloseTo(R.restart.peakDb, 3);
    expect(level(renderGlass(SR, R.hint as Glass, R.hint.hz[0]!, rnd, R.ceilingHz))).toBeCloseTo(R.hint.peakDb, 3);
    const gen = renderWin(24000, { ...R.win, relayGain: R.win.relayGain as [number, number] }, R.relay as Click, rnd, R.ceilingHz, 2048);
    let r = gen.next();
    while (!r.done) r = gen.next();
    const [left, right] = r.value;
    expect(Math.max(level(left), level(right))).toBeCloseTo(R.win.peakDb, 3);
    expect(Math.max(msTo60(left, 24000), msTo60(right, 24000))).toBeLessThan(2300);
  });
});
