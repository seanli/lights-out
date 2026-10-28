// levels: makes the classic 50 levels and every Variety room from fixed seeds at boot, owns the `levels` slice, starts a level.
import * as v from 'valibot';
import { CLASSIC_SHAPE, MAX_SIDE, type LevelDef, type LevelsState, type ModuleDef, type Pack, type Shape } from '../../contracts';
import { cellCount, parseShape } from '../../lib/shape';
import { checkChapters, generateLevels, type Generated, type LevelsRules } from './generate';

/** No 5×5 board needs more than 15 presses, so a higher par could never be generated. */
const MAX_PAR = 15;
const int = v.pipe(v.number(), v.integer());

const RulesSchema = v.object({
  seed: int,
  pars: v.pipe(
    v.array(v.pipe(int, v.minValue(1), v.maxValue(MAX_PAR, `A par must be 1–${MAX_PAR}: no 5×5 board needs more than ${MAX_PAR} presses`))),
    v.minLength(1, 'There must be at least one level'),
  ),
  maxTries: v.pipe(int, v.minValue(1)),
  chapters: v.array(v.object({ id: v.pipe(v.string(), v.minLength(1)), from: v.pipe(int, v.minValue(1)), to: v.pipe(int, v.minValue(1)) })),
  /** Variety rooms, in menu order: a cols × rows board or a picture ("X" cell, "." gap); level ids idBase + 1.. */
  rooms: v.array(v.pipe(
    v.object({
      id: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/, 'A room id uses only a-z, 0-9 and "-"')),
      kind: v.picklist(['size', 'shape']),
      cols: v.optional(v.pipe(int, v.minValue(3), v.maxValue(MAX_SIDE))),
      rows: v.optional(v.pipe(int, v.minValue(3), v.maxValue(MAX_SIDE))),
      picture: v.optional(v.pipe(v.array(v.string()), v.maxLength(MAX_SIDE, `A room picture has at most ${MAX_SIDE} rows`))),
      idBase: v.pipe(int, v.minValue(1)),
      seed: int,
      pars: v.pipe(v.array(v.pipe(int, v.minValue(1))), v.minLength(1, 'A room needs at least one level')),
    }),
    v.check((r) => (r.picture !== undefined) !== (r.cols !== undefined || r.rows !== undefined), 'A room has either cols and rows, or a picture'),
    v.check((r) => r.picture !== undefined || (r.cols !== undefined && r.rows !== undefined), 'A size room needs both cols and rows'),
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
    shape = room.picture ? parseShape(room.picture) : { cols: room.cols!, rows: room.rows!, mask: null };
  } catch (err) {
    throw new Error(`Room "${room.id}": ${err instanceof Error ? err.message : String(err)}`);
  }
  if (shape.cols > MAX_SIDE) throw new Error(`Room "${room.id}" is ${shape.cols} cells wide; the most is ${MAX_SIDE}`);
  const cells = cellCount(shape);
  const top = Math.max(...room.pars);
  if (top > cells) throw new Error(`Room "${room.id}" asks for par ${top}, but its board has only ${cells} cells`);
  return shape;
}

/** packs in menu order (classic first); throws on overlapping ids, duplicate rooms or missing names */
function planPacks(rules: Rules, copy: v.InferOutput<typeof CopySchema>): { pack: Pack; room: Room | null }[] {
  const out: { pack: Pack; room: Room | null }[] = [
    { pack: { id: 'classic', name: copy.classic, kind: 'classic', shape: CLASSIC_SHAPE, first: 1, count: rules.pars.length }, room: null },
  ];
  for (const room of rules.rooms) {
    if (out.some((p) => p.pack.id === room.id)) throw new Error(`Two rooms are called "${room.id}"`);
    const name = copy.rooms[room.id];
    if (!name) throw new Error(`Room "${room.id}" has no name in copy.json → levels.rooms`);
    const first = room.idBase + 1, last = room.idBase + room.pars.length;
    const clash = out.find((p) => first <= p.pack.first + p.pack.count - 1 && p.pack.first <= last);
    if (clash) throw new Error(`Room "${room.id}" uses level ids ${first}–${last}, which overlap "${clash.pack.id}"`);
    out.push({ pack: { id: room.id, name, kind: room.kind, shape: roomShape(room), first, count: room.pars.length }, room });
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
    const rules = ctx.data.rules as Rules & LevelsRules;
    const copy = ctx.data.copy as v.InferOutput<typeof CopySchema>;
    const solver = ctx.need('solver');
    const fail = (error: string) => ctx.write('levels', { status: 'error', list: [], chapters: [], error });

    // a bad chapter or room layout is a data mistake: say exactly where, and don't start
    let chapters: LevelsState['chapters'];
    let plan: ReturnType<typeof planPacks>;
    try {
      chapters = checkChapters(rules.chapters, copy.chapters, rules.pars.length);
      plan = planPacks(rules, copy);
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
      for (const { pack, room } of plan) {
        const t0 = performance.now();
        // classic: exactly the generation it always had (same seed, no pack fields), so the 50 boards never change
        const g = room
          ? generateLevels({ pars: room.pars, maxTries: rules.maxTries }, rng.seeded(room.seed), solver, { idBase: room.idBase, shape: pack.shape, pack: pack.id })
          : generateLevels(rules, rng.seeded(rules.seed), solver);
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
      ctx.emit('levels:started', { levelId, par: level.par, count, pack: packId, index, next });
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
          return state.list.map((l) => `${l.id}: ${l.par}${l.pack ? ` (${l.pack} ${l.index})` : ''}`).join('\n');
        },
      },
    };
  },
};
export default levels;
