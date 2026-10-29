// levels: makes every board's levels from fixed seeds at boot, owns the `levels` slice, starts a level.
// Levels come in bands of ten: nine that ramp up, then a boss (every 10th level) that is drastically harder.
import * as v from 'valibot';
import { CLASSIC_SHAPE, MAX_COLS, MAX_ROWS, type Cells, type LevelDef, type LevelsState, type ModuleDef, type Pack, type Shape, type SolverService } from '../../contracts';
import { cubeShape } from '../../lib/cube';
import { cellCount, cellIndexes, gridSize, hexagonShape, isCell, parseShape } from '../../lib/shape';
import { SYMMETRY_NAMES } from '../../lib/symmetry';
import { checkChapters, generateLevels, generateRoom, parsOf, type Generated } from './generate';

/** No 5×5 board needs more than 15 presses, so a higher par could never be generated. */
const MAX_PAR = 15;
/** levels per band: the last of each ten is the boss */
const BAND = 10;
const int = v.pipe(v.number(), v.integer());

/** nine levels that ramp up, then the boss: always ten levels, so every 10th level is a boss */
const BandSchema = v.pipe(
  v.object({
    pars: v.pipe(v.array(v.pipe(int, v.minValue(1))), v.length(BAND - 1, `A band has ${BAND - 1} levels before its boss`)),
    boss: v.pipe(int, v.minValue(1)),
    /** a stuck room: stuck cells on each level of this band */
    stuck: v.optional(v.pipe(int, v.minValue(1))),
    /** a wired room: how many wiring patterns a level mixes, and whether only the gentle ones (lines, plus, cross) */
    kinds: v.optional(v.pipe(int, v.minValue(1))),
    gentle: v.optional(v.boolean()),
  }),
  v.check((b) => b.boss > Math.max(...b.pars), 'A boss must need more presses than every level in its band'),
);
const BandsSchema = v.pipe(v.array(BandSchema), v.minLength(1, 'There must be at least one band of levels'));

/** a hand-made level: at a position in its pack, every light on ("all") or a picture over the grid ("X" lit, "." dark) */
const PicturesSchema = v.pipe(
  v.array(v.object({ at: v.pipe(int, v.minValue(1)), picture: v.union([v.literal('all'), v.pipe(v.array(v.string()), v.minLength(1))]) })),
  v.check((list) => new Set(list.map((p) => p.at)).size === list.length, 'Two pictures are at the same level'),
);
const SymmetrySchema = v.picklist(SYMMETRY_NAMES);

const RulesSchema = v.object({
  seed: int,
  bands: v.pipe(
    BandsSchema,
    v.check((bands) => parsOf(bands).every((p) => p <= MAX_PAR), `A classic par must be 1–${MAX_PAR}: no 5×5 board needs more than ${MAX_PAR} presses`),
  ),
  maxTries: v.pipe(int, v.minValue(1)),
  chapters: v.array(v.object({ id: v.pipe(v.string(), v.minLength(1)), from: v.pipe(int, v.minValue(1)), to: v.pipe(int, v.minValue(1)) })),
  /** most presses of a room level that may show as a whole footprint (readable straight off the board) */
  readable: v.pipe(int, v.minValue(0)),
  /** tries per room level before keeping the closest board found */
  roomTries: v.pipe(int, v.minValue(1)),
  /** from this level of a board on (classic and every board you chase), a plain chase never clears it: no free par */
  fixFrom: v.pipe(int, v.minValue(1)),
  /**
   * symmetric boards (lib/symmetry.ts): a level's first choice takes turns along `levels`, a boss takes `boss` in
   * order; `tries` per symmetry before the next; classic levels before `from` keep their random presses (the tutorial's)
   */
  looks: v.object({
    levels: v.pipe(v.array(SymmetrySchema), v.minLength(1)),
    boss: v.pipe(v.array(SymmetrySchema), v.minLength(1)),
    from: v.pipe(int, v.minValue(1)),
    tries: v.pipe(int, v.minValue(1)),
  }),
  /** classic levels made by hand */
  pictures: v.optional(PicturesSchema),
  /**
   * Variety rooms, in menu order. size / stuck / wired: cols × rows; shape: a picture ("X" cell, "." gap);
   * hex: a hexagon with `side` cells per edge; cube: `side` cells along each face's edge. Level ids idBase + 1..
   * Ids of retired rooms stay reserved (DECISIONS.md), so a save keeps their stars.
   */
  rooms: v.array(v.pipe(
    v.object({
      id: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/, 'A room id uses only a-z, 0-9 and "-"')),
      kind: v.picklist(['size', 'shape', 'hex', 'cube', 'stuck', 'wired']),
      /** the menu section: boards (classic rules), twists (new rules), extreme (big or scrolling) */
      group: v.picklist(['boards', 'twists', 'extreme']),
      cols: v.optional(v.pipe(int, v.minValue(3), v.maxValue(MAX_COLS))),
      rows: v.optional(v.pipe(int, v.minValue(3), v.maxValue(MAX_ROWS))),
      picture: v.optional(v.pipe(v.array(v.string()), v.maxLength(MAX_ROWS, `A room picture has at most ${MAX_ROWS} rows`))),
      side: v.optional(v.pipe(int, v.minValue(2), v.maxValue(5))),
      idBase: v.pipe(int, v.minValue(1)),
      seed: int,
      bands: BandsSchema,
      /** levels made by hand (in a stuck or wired room, each one's stuck cells or wiring are placed around it) */
      pictures: v.optional(PicturesSchema),
    }),
    v.check((r) => r.kind !== 'shape' || (r.picture !== undefined && r.cols === undefined && r.rows === undefined), 'A shape room has a picture (and no cols or rows)'),
    v.check((r) => !['size', 'stuck', 'wired'].includes(r.kind) || (r.cols !== undefined && r.rows !== undefined && r.picture === undefined), 'A size, stuck or wired room needs cols and rows (and no picture)'),
    v.check((r) => !['hex', 'cube'].includes(r.kind) || (r.side !== undefined && r.cols === undefined && r.rows === undefined && r.picture === undefined), 'A hex or cube room needs a side (and no cols, rows or picture)'),
    v.check((r) => r.kind === 'stuck' || r.bands.every((b) => b.stuck === undefined), 'Only a stuck room sets stuck cells per band'),
    v.check((r) => r.kind === 'wired' || r.bands.every((b) => b.kinds === undefined && b.gentle === undefined), 'Only a wired room sets wiring per band'),
  )),
});
type Rules = v.InferOutput<typeof RulesSchema>;
type Room = Rules['rooms'][number];

const CopySchema = v.object({
  chapters: v.record(v.string(), v.pipe(v.string(), v.minLength(1))),
  /** the classic pack's name */
  classic: v.pipe(v.string(), v.minLength(1)),
  rooms: v.record(v.string(), v.pipe(v.string(), v.minLength(1))),
});

/** a room's board shape, checked against everything the data can get wrong; throws a plain message */
function roomShape(room: Room): Shape {
  let shape: Shape;
  try {
    shape = room.kind === 'shape' ? parseShape(room.picture!)
      : room.kind === 'hex' ? hexagonShape(room.side!)
      : room.kind === 'cube' ? cubeShape(room.side!)
      : { cols: room.cols!, rows: room.rows!, mask: null };
  } catch (err) {
    throw new Error(`Room "${room.id}": ${err instanceof Error ? err.message : String(err)}`);
  }
  if (shape.cols > MAX_COLS) throw new Error(`Room "${room.id}" is ${shape.cols} cells wide; the most is ${MAX_COLS}`);
  const cells = cellCount(shape);
  const top = Math.max(...parsOf(room.bands));
  if (top > cells) throw new Error(`Room "${room.id}" asks for par ${top}, but its board has only ${cells} cells`);
  return shape;
}

/** a pack's pictures as boards by position, checked against its shape; throws a plain message */
function pictureBoards(where: string, shape: Shape, count: number, list: v.InferOutput<typeof PicturesSchema> | undefined, solver: SolverService, twisted = false): Map<number, Cells> {
  const out = new Map<number, Cells>();
  for (const { at, picture } of list ?? []) {
    const name = `${where} level ${at}'s picture`;
    if (at > count) throw new Error(`${name}: the pack has only ${count} levels`);
    const cells: boolean[] = new Array<boolean>(gridSize(shape)).fill(false);
    if (picture === 'all') for (const i of cellIndexes(shape)) cells[i] = true;
    else {
      if (picture.length !== shape.rows || picture.some((r) => r.length !== shape.cols)) throw new Error(`${name} must be ${shape.rows} rows of ${shape.cols}`);
      if (!picture.every((r) => /^[X.]+$/.test(r))) throw new Error(`${name} uses only "X" (lit) and "." (dark)`);
      picture.join('').split('').forEach((ch, i) => { cells[i] = ch === 'X'; });
      if (cells.some((on, i) => on && !isCell(shape, i))) throw new Error(`${name} lights a gap in the board`);
      if (!cells.some(Boolean)) throw new Error(`${name} has no lights on`);
    }
    // a stuck or wired room places its twist around the picture when it makes the level, and checks it there
    if (!twisted && !solver.isSolvable(cells, shape)) throw new Error(`${name} can't be solved: no presses turn it all off`);
    out.set(at, cells);
  }
  return out;
}

/** packs in menu order (classic first); throws on overlapping ids, duplicate rooms or missing names */
function planPacks(rules: Rules, copy: v.InferOutput<typeof CopySchema>, solver: SolverService): { pack: Pack; room: Room | null; pictures: Map<number, Cells> }[] {
  const classicCount = rules.bands.length * BAND;
  const out: { pack: Pack; room: Room | null; pictures: Map<number, Cells> }[] = [
    { pack: { id: 'classic', name: copy.classic, kind: 'classic', group: 'boards', shape: CLASSIC_SHAPE, first: 1, count: classicCount }, room: null, pictures: pictureBoards('Classic', CLASSIC_SHAPE, classicCount, rules.pictures, solver) },
  ];
  for (const room of rules.rooms) {
    if (out.some((p) => p.pack.id === room.id)) throw new Error(`Two rooms are called "${room.id}"`);
    const name = copy.rooms[room.id];
    if (!name) throw new Error(`Room "${room.id}" has no name in copy.json → levels.rooms`);
    const count = room.bands.length * BAND;
    const first = room.idBase + 1, last = room.idBase + count;
    const clash = out.find((p) => first <= p.pack.first + p.pack.count - 1 && p.pack.first <= last);
    if (clash) throw new Error(`Room "${room.id}" uses level ids ${first}–${last}, which overlap "${clash.pack.id}"`);
    const shape = roomShape(room);
    out.push({ pack: { id: room.id, name, kind: room.kind, group: room.group, shape, first, count }, room, pictures: pictureBoards(`Room "${room.id}"`, shape, count, room.pictures, solver, room.kind === 'stuck' || room.kind === 'wired') });
  }
  return out;
}

const levels: ModuleDef = {
  manifest: {
    name: 'levels',
    emits: ['levels:start', 'levels:generated', 'levels:started', 'levels:refused', 'board:load'],
    listens: ['levels:start'],
    owns: ['levels'],
    uses: ['solver', 'rng'],
    data: { rules: RulesSchema, copy: CopySchema },
  },
  init(ctx) {
    const rules = ctx.data.rules as Rules;
    const classicPars = parsOf(rules.bands);
    const copy = ctx.data.copy as v.InferOutput<typeof CopySchema>;
    const solver = ctx.need('solver');
    const fail = (error: string) => ctx.write('levels', { status: 'error', list: [], chapters: [], error });

    // a bad chapter or room layout is a data mistake: say exactly where, and don't start
    let chapters: LevelsState['chapters'];
    let plan: ReturnType<typeof planPacks>;
    try {
      chapters = checkChapters(rules.chapters, copy.chapters, classicPars.length);
      plan = planPacks(rules, copy, solver);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fail(message);
      throw new Error(message);
    }

    /** per pack: generation time and tries per level */
    const made: Record<string, { ms: number; tries: number[]; missed: Generated['missed'] }> = {};
    let ms = 0;
    try {
      const rng = ctx.need('rng');
      const list: LevelDef[] = [];
      const { from: looksFrom, ...looks } = rules.looks;
      for (const { pack, room, pictures } of plan) {
        const t0 = performance.now();
        // classic levels carry no pack fields (ids 1..n); every 10th level of every pack is a boss
        // pictures where the data puts them; otherwise symmetric boards (lib/puzzle.ts symmetric), and failing those,
        // random presses (classic) or tangled ones (rooms); all pinned by tests
        const twist = room?.kind === 'stuck' || room?.kind === 'wired' ? room.kind : undefined;
        const g = room
          ? generateRoom({ idBase: room.idBase, pack: pack.id, shape: pack.shape, bands: room.bands, readable: rules.readable, maxTries: rules.roomTries, fixFrom: rules.fixFrom, looks, pictures, ...(twist ? { twist } : {}) }, rng.seeded(room.seed), solver)
          : generateLevels({ pars: classicPars, maxTries: rules.maxTries }, rng.seeded(rules.seed), solver, { idBase: 0, bossEvery: BAND, fixFrom: rules.fixFrom, looks, looksFrom, pictures });
        const took = performance.now() - t0;
        ms += took;
        made[pack.id] = { ms: Number(took.toFixed(2)), tries: g.tries, missed: g.missed };
        for (const m of g.missed) {
          ctx.log.warn(`Level ${m.id} has par ${m.got}, not ${m.wanted}: no board with par ${m.wanted} turned up in ${rules.maxTries} tries`, m);
        }
        list.push(...g.list);
      }
      ctx.write('levels', { status: 'ready', list, chapters, packs: plan.map((p) => p.pack) });
      ctx.log.info(`Made ${list.length} levels in ${plan.length} packs in ${ms.toFixed(1)} ms`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.log.error(`Couldn't make the levels: ${message}`, err);
      fail(`Couldn't make the levels: ${message}`);
    }

    const refuse = (levelId: number, reason: 'locked' | 'unknown' | 'not_ready') => ctx.emit('levels:refused', { levelId, reason });

    /** classic levels sit at list[id - 1]; room levels are found by id */
    const find = (state: LevelsState, levelId: number): LevelDef | undefined => {
      if (!Number.isInteger(levelId)) return undefined;
      const at = state.list[levelId - 1];
      return at?.id === levelId ? at : state.list.find((l) => l.id === levelId);
    };

    ctx.on('levels:start', ({ levelId }) => {
      const state = ctx.read('levels');
      if (state?.status !== 'ready') return refuse(levelId, 'not_ready');
      const level = find(state, levelId);
      if (!level) return refuse(levelId, 'unknown');
      const packId = level.pack ?? 'classic';
      const index = level.index ?? levelId;
      const pack = state.packs?.find((p) => p.id === packId);
      const count = pack?.count ?? state.list.filter((l) => (l.pack ?? 'classic') === packId).length;
      const progress = ctx.read('progress');
      if (progress) {
        // classic: one at a time along the path; a room: only once Variety is open, then one at a time inside the room
        const locked = packId === 'classic'
          ? levelId > progress.unlockedUpTo
          : !progress.varietyOpen || index > (progress.packs?.[packId]?.unlockedUpTo ?? 1);
        if (locked) return refuse(levelId, 'locked');
      }
      ctx.emit('board:load', { levelId, cells: level.cells, par: level.par, ...(level.shape ? { shape: level.shape } : {}) });
      const next = index < count ? (pack ? pack.first + index : levelId + 1) : null;
      ctx.emit('levels:started', { levelId, par: level.par, count, pack: packId, index, next, ...(level.boss ? { boss: true } : {}) });
    });

    return {
      // emitted once every module has initialised, so all listeners hear it
      start() {
        const state = ctx.read('levels');
        // about the classic path, as before rooms existed (room levels are in the slice's list and packs)
        const classic = state?.status === 'ready' ? state.list.filter((l) => l.pack === undefined) : [];
        if (state?.status === 'ready') ctx.emit('levels:generated', { count: classic.length, pars: classic.map((l) => l.par) });
      },
      debug: () => ({ ms: Number(ms.toFixed(2)), packs: made }),
      commands: {
        start(args) {
          const levelId = Number(args[0]);
          if (!args[0] || !Number.isInteger(levelId)) return 'Usage: levels.start <level number>';
          ctx.emit('levels:start', { levelId });
          return `Asked to start level ${levelId}`;
        },
        list() {
          const state = ctx.read('levels');
          if (state?.status !== 'ready') return `Levels aren't ready (${state?.error ?? state?.status ?? 'missing'})`;
          return state.list.map((l) => `${l.id}: ${l.par}${l.pack ? ` (${l.pack} ${l.index})` : ''}${l.boss ? ' boss' : ''}`).join('\n');
        },
      },
    };
  },
};
export default levels;
