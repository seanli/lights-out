// storage: browser localStorage behind a service that never throws. When the browser won't store
// anything, an in-memory map stands in and the player is told in plain words.
import * as v from 'valibot';
import type { ModuleDef, StorageService } from '../../contracts';

const CHECK_KEY = '__check__';
const CHECK_VALUE = 'ok';
const MAX_CORRUPT_COPIES = 5;

const RulesSchema = v.object({ namespace: v.pipe(v.string(), v.minLength(1)) });
const CopySchema = v.object({ memoryNotice: v.string() });

const errText = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

const storage: ModuleDef = {
  manifest: {
    name: 'storage',
    emits: ['storage:checked'],
    listens: [],
    owns: ['storage'],
    provides: ['storage'],
    optional: ['view'],
    data: { rules: RulesSchema, copy: CopySchema },
  },
  init(ctx) {
    const rules: v.InferOutput<typeof RulesSchema> = ctx.data.rules;
    const copy: v.InferOutput<typeof CopySchema> = ctx.data.copy;
    const full = (key: string) => `${rules.namespace}:${key}`;
    /** values that couldn't go to the browser (memory mode, or a refused write); newer than what the browser holds */
    const memory = new Map<string, string>();

    /**
     * Write, read back and remove a test key; any failure means memory mode.
     * `ls` stays set whenever the browser lets us read, so a full or read-only store still shows the existing save.
     */
    function check(): { ls: Storage | null; durable: boolean; reason?: string } {
      let ls: Storage | null | undefined;
      try {
        ls = globalThis.localStorage;
      } catch (err) {
        return { ls: null, durable: false, reason: `the browser blocked access to local storage (${errText(err)})` };
      }
      if (!ls) return { ls: null, durable: false, reason: 'this page has no local storage' };
      const key = full(CHECK_KEY);
      let back: unknown;
      try {
        ls.setItem(key, CHECK_VALUE);
        back = ls.getItem(key);
      } catch (err) {
        let readable = false;
        try { ls.getItem(key); readable = true; } catch { /* not even readable */ }
        return { ls: readable ? ls : null, durable: false, reason: `the browser refused to write to local storage (${errText(err)})` };
      }
      try { ls.removeItem(key); } catch (err) { ctx.log.warn('Could not remove the storage test key', errText(err)); }
      if (back !== CHECK_VALUE) return { ls: null, durable: false, reason: "local storage didn't keep a test value" };
      return { ls, durable: true };
    }

    const { ls, durable, reason } = check();

    /** raw text under a full key: memory first (it holds writes newer than the browser), then the browser */
    function readText(k: string): string | null {
      const mem = memory.get(k);
      if (mem !== undefined) return mem;
      if (!ls) return null;
      try {
        return ls.getItem(k);
      } catch (err) {
        ctx.log.warn(`Couldn't read "${k}" from browser storage`, errText(err));
        return null;
      }
    }

    /** true when the text reached the browser; otherwise it is kept in memory for this visit */
    function writeText(k: string, text: string): boolean {
      if (durable && ls) {
        try {
          ls.setItem(k, text);
          memory.delete(k);
          return true;
        } catch (err) {
          ctx.log.warn(`The browser refused to store "${k}"; keeping it in memory for this visit`, errText(err));
        }
      }
      memory.set(k, text);
      return false;
    }

    /** copy unreadable text to "<key>.corrupt" (or the first free "<key>.corrupt-N"), never over an earlier copy */
    function keepCorrupt(key: string, raw: string): string {
      const copyText = JSON.stringify(raw);
      for (let n = 1; n <= MAX_CORRUPT_COPIES; n++) {
        const name = n === 1 ? `${key}.corrupt` : `${key}.corrupt-${n}`;
        const existing = readText(full(name));
        if (existing === copyText) return name;
        if (existing === null || n === MAX_CORRUPT_COPIES) {
          writeText(full(name), copyText);
          return name;
        }
      }
      return `${key}.corrupt`;
    }

    const service: StorageService = {
      get(key) {
        const raw = readText(full(key));
        if (raw === null || raw === undefined) return undefined;
        try {
          return JSON.parse(String(raw));
        } catch {
          // never destroy what we can't read: keep the raw text beside it
          const name = keepCorrupt(key, String(raw));
          ctx.log.warn(`"${key}" held unreadable data; a copy of the raw text is kept under "${name}"`);
          return undefined;
        }
      },
      set(key, value) {
        let text: string | undefined;
        try {
          text = JSON.stringify(value);
        } catch (err) {
          ctx.log.error(`Couldn't store "${key}": the value isn't plain data`, errText(err));
          return false;
        }
        if (text === undefined) {
          ctx.log.error(`Couldn't store "${key}": there is no value to store`);
          return false;
        }
        return writeText(full(key), text);
      },
      remove(key) {
        const k = full(key);
        memory.delete(k);
        if (!ls) return;
        try { ls.removeItem(k); } catch (err) { ctx.log.warn(`Couldn't remove "${key}" from browser storage`, errText(err)); }
      },
      mode: () => (durable ? 'live' : 'memory'),
    };
    ctx.provide('storage', service);

    if (durable) {
      ctx.write('storage', { status: 'ok' });
      ctx.report({ service: 'browser storage', mode: 'live', ok: true, detail: "Saving to this browser's local storage." });
    } else {
      ctx.write('storage', { status: 'memory', reason });
      ctx.report({
        service: 'browser storage',
        mode: 'mock',
        ok: false,
        detail: `Not saving between visits because ${reason}. Progress lasts until the page closes.`,
      });
      ctx.service('view')?.notice('storage', copy.memoryNotice, 'warn');
    }

    return {
      // emitted once every module is listening
      start() {
        ctx.emit('storage:checked', durable ? { status: 'ok' } : { status: 'memory', reason });
      },
      debug: () => ({ mode: service.mode(), reason, readsBrowser: !!ls, inMemory: [...memory.keys()] }),
    };
  },
};
export default storage;
