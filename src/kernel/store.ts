// Plain-data store. Each slice has one writer; values are deep-frozen.
// Watchers run once the current event has finished, so they always see consistent state.
import type { Snapshot } from '../contracts/kernel';

export function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const k of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[k]);
  }
  return value;
}

function assertPlain(value: unknown, path: string): void {
  if (value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value)) return;
  if (typeof value === 'function') throw new Error(`State must be plain data: ${path} is a function`);
  if (Array.isArray(value)) { value.forEach((v, i) => assertPlain(v, `${path}[${i}]`)); return; }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error(`State must be plain data: ${path} is a ${proto?.constructor?.name ?? 'class instance'}`);
  for (const [k, v] of Object.entries(value as object)) assertPlain(v, `${path}.${k}`);
}

export interface Store {
  read(slice: string): unknown;
  write(slice: string, value: unknown, writer: string): void;
  /** seed a slice without an owner check (tests and snapshot restore only) */
  seed(slice: string, value: unknown): void;
  setOwner(slice: string, owner: string): void;
  owner(slice: string): string | undefined;
  watch(slice: string, fn: (value: unknown) => void): () => void;
  /** run pending watchers (the kernel calls this when the bus is idle) */
  flush(): void;
  all(): Record<string, unknown>;
  snapshot(at: number): Snapshot;
  restore(snap: Snapshot): void;
  onChange(fn: () => void): () => void;
}

export function createStore(opts: { isBusy: () => boolean; onWatcherError: (slice: string, err: unknown) => void }): Store {
  const slices = new Map<string, unknown>();
  const owners = new Map<string, string>();
  const watchers = new Map<string, Set<(v: unknown) => void>>();
  const changeFns = new Set<() => void>();
  const dirty = new Set<string>();
  let flushing = false;

  function markDirty(slice: string) {
    dirty.add(slice);
    if (!opts.isBusy()) store.flush();
  }

  const store: Store = {
    read: (slice) => slices.get(slice),
    write(slice, value, writer) {
      const owner = owners.get(slice);
      if (owner !== writer) {
        throw new Error(`${writer} tried to write "${slice}", which ${owner ? `is owned by ${owner}` : 'no module owns'}`);
      }
      assertPlain(value, slice);
      slices.set(slice, deepFreeze(value));
      markDirty(slice);
    },
    seed(slice, value) {
      assertPlain(value, slice);
      slices.set(slice, deepFreeze(structuredClone(value)));
      markDirty(slice);
    },
    setOwner(slice, owner) {
      const existing = owners.get(slice);
      if (existing && existing !== owner) throw new Error(`Slice "${slice}" is claimed by both ${existing} and ${owner}`);
      owners.set(slice, owner);
    },
    owner: (slice) => owners.get(slice),
    watch(slice, fn) {
      const set = watchers.get(slice) ?? new Set();
      set.add(fn);
      watchers.set(slice, set);
      return () => set.delete(fn);
    },
    flush() {
      if (flushing) return;
      flushing = true;
      try {
        while (dirty.size) {
          const batch = [...dirty];
          dirty.clear();
          for (const slice of batch) {
            for (const fn of [...(watchers.get(slice) ?? [])]) {
              try { fn(slices.get(slice)); } catch (err) { opts.onWatcherError(slice, err); }
            }
          }
          for (const fn of [...changeFns]) { try { fn(); } catch { /* observers never break */ } }
        }
      } finally {
        flushing = false;
      }
    },
    all: () => Object.fromEntries(slices),
    snapshot: (at) => ({ version: 1, at, slices: structuredClone(Object.fromEntries(slices)) }),
    restore(snap) {
      for (const [k, v] of Object.entries(snap.slices)) {
        slices.set(k, deepFreeze(structuredClone(v)));
        dirty.add(k);
      }
      if (!opts.isBusy()) store.flush();
    },
    onChange(fn) {
      changeFns.add(fn);
      return () => changeFns.delete(fn);
    },
  };
  return store;
}
