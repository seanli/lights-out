// One schema per entity; TypeScript types are derived from the schemas.
// Changing a shape here is a contract change: ask the lead first.
import * as v from 'valibot';

/** Bump when any slice shape below changes; hot-reload snapshots from another version are discarded. */
export const CONTRACT_VERSION = 4;

/** The classic board: 5×5, no gaps. The tutorial, Learn and the Patterns table are about this board. */
export const SIZE = 5;
export const CELL_COUNT = SIZE * SIZE;
/** the widest grid (a 4×4 cube's net: three faces across) and the tallest (the 6×16 Tower, which scrolls) */
export const MAX_COLS = 12;
export const MAX_ROWS = 16;
export const MAX_CELLS = MAX_COLS * MAX_ROWS;

export const CellIndexSchema = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_CELLS - 1));

/**
 * How cells touch. 'square': up/down/left/right. 'hex': odd rows sit half a cell to the right, and a press reaches the
 * six touching cells. 'cube': the grid is the cube's unfolded net (lib/cube.ts: three faces across, four down, a
 * vertical cross), and a press reaches the four touching cells, round the cube's edges too.
 */
export const GridSchema = v.picklist(['square', 'hex', 'cube']);
export type Grid = v.InferOutput<typeof GridSchema>;

/**
 * A board's shape: a cols × rows grid. `mask` marks which grid positions are real cells (null = all of them);
 * a gap is never lit, never pressable, and a press never reaches across it. Pure helpers: src/lib/shape.ts.
 * The optional rules travel with the shape, so a level whose stuck cells or wiring differ is simply another shape.
 */
export const ShapeSchema = v.object({
  cols: v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(MAX_COLS)),
  rows: v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(MAX_ROWS)),
  mask: v.nullable(v.array(v.boolean())),
  /** absent = 'square' */
  grid: v.optional(GridSchema),
  /** stuck cells (grid indexes): lights that can't be pressed; a neighbour's press still flips them */
  stuck: v.optional(v.array(CellIndexSchema)),
  /**
   * wired switches (square grid only): one number per grid position; bit k set = a press there also flips the
   * neighbour in direction k (0 up, 1 up-right, 2 right, 3 down-right, 4 down, 5 down-left, 6 left, 7 up-left).
   * The pressed cell always flips. Absent = every cell flips up/down/left/right (the plus).
   */
  wires: v.optional(v.array(v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(255)))),
});
export type Shape = v.InferOutput<typeof ShapeSchema>;
export const CLASSIC_SHAPE: Shape = Object.freeze({ cols: SIZE, rows: SIZE, mask: null }) as Shape;

/** One boolean per grid position (cols × rows), row-major, index = row * cols + col. true = lit. Gaps are false. */
export const CellsSchema = v.pipe(v.array(v.boolean()), v.minLength(9), v.maxLength(MAX_CELLS));
export type Cells = v.InferOutput<typeof CellsSchema>;

export const LevelIdSchema = v.pipe(v.number(), v.integer(), v.minValue(1));
export type LevelId = number;

/** Custom puzzles (the custom module) all play under this one level id; progress never saves them */
export const CUSTOM_LEVEL_ID = 999_999;

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
  /** classic; size / shape: plain or pictured square grids; hex, cube; stuck / wired: a twist that varies per level */
  kind: v.picklist(['classic', 'size', 'shape', 'hex', 'cube', 'stuck', 'wired']),
  /** the menu section it sits in */
  group: v.optional(v.picklist(['boards', 'twists', 'extreme'])),
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
  /** hints taken on the custom puzzle on screen (custom puzzles are never saved, so this lives only here) */
  customHints: v.optional(v.number()),
});
export type ProgressState = v.InferOutput<typeof ProgressStateSchema>;

export const HintsStateSchema = v.object({
  status: v.picklist(['idle', 'showing']),
  levelId: v.nullable(v.number()),
  cell: v.nullable(CellIndexSchema),
});
export type HintsState = v.InferOutput<typeof HintsStateSchema>;

export const ScreenSchema = v.picklist(['home', 'play', 'learn', 'variety', 'custom']);
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

/** What the player picks for a custom board. Each grid keeps its own size, so switching grids keeps your sizes. */
export const CustomSettingsSchema = v.object({
  grid: GridSchema,
  /** square: width and height */
  cols: v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(10)),
  rows: v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(MAX_ROWS)),
  /** hex: the hexagon's side (3 = 19 lights, 4 = 37, 5 = 61) */
  hexSide: v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(5)),
  /** cube: cells along a face's edge */
  cubeSide: v.pipe(v.number(), v.integer(), v.minValue(3), v.maxValue(4)),
  /** wired needs the square grid */
  twist: v.picklist(['none', 'stuck', 'wired']),
  difficulty: v.picklist(['easy', 'medium', 'hard', 'boss']),
});
export type CustomSettings = v.InferOutput<typeof CustomSettingsSchema>;

export const CustomStateSchema = v.object({
  status: v.picklist(['idle', 'playing', 'error']),
  settings: CustomSettingsSchema,
  /** puzzles started this session (the play header says "Puzzle N") */
  played: v.number(),
  /** the board in words, e.g. "Hex · 37 lights · Stuck cells" (null before the first puzzle) */
  label: v.nullable(v.string()),
  error: v.optional(v.string()),
});
export type CustomState = v.InferOutput<typeof CustomStateSchema>;

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
  custom: CustomState;
}
export type SliceName = keyof State;
