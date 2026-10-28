// Kernel-provided services: seeded RNG, clock, seeded IDs, logger ring buffer.
import type { Clock, Ids, Rng } from '../contracts/services';
import type { LogRecord, Logger } from '../contracts/kernel';

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (n) => Math.floor(next() * n),
    pick: (items) => items[Math.floor(next() * items.length)]!,
    seeded: (s) => createRng(s),
  };
}

export function createRealClock(): Clock {
  return {
    now: () => Date.now(),
    setTimeout(fn, ms) {
      const id = globalThis.setTimeout(fn, ms);
      return () => globalThis.clearTimeout(id);
    },
  };
}

/** A clock that only moves when told to. Used by tests, the probe's replay and session replay. */
export interface FakeClock extends Clock {
  advance(ms: number): void;
  /** move the time without running timers (replay: their effects are already in the input log) */
  setNow(t: number): void;
  pending(): number;
}

export function createFakeClock(start = 1_700_000_000_000): FakeClock {
  let now = start;
  let nextId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const id = ++nextId;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return () => timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((x, y) => x[1].at - y[1].at || x[0] - y[0])[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
    setNow(t) { now = t; },
    pending: () => timers.size,
  };
}

export function createIds(): Ids {
  const counters = new Map<string, number>();
  return {
    next(prefix) {
      const n = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, n);
      return `${prefix}-${n}`;
    },
  };
}

export interface LogSink {
  records: LogRecord[];
  forSource(source: string): Logger;
}

export function createLogSink(now: () => number, limit = 500, echo = false): LogSink {
  const records: LogRecord[] = [];
  const push = (level: LogRecord['level'], source: string, msg: string, detail?: unknown) => {
    records.push({ at: now(), level, source, msg, detail });
    if (records.length > limit) records.splice(0, records.length - limit);
    if (echo || level === 'error' || level === 'warn') {
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      if (echo || level === 'error') fn(`[${source}] ${msg}`, detail ?? '');
    }
  };
  return {
    records,
    forSource: (source) => ({
      debug: (m, d) => push('debug', source, m, d),
      info: (m, d) => push('info', source, m, d),
      warn: (m, d) => push('warn', source, m, d),
      error: (m, d) => push('error', source, m, d),
    }),
  };
}
