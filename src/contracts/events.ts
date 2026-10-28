// Event payloads. Commands are imperative (board:press); facts are past tense (board:pressed).
// A refused command always emits `<module>:refused` with a reason.
// Handlers never depend on order: put what a reaction needs in the payload.
import type { Cells, CustomSettings, LevelId, Screen, Shape, Sheet, Stars } from './entities';

export interface Events {
  // ---- kernel ----
  'kernel:booted': { started: string[]; skipped: { name: string; reason: string }[]; failed: { name: string; reason: string }[] };
  'kernel:state_loaded': { restored: boolean };
  'kernel:handler_failed': { module: string; type: string; message: string };

  // ---- board ----
  /** shape absent = the classic 5×5 board */
  'board:load': { levelId: LevelId; cells: Cells; par: number; shape?: Shape };
  'board:press': { index: number };
  'board:undo': Record<string, never>;
  'board:restart': Record<string, never>;
  'board:loaded': { levelId: LevelId; cells: Cells; par: number; shape?: Shape };
  'board:pressed': { levelId: LevelId; index: number; cells: Cells; moves: number; litCount: number };
  'board:undone': { levelId: LevelId; index: number; cells: Cells; moves: number };
  'board:restarted': { levelId: LevelId; cells: Cells };
  'board:solved': { levelId: LevelId; moves: number; par: number };
  'board:refused': { command: 'board:press' | 'board:undo' | 'board:restart' | 'board:load'; reason: 'not_playing' | 'bad_index' | 'nothing_to_undo' | 'bad_board' | 'stuck' };

  // ---- levels ----
  'levels:start': { levelId: LevelId };
  /** count = levels in this pack; next = the following level in the same pack, or null after its last; boss = a boss level */
  'levels:started': { levelId: LevelId; par: number; count: number; pack?: string; index?: number; next?: LevelId | null; boss?: boolean };
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
    /** true when every level of the classic path is now solved (always false for Variety rooms) */
    allSolved: boolean;
    /** the pack this level belongs to ('classic' when absent; 'custom' for a custom puzzle, which is never saved) */
    pack?: string;
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

  // ---- variety ----
  /** open one board's level screen: any pack id from levels.packs, classic included (rooms stay locked until progress.varietyOpen) */
  'variety:open': { room: string };
  'variety:opened': { room: string };
  'variety:refused': { reason: 'locked' | 'unknown_room' };

  // ---- custom ----
  /** open the Custom screen (refused until the other boards are open: progress.varietyOpen) */
  'custom:open': Record<string, never>;
  /** change some settings (they are remembered) */
  'custom:set': { settings: Partial<CustomSettings> };
  /** make a new puzzle from the settings and start it (also "New puzzle" after a solve) */
  'custom:play': Record<string, never>;
  'custom:started': { par: number; label: string; puzzle: number };
  'custom:refused': { command: 'custom:open' | 'custom:set' | 'custom:play'; reason: 'locked' | 'bad_settings' | 'no_puzzle' };

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
