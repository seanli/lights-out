// Event payloads. Commands are imperative (board:press); facts are past tense (board:pressed).
// A refused command always emits `<module>:refused` with a reason.
// Handlers never depend on order: put what a reaction needs in the payload.
import type { Cells, LevelId, Screen, Sheet, Stars } from './entities';

export interface Events {
  // ---- kernel ----
  'kernel:booted': { started: string[]; skipped: { name: string; reason: string }[]; failed: { name: string; reason: string }[] };
  'kernel:state_loaded': { restored: boolean };
  'kernel:handler_failed': { module: string; type: string; message: string };

  // ---- board ----
  'board:load': { levelId: LevelId; cells: Cells; par: number };
  'board:press': { index: number };
  'board:undo': Record<string, never>;
  'board:restart': Record<string, never>;
  'board:loaded': { levelId: LevelId; cells: Cells; par: number };
  'board:pressed': { levelId: LevelId; index: number; cells: Cells; moves: number; litCount: number };
  'board:undone': { levelId: LevelId; index: number; cells: Cells; moves: number };
  'board:restarted': { levelId: LevelId; cells: Cells };
  'board:solved': { levelId: LevelId; moves: number; par: number };
  'board:refused': { command: 'board:press' | 'board:undo' | 'board:restart' | 'board:load'; reason: 'not_playing' | 'bad_index' | 'nothing_to_undo' | 'bad_board' };

  // ---- levels ----
  'levels:start': { levelId: LevelId };
  'levels:started': { levelId: LevelId; par: number; count: number };
  'levels:generated': { count: number; pars: number[] };
  'levels:refused': { levelId: LevelId; reason: 'locked' | 'unknown' | 'not_ready' };

  // ---- progress ----
  'progress:clear': Record<string, never>;
  'progress:loaded': { source: 'saved' | 'new' | 'recovered' | 'newer'; solved: number; unlockedUpTo: number };
  'progress:level_completed': {
    levelId: LevelId; stars: Stars; moves: number; par: number; hintsUsed: number;
    /** true when this solve beat (or set) the best stars or moves */
    improved: boolean;
    /** the level this solve unlocked, or null */
    unlocked: LevelId | null;
    /** true when every level is now solved */
    allSolved: boolean;
    /** true when this was the level's first solve (so allSolved && firstSolve = this solve finished the set) */
    firstSolve: boolean;
  };
  'progress:cleared': Record<string, never>;
  'progress:save_failed': { reason: string };

  // ---- hints ----
  'hints:request': Record<string, never>;
  'hints:shown': { levelId: LevelId; index: number };
  'hints:cleared': { reason: 'pressed' | 'level_changed' | 'undone' | 'restarted' | 'solved' };
  'hints:refused': { reason: 'not_playing' | 'already_showing' | 'unsolvable' | 'no_solver' | 'tutorial_active' };

  // ---- nav ----
  'nav:go': { screen: Screen };
  /** return to the screen before the current one (home if none) */
  'nav:back': Record<string, never>;
  'nav:open_sheet': { sheet: Sheet };
  'nav:close_sheet': Record<string, never>;
  'nav:changed': { screen: Screen; sheet: Sheet | null };

  // ---- storage ----
  'storage:checked': { status: 'ok' | 'memory'; reason?: string };

  // ---- tutorial ----
  'tutorial:step_shown': { levelId: LevelId; step: number; target: number | null };
  'tutorial:finished': { levelId: LevelId };
  'tutorial:skip': Record<string, never>;

  // ---- sound ----
  'sound:set': { enabled: boolean };
  'sound:changed': { enabled: boolean };

  // ---- learn ----
  /** open the Learn screen, optionally at a lesson */
  'learn:open': { lessonId?: string };
  'learn:step': { delta: 1 | -1 };
  'learn:press': { index: number };
  'learn:new_practice': Record<string, never>;
  'learn:set_assist': { on: boolean };
  'learn:lesson_opened': { lessonId: string | null };
  'learn:lesson_completed': { lessonId: string };
  'learn:practice_solved': { lessonId: string | null; moves: number; par: number };
  'learn:refused': { command: string; reason: 'unknown_lesson' | 'no_practice' | 'bad_index' };

  // ---- offline ----
  'offline:status_changed': { target: string; worker: string; online: boolean };
}

export type EventType = keyof Events;
