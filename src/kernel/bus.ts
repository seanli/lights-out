// Run-to-completion event bus. An event emitted inside a handler is queued and
// dispatched after the current event's handlers have all run.
import type { EventMeta, EventRecord } from '../contracts/kernel';

type AnyHandler = (payload: unknown, meta: EventMeta) => void;

export interface BusOptions {
  now: () => number;
  onRecord: (rec: EventRecord) => void;
  onHandlerError: (owner: string, type: string, err: unknown) => void;
  /** called once the queue is empty after a drain */
  onDrained?: () => void;
}

export interface Bus {
  emit(type: string, payload: unknown, source: string): void;
  on(type: string, handler: AnyHandler, owner: string): () => void;
  /** observe every event after dispatch (console, recorder) */
  tap(fn: (rec: EventRecord) => void): () => void;
  dispatching(): boolean;
}

export function createBus(opts: BusOptions): Bus {
  const handlers = new Map<string, { owner: string; fn: AnyHandler }[]>();
  const taps = new Set<(rec: EventRecord) => void>();
  const queue: EventRecord[] = [];
  let seq = 0;
  let draining = false;

  function drain() {
    draining = true;
    try {
      while (queue.length) {
        const rec = queue.shift()!;
        opts.onRecord(rec);
        const meta: EventMeta = { seq: rec.seq, type: rec.type, source: rec.source, at: rec.at, input: rec.input };
        for (const h of [...(handlers.get(rec.type) ?? [])]) {
          try {
            h.fn(rec.payload, meta);
          } catch (err) {
            opts.onHandlerError(h.owner, rec.type, err);
          }
        }
        for (const t of [...taps]) {
          try { t(rec); } catch { /* observers never break dispatch */ }
        }
      }
    } finally {
      draining = false;
    }
    opts.onDrained?.();
  }

  return {
    emit(type, payload, source) {
      const input = !draining;
      queue.push({ seq: ++seq, type, payload, source, at: opts.now(), input });
      if (!draining) drain();
    },
    on(type, fn, owner) {
      const list = handlers.get(type) ?? [];
      const entry = { owner, fn };
      list.push(entry);
      handlers.set(type, list);
      return () => {
        const l = handlers.get(type);
        if (l) handlers.set(type, l.filter((e) => e !== entry));
      };
    },
    tap(fn) {
      taps.add(fn);
      return () => taps.delete(fn);
    },
    dispatching: () => draining,
  };
}
