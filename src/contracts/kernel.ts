// The module contract: what a module declares and what it gets.
import type { GenericSchema } from 'valibot';
import type { SliceName, State } from './entities';
import type { Events, EventType } from './events';
import type { ServiceName, Services } from './services';

export type DataFile = 'rules' | 'copy' | 'flags';

export interface Manifest {
  /** folder name under src/modules; also the name of the slice it owns, if any */
  name: string;
  /** modules that must init before this one (only when init reads their state or service) */
  deps?: string[];
  emits: EventType[];
  listens: EventType[];
  /** state slices this module writes; usually [name] or [] */
  owns: SliceName[];
  provides?: ServiceName[];
  /** services this module cannot work without; the module is skipped if one is missing */
  uses?: ServiceName[];
  /** services it uses when present */
  optional?: ServiceName[];
  /** schemas for this module's section of each data file */
  data?: Partial<Record<DataFile, GenericSchema>>;
}

export interface ModuleInstance {
  /** called after every module has initialised and state is loaded */
  start?(): void;
  stop?(): void;
  /** extra detail for the debug console */
  debug?(): unknown;
  /** console commands, e.g. { win: () => ... } becomes "board.win" */
  commands?: Record<string, (args: string[]) => unknown>;
}

export interface ModuleDef {
  manifest: Manifest;
  /** no module-level state: everything lives in the returned instance or the store */
  init(ctx: Ctx): ModuleInstance | void;
}

export interface EventMeta {
  seq: number;
  type: string;
  source: string;
  at: number;
  /** true when emitted from outside any handler (a tap, a timer, the console) */
  input: boolean;
}

export type Handler<T extends EventType> = (payload: Events[T], meta: EventMeta) => void;

export interface Logger {
  debug(msg: string, detail?: unknown): void;
  info(msg: string, detail?: unknown): void;
  warn(msg: string, detail?: unknown): void;
  error(msg: string, detail?: unknown): void;
}

export interface ServiceReport {
  service: string;
  mode: 'live' | 'mock';
  ok: boolean;
  /** plain words: what's wrong and how to fix it, or what's running */
  detail: string;
}

export interface Ctx {
  readonly name: string;
  emit<T extends EventType>(type: T, payload: Events[T]): void;
  on<T extends EventType>(type: T, handler: Handler<T>): () => void;
  /** read any slice (frozen plain data) */
  read<S extends SliceName>(slice: S): State[S] | undefined;
  /** replace a slice this module owns */
  write<S extends SliceName>(slice: S, value: State[S]): void;
  /** called after a slice changes; returns unsubscribe */
  watch<S extends SliceName>(slice: S, fn: (value: State[S] | undefined) => void): () => void;
  /** this module's validated data sections, e.g. ctx.data.rules */
  readonly data: Partial<Record<DataFile, any>>;
  /** a service, or undefined if nobody provides it */
  service<K extends ServiceName>(name: K): Services[K] | undefined;
  /** a service listed in `uses` (guaranteed present) */
  need<K extends ServiceName>(name: K): Services[K];
  provide<K extends ServiceName>(name: K, impl: Services[K]): void;
  /** report an outside service's mode and health to the console */
  report(status: ServiceReport): void;
  readonly log: Logger;
}

export interface EventRecord {
  seq: number;
  type: string;
  payload: unknown;
  source: string;
  at: number;
  input: boolean;
}

export interface LogRecord {
  at: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  msg: string;
  detail?: unknown;
}

export interface ModuleStatus {
  name: string;
  status: 'registered' | 'started' | 'skipped' | 'failed';
  reason?: string;
  manifest: Manifest;
}

export interface ServiceStatus extends ServiceReport {
  checkedAt: number;
}

export interface Snapshot {
  version: 1;
  at: number;
  slices: Record<string, unknown>;
}
