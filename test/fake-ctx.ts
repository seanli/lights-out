// Boot one module alone: records every event, injects fake services, seeds other modules' state,
// and loads a FROZEN copy of the data (test/fixtures/data) so retuning live data never breaks module tests.
import type { EventRecord, ModuleDef, ModuleInstance } from '../src/contracts/kernel';
import type { SliceName, State } from '../src/contracts/entities';
import type { EventType, Events } from '../src/contracts/events';
import type { Env, ServiceName, Services, StorageService, Tone, ViewService } from '../src/contracts/services';
import { createFakeClock, createKernel, type DataBundle, type FakeClock, type Kernel } from '../src/kernel';
import rules from './fixtures/data/rules.json';
import copy from './fixtures/data/copy.json';
import flags from './fixtures/data/flags.json';

export const fixtureData: DataBundle = { rules, copy, flags } as DataBundle;

export function createMemoryStorage(initial: Record<string, unknown> = {}): StorageService & { dump(): Record<string, unknown> } {
  const map = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
  return {
    get: (key) => (map.has(key) ? structuredClone(map.get(key)) : undefined),
    set: (key, value) => { map.set(key, structuredClone(value)); return true; },
    remove: (key) => { map.delete(key); },
    mode: () => 'live',
    dump: () => Object.fromEntries(map),
  };
}

export interface FakeView extends ViewService {
  notices: Map<string, { text: string; tone: Tone }>;
}

/** Regions become <div>s on document.body. Needs a DOM test environment (happy-dom). */
export function createFakeView(): FakeView {
  const regions = new Map<string, HTMLElement>();
  const notices = new Map<string, { text: string; tone: Tone }>();
  return {
    notices,
    region(name) {
      let el = regions.get(name);
      if (!el) {
        el = document.createElement('div');
        const [kind, id] = name.split(':');
        if (kind === 'screen') el.dataset.screen = id;
        else if (kind === 'sheet') el.dataset.sheet = id;
        else if (kind === 'slot') el.dataset.slot = id;
        else el.dataset.region = name;
        if (kind !== 'slot') document.body.appendChild(el);
        regions.set(name, el);
      }
      return el;
    },
    notice: (id, text, tone = 'info') => { notices.set(id, { text, tone }); },
    clearNotice: (id) => { notices.delete(id); },
    reducedMotion: () => true,
  };
}

export interface BootOptions {
  data?: DataBundle;
  /** services to inject (override defaults) */
  services?: Partial<{ [K in ServiceName]: Services[K] }>;
  /** other modules' slices, seeded before boot */
  state?: Partial<State>;
  seed?: number;
  /** skip default fakes (storage, view, env) */
  bare?: boolean;
}

export interface Booted {
  kernel: Kernel;
  clock: FakeClock;
  instance: ModuleInstance | undefined;
  /** emit as outside input (a tap, a timer) */
  emit<T extends EventType>(type: T, payload: Events[T]): void;
  state<S extends SliceName>(slice: S): State[S];
  /** every event so far */
  events(): EventRecord[];
  /** payload of the most recent matching event that already fired, or undefined */
  seen<T extends EventType>(type: T, match?: Partial<Events[T]> | ((p: Events[T]) => boolean)): Events[T] | undefined;
  /** all payloads of a type, oldest first */
  all<T extends EventType>(type: T): Events[T][];
  /** resolves with the next matching event emitted after this call */
  next<T extends EventType>(type: T, match?: Partial<Events[T]> | ((p: Events[T]) => boolean), timeoutMs?: number): Promise<Events[T]>;
  view?: FakeView;
  storage?: ReturnType<typeof createMemoryStorage>;
}

function matches(payload: unknown, match: unknown): boolean {
  if (!match) return true;
  if (typeof match === 'function') return !!(match as (p: unknown) => boolean)(payload);
  return Object.entries(match as object).every(([k, v]) => JSON.stringify((payload as Record<string, unknown>)?.[k]) === JSON.stringify(v));
}

export function bootModule(def: ModuleDef, opts: BootOptions = {}): Booted {
  const clock = createFakeClock();
  const kernel = createKernel({ data: opts.data ?? fixtureData, seed: opts.seed ?? 42, clock });
  let view: FakeView | undefined;
  let storage: ReturnType<typeof createMemoryStorage> | undefined;
  if (!opts.bare) {
    const env: Env = { target: 'test', debug: false, buildId: 'test', version: '0.0.0-test' };
    kernel.provide('env', env, 'test');
    storage = createMemoryStorage();
    if (!opts.services?.storage && !(def.manifest.provides ?? []).includes('storage')) kernel.provide('storage', storage, 'test');
    if (typeof document !== 'undefined' && !opts.services?.view) {
      view = createFakeView();
      kernel.provide('view', view, 'test');
    }
  }
  for (const [name, impl] of Object.entries(opts.services ?? {})) kernel.provide(name as ServiceName, impl as never, 'test');
  for (const [slice, value] of Object.entries(opts.state ?? {})) kernel.seed(slice, value);
  kernel.register(def);
  const report = kernel.boot();
  if (report.failed.length) throw new Error(`${def.manifest.name} failed to boot: ${report.failed[0]!.reason}`);
  if (report.skipped.length) throw new Error(`${def.manifest.name} was skipped: ${report.skipped[0]!.reason}`);

  const events = () => kernel.debug.events();
  return {
    kernel,
    clock,
    instance: kernel.instance(def.manifest.name),
    view,
    storage,
    emit: (type, payload) => kernel.emit(type, payload, 'test'),
    state: (slice) => kernel.read(slice) as never,
    events,
    seen(type, match) {
      const rec = [...events()].reverse().find((e) => e.type === type && matches(e.payload, match));
      return rec?.payload as never;
    },
    all: (type) => events().filter((e) => e.type === type).map((e) => e.payload) as never,
    next(type, match, timeoutMs = 1000) {
      const after = events().at(-1)?.seq ?? 0;
      return new Promise((resolve, reject) => {
        const check = () => {
          const rec = events().find((e) => e.seq > after && e.type === type && matches(e.payload, match));
          if (rec) { off(); clearTimeout(timer); resolve(rec.payload as never); }
        };
        const off = kernel.debug.onChange(check);
        const timer = setTimeout(() => { off(); reject(new Error(`Timed out waiting for ${type}`)); }, timeoutMs);
        check();
      });
    },
  };
}
