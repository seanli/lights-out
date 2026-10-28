// One schema per entity; TypeScript types are derived from the schemas.
// Changing a shape here is a contract change: ask the lead first.
import * as v from 'valibot';

/** Bump when any slice shape below changes; hot-reload snapshots from another version are discarded. */
export const CONTRACT_VERSION = 3;

/** The classic board: 5×5, no gaps. The tutorial, Learn and the Patterns table are about this board. */
export const SIZE = 5;
export const CELL_COUNT = SIZE * SIZE;
/** the widest board (10×10 Cathedral) and the tallest (the 6×16 Tower, which scrolls) */
export const MAX_COLS = 10;
export const MAX_ROWS = 16;
export const MAX_CELLS = MAX_COLS * MAX_ROWS;

/**
 * A board's shape: a cols × rows grid. `mask` marks which grid positions are real cells (null = all of them);
 * a gap is never lit, never pressable, and a press never reaches across it. Pure helpers: src/lib/shape.ts.
 */
export const ShapeSchema = v.object({
  cols: v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(MAX_COLS)),
  rows: v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(MAX_ROWS)),
  mask: v.nullable(v.array(v.boolean())),
});
export type Shape = v.InferOutput<typeof ShapeSchema>;
export const CLASSIC_SHAPE: Shape = Object.freeze({ cols: SIZE, rows: SIZE, mask: null }) as Shape;

/** One boolean per grid position (cols × rows), row-major, index = row * cols + col. true = lit. Gaps are false. */
export const CellsSchema = v.pipe(v.array(v.boolean()), v.minLength(9), v.maxLength(MAX_CELLS));
export type Cells = v.InferOutput<typeof CellsSchema>;

export const CellIndexSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_CELLS - 1));

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
  /** absent = the classic 5×5 board */
  shape: v.optional(ShapeSchema),
});
export type BoardState = v.InferOutput<typeof BoardStateSchema>;

export const LevelDefSchema = v.object({
  /** unique across all packs and stable forever (saves are keyed by it): classic 1–50, rooms from their idBase */
  id: LevelIdSchema,
  cells: CellsSchema,
  par: v.number(),
  /** absent = 'classic' */
  pack: v.optional(v.string()),
  /** 1-based position inside its pack; absent = id (classic) */
  index: v.optional(v.number()),
  /** absent = the classic 5×5 board */
  shape: v.optional(ShapeSchema),
  /** a boss level (every 10th of a pack): drastically harder than the levels before it; shown with a skull */
  boss: v.optional(v.literal(true)),
});
export type LevelDef = v.InferOutput<typeof LevelDefSchema>;

export const ChapterSchema = v.object({
  id: v.string(),
  name: v.string(),
  from: LevelIdSchema,
  to: LevelIdSchema,
});
export type Chapter = v.InferOutput<typeof ChapterSchema>;

/** A level pack: the classic path, or a Variety room. Its levels are ids first .. first + count - 1. */
export const PackSchema = v.object({
  id: v.string(),
  name: v.string(),
  kind: v.picklist(['classic', 'size', 'shape']),
  /** the menu section it sits in */
  group: v.optional(v.picklist(['boards', 'shapes', 'extreme'])),
  shape: ShapeSchema,
  first: LevelIdSchema,
  count: v.number(),
});
export type Pack = v.InferOutput<typeof PackSchema>;

export const LevelsStateSchema = v.object({
  status: v.picklist(['generating', 'ready', 'error']),
  /** every level of every pack */
  list: v.array(LevelDefSchema),
  /** chapters of the classic path */
  chapters: v.array(ChapterSchema),
  /** 'classic' first, then the Variety rooms in menu order; absent in old snapshots = classic only */
  packs: v.optional(v.array(PackSchema)),
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
  /** per Variety room: highest level index that may be started, levels solved, stars earned */
  packs: v.optional(v.record(v.string(), v.object({ unlockedUpTo: v.number(), solved: v.number(), stars: v.number() }))),
  /** true once the Variety menu is open (rules.json → progress.varietyAfter) */
  varietyOpen: v.optional(v.boolean()),
});
export type ProgressState = v.InferOutput<typeof ProgressStateSchema>;

export const HintsStateSchema = v.object({
  status: v.picklist(['idle', 'showing']),
  levelId: v.nullable(v.number()),
  cell: v.nullable(CellIndexSchema),
});
export type HintsState = v.InferOutput<typeof HintsStateSchema>;

export const ScreenSchema = v.picklist(['home', 'play', 'learn', 'variety']);
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

export const VarietyStateSchema = v.object({
  /** the room whose levels are showing, or null for the room list */
  room: v.nullable(v.string()),
});
export type VarietyState = v.InferOutput<typeof VarietyStateSchema>;

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
  variety: VarietyState;
}
export type SliceName = keyof State;
