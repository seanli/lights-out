import { afterEach, describe, expect, test } from 'vitest';
import type { Tone, ViewService } from '../../contracts';
import { bootModule } from '../../../test/fake-ctx';
import storage from './index';

const NS = 'lights-out:v1';
const MEMORY_NOTICE = "This browser isn't saving progress, so it will be lost when you close the page.";

/** a working localStorage over a Map, with switches to make parts of it fail */
function fakeLocalStorage(opts: { failSet?: boolean; failGet?: boolean; dropWrites?: boolean } = {}) {
  const map = new Map<string, string>();
  const ls = {
    map,
    failSet: opts.failSet ?? false,
    getItem(k: string) {
      if (opts.failGet) throw new Error('SecurityError');
      return map.has(k) ? map.get(k)! : null;
    },
    setItem(k: string, val: string) {
      if (ls.failSet) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      if (!opts.dropWrites) map.set(k, String(val));
    },
    removeItem(k: string) { map.delete(k); },
    clear() { map.clear(); },
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  return ls;
}

function install(value: unknown) {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
}
function installThrowingGetter() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  });
}

function stubView() {
  const notices: { id: string; text: string; tone?: Tone }[] = [];
  const view: ViewService = {
    region: () => { throw new Error('storage renders nothing'); },
    notice: (id, text, tone) => { notices.push({ id, text, tone }); },
    clearNotice: () => {},
    reducedMotion: () => true,
  };
  return { view, notices };
}

function boot() {
  const { view, notices } = stubView();
  const t = bootModule(storage, { services: { view } });
  return { t, s: t.kernel.service('storage')!, notices };
}

afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

describe('storage', () => {
  test('a working localStorage: live mode, namespaced JSON round-trip, test key removed', () => {
    const ls = fakeLocalStorage();
    install(ls);
    const { t, s, notices } = boot();
    expect(s.mode()).toBe('live');
    expect(t.state('storage')).toEqual({ status: 'ok' });
    expect(t.seen('storage:checked')).toEqual({ status: 'ok' });
    expect(t.kernel.debug.services()[0]).toMatchObject({ service: 'browser storage', mode: 'live', ok: true });
    expect(notices).toEqual([]);
    expect([...ls.map.keys()]).toEqual([]); // the check key is gone

    expect(s.set('progress', { a: [1, 2], b: 'x' })).toBe(true);
    expect(ls.map.get(`${NS}:progress`)).toBe('{"a":[1,2],"b":"x"}');
    expect(s.get('progress')).toEqual({ a: [1, 2], b: 'x' });
    expect(s.get('missing')).toBeUndefined();
    s.remove('progress');
    expect(s.get('progress')).toBeUndefined();
  });

  test('no localStorage at all: memory mode with a plain reason and a notice', () => {
    const { t, s, notices } = boot();
    expect(s.mode()).toBe('memory');
    expect(t.state('storage')).toEqual({ status: 'memory', reason: 'this page has no local storage' });
    expect(t.seen('storage:checked')).toMatchObject({ status: 'memory' });
    expect(t.kernel.debug.services()[0]).toMatchObject({ mode: 'mock', ok: false });
    expect(t.kernel.debug.services()[0]!.detail).toMatch(/Not saving between visits because this page has no local storage/);
    expect(notices).toEqual([{ id: 'storage', text: MEMORY_NOTICE, tone: 'warn' }]);
    // the map stands in for this visit
    expect(s.set('k', { n: 1 })).toBe(false);
    expect(s.get('k')).toEqual({ n: 1 });
  });

  test('access to localStorage throws: memory mode, nothing escapes', () => {
    installThrowingGetter();
    const { t, s } = boot();
    expect(s.mode()).toBe('memory');
    expect(t.state('storage').reason).toMatch(/blocked access/);
    expect(() => { s.set('k', 1); s.get('k'); s.remove('k'); }).not.toThrow();
  });

  test('writes throw (private mode / quota): memory mode, but an existing save is still readable', () => {
    const ls = fakeLocalStorage({ failSet: true });
    ls.map.set(`${NS}:progress`, '{"kept":true}');
    install(ls);
    const { t, s } = boot();
    expect(s.mode()).toBe('memory');
    expect(t.state('storage').reason).toMatch(/refused to write.*QuotaExceededError/);
    expect(s.get('progress')).toEqual({ kept: true });
    expect(s.set('progress', { kept: false })).toBe(false);
    expect(s.get('progress')).toEqual({ kept: false }); // newest value wins for this visit
    expect(ls.map.get(`${NS}:progress`)).toBe('{"kept":true}'); // the browser copy is untouched
  });

  test('a store that silently drops writes counts as memory mode', () => {
    install(fakeLocalStorage({ dropWrites: true }));
    const { s, t } = boot();
    expect(s.mode()).toBe('memory');
    expect(t.state('storage').reason).toBe("local storage didn't keep a test value");
  });

  test('a write that starts failing later returns false and keeps the value in memory', () => {
    const ls = fakeLocalStorage();
    install(ls);
    const { t, s } = boot();
    ls.failSet = true;
    expect(s.set('progress', { v: 2 })).toBe(false);
    expect(s.get('progress')).toEqual({ v: 2 });
    expect(t.kernel.debug.logs().some((l) => l.level === 'warn' && /refused to store/.test(l.msg))).toBe(true);
    ls.failSet = false;
    expect(s.set('progress', { v: 3 })).toBe(true);
    expect(JSON.parse(ls.map.get(`${NS}:progress`)!)).toEqual({ v: 3 });
  });

  test('garbage JSON: get returns undefined, the raw text is copied to "<key>.corrupt", nothing is deleted', () => {
    const ls = fakeLocalStorage();
    ls.map.set(`${NS}:progress`, '{"version":1,"results":{');
    install(ls);
    const { t, s } = boot();
    expect(s.get('progress')).toBeUndefined();
    expect(s.get('progress.corrupt')).toBe('{"version":1,"results":{');
    expect(ls.map.get(`${NS}:progress`)).toBe('{"version":1,"results":{'); // original still there
    expect(t.kernel.debug.logs().some((l) => l.level === 'warn' && /unreadable/.test(l.msg))).toBe(true);
    // reading again doesn't pile up copies; different garbage never overwrites the first copy
    s.get('progress');
    ls.map.set(`${NS}:progress`, 'garbage two');
    s.get('progress');
    expect(s.get('progress.corrupt')).toBe('{"version":1,"results":{');
    expect(s.get('progress.corrupt-2')).toBe('garbage two');
  });

  test('values that are not plain data are refused, not thrown', () => {
    install(fakeLocalStorage());
    const { s } = boot();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(s.set('bad', loop)).toBe(false);
    expect(s.set('bad', undefined)).toBe(false);
    expect(s.get('bad')).toBeUndefined();
  });
});
