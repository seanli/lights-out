// Service interfaces. A service is provided by exactly one owner (kernel, shell or a module).
import type { Cells, Shape } from './entities';
import type { EventRecord, LogRecord, ModuleStatus, ServiceStatus, Snapshot } from './kernel';

export interface Rng {
  /** float in [0, 1) */
  next(): number;
  /** integer in [0, n) */
  int(n: number): number;
  pick<T>(items: readonly T[]): T;
  /** a new independent generator from a fixed seed (same seed → same sequence) */
  seeded(seed: number): Rng;
}

export interface Clock {
  now(): number;
  /** returns a cancel function */
  setTimeout(fn: () => void, ms: number): () => void;
}

export interface Ids {
  next(prefix: string): string;
}

export type Tone = 'info' | 'warn' | 'error';

/** Provided by the shell. The only way a module touches the page. */
export interface ViewService {
  /**
   * A container element the module renders into. Created on first request.
   * Names: 'screen:home', 'screen:play', 'sheet:<sheet>', 'overlay:<name>', 'slot:<name>'.
   * The shell shows the screen and sheet that the nav slice names.
   * A slot is a detached element: one module fills it, another appends it where it belongs
   * in its own layout (e.g. the tutorial fills 'slot:coach', the play view places it under the board).
   * Every caller gets the same element for the same name.
   */
  region(name: string): HTMLElement;
  /** a short plain-words message in the shell's notice area; same id replaces */
  notice(id: string, text: string, tone?: Tone): void;
  clearNotice(id: string): void;
  reducedMotion(): boolean;
}

export interface Env {
  target: 'artifact' | 'pwa' | 'file' | 'dev' | 'test';
  debug: boolean;
  /** UTC build time, yyyymmddhhmm */
  buildId: string;
  /** the release (package.json version), shown at the bottom of home so the player can tell which build they have */
  version: string;
}

/** Provided by the storage module. Keys are namespaced by the service. Never throws. */
export interface StorageService {
  get(key: string): unknown;
  /** false when the value could not be stored durably */
  set(key: string, value: unknown): boolean;
  remove(key: string): void;
  mode(): 'live' | 'memory';
}

/** Provided by the solver module. Pure functions over boards of any shape; shape absent = classic 5×5. */
export interface SolverService {
  /** the board after pressing index (toggles it and its up/down/left/right neighbours that exist) */
  press(cells: Cells, index: number, shape?: Shape): Cells;
  /** a fewest-presses solution as a sorted list of indexes, or null if unsolvable */
  solve(cells: Cells, shape?: Shape): number[] | null;
  isSolvable(cells: Cells, shape?: Shape): boolean;
}

/** Provided by the kernel for the debug console and tooling. */
export interface DebugService {
  events(): EventRecord[];
  logs(): LogRecord[];
  modules(): ModuleStatus[];
  services(): ServiceStatus[];
  state(): Record<string, unknown>;
  snapshot(): Snapshot;
  restore(snapshot: Snapshot): void;
  /** emit as outside input (like a tap) */
  emit(type: string, payload: unknown): void;
  /** commands that module instances expose, keyed "module.command" */
  commands(): Record<string, (args: string[]) => unknown>;
  onChange(fn: () => void): () => void;
}

export interface Services {
  rng: Rng;
  clock: Clock;
  ids: Ids;
  debug: DebugService;
  view: ViewService;
  env: Env;
  storage: StorageService;
  solver: SolverService;
}
export type ServiceName = keyof Services;
