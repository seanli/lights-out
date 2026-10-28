// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { bootModule, createMemoryStorage } from '../../../test/fake-ctx';
import sound from './index';

class FakeParam { value = 0; setValueAtTime() {} exponentialRampToValueAtTime() {} }
class FakeNode { gain = new FakeParam(); frequency = new FakeParam(); type = ''; connect(n: unknown) { return n; } start() {} stop() {} }
let created = 0;
class FakeAudio {
  state = 'running'; currentTime = 0; destination = {};
  constructor() { created++; }
  createGain() { return new FakeNode(); }
  createOscillator() { return new FakeNode(); }
  resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
}

afterEach(() => { vi.unstubAllGlobals(); created = 0; });
const pressed = { levelId: 1, index: 0, cells: Array(25).fill(false), moves: 1, litCount: 4 };

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

  test('muting is remembered across reloads and stops new sounds', () => {
    vi.stubGlobal('AudioContext', FakeAudio);
    const storage = createMemoryStorage();
    const t = bootModule(sound, { services: { storage } });
    t.emit('sound:set', { enabled: false });
    expect(t.seen('sound:changed', { enabled: false })).toBeTruthy();
    t.emit('board:pressed', pressed);
    expect(created).toBe(0);
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
});
