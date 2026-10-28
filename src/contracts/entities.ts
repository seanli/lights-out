// One schema per entity; TypeScript types are derived from the schemas.
// Changing a shape here is a contract change: ask the lead first.
import * as v from 'valibot';

/** Bump when any slice shape below changes; hot-reload snapshots from another version are discarded. */
export const CONTRACT_VERSION = 1;

export const SIZE = 5;
export const CELL_COUNT = SIZE * SIZE;

/** A board is 25 booleans, row-major, index = row * 5 + col. true = lit. */
export const CellsSchema = v.pipe(v.array(v.boolean()), v.length(CELL_COUNT));
export type Cells = v.InferOutput<typeof CellsSchema>;

export const CellIndexSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(CELL_COUNT - 1));

export const LevelIdSchema = v.pipe(v.number(), v.integer(), v.minValue(1));
export type LevelId = number;

export const StarsSchema = v.picklist([1, 2, 3]);
export type Stars = v.InferOutput<typeof StarsSchema>;

// ---- slices (one writer each; anyone may read) ----

export const BoardStateSchema = v.object({
  status: v.picklist(['empty', 'playing', 'solved']),
  levelId: v.nullable(LevelIdSchema),
  start: CellsSchema,
  cells: CellsSchema,
  par: v.number(),
  moves: v.number(),
  /** pressed cell indexes, newest last; undo pops */
  history: v.array(CellIndexSchema),
});
export type BoardState = v.InferOutput<typeof BoardStateSchema>;

export const LevelDefSchema = v.object({
  id: LevelIdSchema,
  cells: CellsSchema,
  par: v.number(),
});
export type LevelDef = v.InferOutput<typeof LevelDefSchema>;

export const ChapterSchema = v.object({
  id: v.string(),
  name: v.string(),
  from: LevelIdSchema,
  to: LevelIdSchema,
});
export type Chapter = v.InferOutput<typeof ChapterSchema>;

export const LevelsStateSchema = v.object({
  status: v.picklist(['generating', 'ready', 'error']),
  list: v.array(LevelDefSchema),
  chapters: v.array(ChapterSchema),
  error: v.optional(v.string()),
});
export type LevelsState = v.InferOutput<typeof LevelsStateSchema>;

export const LevelResultSchema = v.object({
  stars: StarsSchema,
  bestMoves: v.number(),
  solvedAt: v.number(),
});
export type LevelResult = v.InferOutput<typeof LevelResultSchema>;

/** Saved progress. Versioned: any shape change bumps version and adds a migration. */
export const ProgressSaveV1Schema = v.object({
  version: v.literal(1),
  /** keyed by String(levelId) */
  results: v.record(v.string(), LevelResultSchema),
  /** hints used on levels not yet solved this attempt, keyed by String(levelId) */
  pendingHints: v.record(v.string(), v.number()),
  /** last level the player started */
  lastLevel: v.number(),
});
export type ProgressSave = v.InferOutput<typeof ProgressSaveV1Schema>;

export const ScoringSchema = v.object({
  threeStarsWithin: v.number(),
  twoStarsWithin: v.number(),
  hintCost: v.number(),
  minStars: v.number(),
});
export type Scoring = v.InferOutput<typeof ScoringSchema>;

export const ProgressStateSchema = v.object({
  status: v.picklist(['loading', 'ready']),
  save: ProgressSaveV1Schema,
  /** highest level id that may be started */
  unlockedUpTo: v.number(),
  /** the star rule in force (from rules.json → progress), so views can show tiers without owning the rule */
  scoring: v.optional(ScoringSchema),
});
export type ProgressState = v.InferOutput<typeof ProgressStateSchema>;

export const HintsStateSchema = v.object({
  status: v.picklist(['idle', 'showing']),
  levelId: v.nullable(v.number()),
  cell: v.nullable(CellIndexSchema),
});
export type HintsState = v.InferOutput<typeof HintsStateSchema>;

export const ScreenSchema = v.picklist(['home', 'play', 'learn']);
export type Screen = v.InferOutput<typeof ScreenSchema>;
export const SheetSchema = v.picklist(['solved', 'confirm_reset', 'complete']);
export type Sheet = v.InferOutput<typeof SheetSchema>;

export const NavStateSchema = v.object({
  screen: ScreenSchema,
  sheet: v.nullable(SheetSchema),
  /** the screen nav:back returns to */
  previous: v.optional(v.nullable(ScreenSchema)),
});
export type NavState = v.InferOutput<typeof NavStateSchema>;

export const StorageStateSchema = v.object({
  status: v.picklist(['checking', 'ok', 'memory']),
  reason: v.optional(v.string()),
});
export type StorageState = v.InferOutput<typeof StorageStateSchema>;

export const TutorialStateSchema = v.object({
  status: v.picklist(['idle', 'active', 'done']),
  levelId: v.nullable(v.number()),
  step: v.number(),
  /** cell the pointer sits on, or null for a text-only step */
  target: v.nullable(CellIndexSchema),
  /** key into the tutorial copy section */
  copyKey: v.nullable(v.string()),
});
export type TutorialState = v.InferOutput<typeof TutorialStateSchema>;

export const SoundStateSchema = v.object({
  enabled: v.boolean(),
  status: v.picklist(['idle', 'ready', 'unavailable']),
});
export type SoundState = v.InferOutput<typeof SoundStateSchema>;

export const OfflineStateSchema = v.object({
  /** where this build is running */
  target: v.picklist(['artifact', 'pwa', 'file', 'dev', 'test']),
  worker: v.picklist(['none', 'registering', 'ready', 'error']),
  online: v.boolean(),
  reason: v.optional(v.string()),
});
export type OfflineState = v.InferOutput<typeof OfflineStateSchema>;

export const LearnStateSchema = v.object({
  status: v.picklist(['ready', 'error']),
  /** the lesson being shown, or null for the lesson list */
  lessonId: v.nullable(v.string()),
  step: v.number(),
  /** lesson ids the player has finished */
  completed: v.array(v.string()),
  /** the practice board on screen, if any */
  practice: v.nullable(v.object({
    cells: CellsSchema,
    start: CellsSchema,
    moves: v.number(),
    /** the cell the assistant suggests next, or null when assist is off */
    suggest: v.nullable(CellIndexSchema),
    status: v.picklist(['playing', 'solved']),
  })),
  assist: v.boolean(),
  error: v.optional(v.string()),
});
export type LearnState = v.InferOutput<typeof LearnStateSchema>;

/** Every slice in the store, by name. A slice name equals its owning module's name. */
export interface State {
  board: BoardState;
  levels: LevelsState;
  progress: ProgressState;
  hints: HintsState;
  nav: NavState;
  storage: StorageState;
  tutorial: TutorialState;
  sound: SoundState;
  offline: OfflineState;
  learn: LearnState;
}
export type SliceName = keyof State;
