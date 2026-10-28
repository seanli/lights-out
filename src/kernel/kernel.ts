// The kernel: registry, bus, store, lifecycle, logger, data loader. Nothing else belongs here.
import type { Ctx, EventRecord, Logger, ModuleDef, ModuleInstance, ModuleStatus, ServiceStatus, Snapshot } from '../contracts/kernel';
import type { Clock, DebugService, ServiceName, Services } from '../contracts/services';
import { createBus } from './bus';
import { createStore } from './store';
import { createIds, createLogSink, createRealClock, createRng } from './base-services';
import { loadData, type DataBundle } from './data';

export interface KernelOptions {
  data: DataBundle;
  seed?: number;
  clock?: Clock;
  /** print every log line to the console (tests keep this off) */
  echoLogs?: boolean;
  /** called once per module for any runtime failure (a handler, a view watcher, start()), so the shell can tell the player */
  onFault?: (fault: { module: string; kind: 'handler' | 'watcher' | 'start'; message: string }) => void;
}

export interface BootReport {
  started: string[];
  skipped: { name: string; reason: string }[];
  failed: { name: string; reason: string }[];
  orphans: string[];
}

export interface Session {
  seed: number;
  initial: Snapshot;
  inputs: EventRecord[];
}

export interface Kernel {
  register(def: ModuleDef): void;
  /** provide a service from outside the module system (the shell, a test) */
  provide<K extends ServiceName>(name: K, impl: Services[K], owner?: string): void;
  boot(opts?: { snapshot?: Snapshot }): BootReport;
  emit(type: string, payload: unknown, source?: string): void;
  read(slice: string): unknown;
  /** seed a slice directly (tests only) */
  seed(slice: string, value: unknown): void;
  service<K extends ServiceName>(name: K): Services[K] | undefined;
  snapshot(): Snapshot;
  session(): Session;
  modules(): ModuleStatus[];
  instance(name: string): ModuleInstance | undefined;
  readonly debug: DebugService;
  readonly log: Logger;
  stop(): void;
}

const EVENT_LIMIT = 1000;
const INPUT_LIMIT = 20000;

export function createKernel(opts: KernelOptions): Kernel {
  const seed = opts.seed ?? 1;
  const clock = opts.clock ?? createRealClock();
  const sink = createLogSink(() => clock.now(), 500, opts.echoLogs ?? false);
  const klog = sink.forSource('kernel');
  const defs: ModuleDef[] = [];
  const statuses = new Map<string, ModuleStatus>();
  const instances = new Map<string, ModuleInstance>();
  const services = new Map<string, { owner: string; impl: unknown }>();
  const serviceStatus = new Map<string, ServiceStatus>();
  const events: EventRecord[] = [];
  const inputs: EventRecord[] = [];
  const changeFns = new Set<() => void>();
  const warned = new Set<string>();
  let booted = false;
  let bootSeq = Infinity;
  let initial: Snapshot | null = null;

  const notify = () => { for (const fn of [...changeFns]) { try { fn(); } catch { /* ignore */ } } };

  const bus = createBus({
    now: () => clock.now(),
    onRecord(rec) {
      events.push(rec);
      if (events.length > EVENT_LIMIT) events.splice(0, events.length - EVENT_LIMIT);
      if (rec.input && rec.seq > bootSeq && rec.source !== 'kernel') {
        inputs.push(rec);
        if (inputs.length > INPUT_LIMIT) inputs.shift();
      }
    },
    onHandlerError(owner, type, err) {
      const message = err instanceof Error ? err.message : String(err);
      fault(owner, 'handler', message);
      sink.forSource(owner).error(`Handler for ${type} failed: ${message}`, err);
      if (type !== 'kernel:handler_failed') bus.emit('kernel:handler_failed', { module: owner, type, message }, 'kernel');
    },
    onDrained() {
      store.flush();
      notify();
    },
  });

  const store = createStore({
    isBusy: () => bus.dispatching(),
    onWatcherError: (slice, err) => {
      const message = err instanceof Error ? err.message : String(err);
      klog.error(`A view watching "${slice}" failed: ${message}`, err);
      fault(`watcher of ${slice}`, 'watcher', message);
    },
  });

  // kernel-provided services
  const rng = createRng(seed);
  services.set('rng', { owner: 'kernel', impl: rng });
  services.set('clock', { owner: 'kernel', impl: clock });
  services.set('ids', { owner: 'kernel', impl: createIds() });

  const faulted = new Set<string>();
  function fault(module: string, kind: 'handler' | 'watcher' | 'start', message: string) {
    if (faulted.has(module)) return;
    faulted.add(module);
    try { opts.onFault?.({ module, kind, message }); } catch { /* the reporter must never break dispatch */ }
  }

  function warnOnce(key: string, msg: string) {
    if (warned.has(key)) return;
    warned.add(key);
    klog.warn(msg);
  }

  function makeCtx(def: ModuleDef, data: Record<string, unknown>, unsubs: (() => void)[]): Ctx {
    const m = def.manifest;
    const log = sink.forSource(m.name);
    return {
      name: m.name,
      emit(type, payload) {
        if (!m.emits.includes(type)) warnOnce(`emit:${m.name}:${type}`, `${m.name} emitted "${type}" but its manifest doesn't declare it`);
        bus.emit(type, payload, m.name);
      },
      on(type, handler) {
        if (!m.listens.includes(type)) warnOnce(`on:${m.name}:${type}`, `${m.name} listens to "${type}" but its manifest doesn't declare it`);
        const off = bus.on(type, handler as never, m.name);
        unsubs.push(off);
        return off;
      },
      read: (slice) => store.read(slice) as never,
      write: (slice, value) => store.write(slice, value, m.name),
      watch(slice, fn) {
        const off = store.watch(slice, fn as never);
        unsubs.push(off);
        return off;
      },
      data,
      service: (name) => services.get(name)?.impl as never,
      need(name) {
        const s = services.get(name);
        if (!s) throw new Error(`${m.name} needs the "${name}" service, but nothing provides it`);
        return s.impl as never;
      },
      provide(name, impl) {
        if (!(m.provides ?? []).includes(name)) warnOnce(`provide:${m.name}:${name}`, `${m.name} provided "${name}" but its manifest doesn't declare it`);
        const existing = services.get(name);
        if (existing && existing.owner !== m.name) throw new Error(`Service "${name}" is already provided by ${existing.owner}`);
        services.set(name, { owner: m.name, impl });
      },
      report(status) {
        serviceStatus.set(status.service, { ...status, checkedAt: clock.now() });
        (status.ok ? log.info : log.warn)(`${status.service} (${status.mode}): ${status.detail}`);
        notify();
      },
      log,
    };
  }

  /** dependency order: explicit deps, then providers before users */
  function order(list: ModuleDef[]): { sorted: ModuleDef[]; cyclic: string[] } {
    const byName = new Map(list.map((d) => [d.manifest.name, d]));
    const providerOf = new Map<string, string>();
    for (const d of list) for (const s of d.manifest.provides ?? []) providerOf.set(s, d.manifest.name);
    const before = (d: ModuleDef) => {
      const out = new Set<string>(d.manifest.deps ?? []);
      for (const s of [...(d.manifest.uses ?? []), ...(d.manifest.optional ?? [])]) {
        const p = providerOf.get(s);
        if (p && p !== d.manifest.name) out.add(p);
      }
      return [...out].filter((n) => byName.has(n));
    };
    const sorted: ModuleDef[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const cyclic: string[] = [];
    const visit = (d: ModuleDef) => {
      const n = d.manifest.name;
      if (state.get(n) === 'done') return;
      if (state.get(n) === 'visiting') { cyclic.push(n); return; }
      state.set(n, 'visiting');
      for (const dep of before(d)) visit(byName.get(dep)!);
      state.set(n, 'done');
      sorted.push(d);
    };
    [...list].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)).forEach(visit);
    return { sorted, cyclic };
  }

  const debug: DebugService = {
    events: () => [...events],
    logs: () => [...sink.records],
    modules: () => [...statuses.values()],
    services: () => [...serviceStatus.values()],
    state: () => store.all(),
    snapshot: () => store.snapshot(clock.now()),
    restore(snap) {
      store.restore(snap);
      bus.emit('kernel:state_loaded', { restored: true }, 'kernel');
    },
    emit: (type, payload) => bus.emit(type, payload, 'console'),
    commands() {
      const out: Record<string, (args: string[]) => unknown> = {};
      for (const [name, inst] of instances) for (const [cmd, fn] of Object.entries(inst.commands ?? {})) out[`${name}.${cmd}`] = fn;
      return out;
    },
    onChange(fn) {
      changeFns.add(fn);
      return () => changeFns.delete(fn);
    },
  };
  services.set('debug', { owner: 'kernel', impl: debug });

  const kernel: Kernel = {
    register(def) {
      if (booted) throw new Error('Register modules before boot');
      const n = def.manifest.name;
      if (statuses.has(n)) throw new Error(`Module "${n}" is registered twice`);
      defs.push(def);
      statuses.set(n, { name: n, status: 'registered', manifest: def.manifest });
    },
    provide(name, impl, owner = 'shell') {
      services.set(name, { owner, impl });
    },
    boot(bootOpts = {}) {
      if (booted) throw new Error('Kernel already booted');
      booted = true;
      const report: BootReport = { started: [], skipped: [], failed: [], orphans: [] };
      const { sections, orphans } = loadData(opts.data, defs); // throws DataError
      report.orphans = orphans;
      for (const o of orphans) klog.warn(`Data section "${o}" belongs to no installed module`);

      const { sorted, cyclic } = order(defs);
      for (const n of cyclic) klog.error(`Module dependency cycle involving ${n}`);

      for (const def of sorted) {
        const m = def.manifest;
        const st = statuses.get(m.name)!;
        const missingDep = (m.deps ?? []).find((d) => statuses.get(d)?.status !== 'started');
        const missingSvc = (m.uses ?? []).find((s) => !services.has(s));
        if (missingDep || missingSvc) {
          const reason = missingDep ? `needs the ${missingDep} module, which isn't running` : `needs the ${missingSvc} service, which nothing provides`;
          Object.assign(st, { status: 'skipped', reason });
          report.skipped.push({ name: m.name, reason });
          klog.warn(`Skipped ${m.name}: ${reason}`);
          continue;
        }
        const unsubs: (() => void)[] = [];
        try {
          for (const slice of m.owns) store.setOwner(slice, m.name);
          const inst = def.init(makeCtx(def, (sections.get(m.name) ?? {}) as Record<string, unknown>, unsubs)) ?? {};
          for (const s of m.provides ?? []) if (services.get(s)?.owner !== m.name) klog.warn(`${m.name} declares it provides "${s}" but didn't provide it`);
          instances.set(m.name, inst);
          Object.assign(st, { status: 'started', reason: undefined });
          report.started.push(m.name);
        } catch (err) {
          unsubs.forEach((f) => f());
          const reason = err instanceof Error ? err.message : String(err);
          Object.assign(st, { status: 'failed', reason });
          report.failed.push({ name: m.name, reason });
          klog.error(`${m.name} failed to start: ${reason}`, err);
        }
      }

      if (bootOpts.snapshot) store.restore(bootOpts.snapshot);
      for (const name of report.started) {
        try { instances.get(name)!.start?.(); } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          klog.error(`${name} failed in start(): ${reason}`, err);
          statuses.get(name)!.status = 'failed';
          statuses.get(name)!.reason = reason;
          report.failed.push({ name, reason });
          fault(name, 'start', reason);
        }
      }
      store.flush();
      initial = store.snapshot(clock.now());
      bootSeq = events.at(-1)?.seq ?? 0;
      bus.emit('kernel:booted', { started: report.started, skipped: report.skipped, failed: report.failed }, 'kernel');
      bus.emit('kernel:state_loaded', { restored: !!bootOpts.snapshot }, 'kernel');
      notify();
      return report;
    },
    emit: (type, payload, source = 'input') => bus.emit(type, payload, source),
    read: (slice) => store.read(slice),
    seed: (slice, value) => store.seed(slice, value),
    service: (name) => services.get(name)?.impl as never,
    snapshot: () => store.snapshot(clock.now()),
    session: () => ({ seed, initial: initial ?? store.snapshot(clock.now()), inputs: [...inputs] }),
    modules: () => [...statuses.values()],
    instance: (name) => instances.get(name),
    debug,
    log: klog,
    stop() {
      for (const inst of instances.values()) { try { inst.stop?.(); } catch { /* ignore */ } }
    },
  };
  return kernel;
}
