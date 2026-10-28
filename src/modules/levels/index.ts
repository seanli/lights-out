// levels: makes the 50 levels from a fixed seed at boot, owns the `levels` slice, starts a level.
import * as v from 'valibot';
import type { LevelsState, ModuleDef } from '../../contracts';
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
});

const CopySchema = v.object({
  chapters: v.record(v.string(), v.pipe(v.string(), v.minLength(1))),
});

const levels: ModuleDef = {
  manifest: {
    name: 'levels',
    emits: ['levels:generated', 'levels:started', 'levels:refused', 'board:load'],
    listens: ['levels:start'],
    owns: ['levels'],
    uses: ['solver', 'rng'],
    data: { rules: RulesSchema, copy: CopySchema },
  },
  init(ctx) {
    const rules = ctx.data.rules as LevelsRules;
    const names = (ctx.data.copy as v.InferOutput<typeof CopySchema>).chapters;
    const solver = ctx.need('solver');
    const fail = (error: string) => ctx.write('levels', { status: 'error', list: [], chapters: [], error });

    // a bad chapter layout is a data mistake: say exactly where, and don't start
    let chapters: LevelsState['chapters'];
    try {
      chapters = checkChapters(rules.chapters, names, rules.pars.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fail(message);
      throw new Error(message);
    }

    let made: Generated | null = null;
    let ms = 0;
    try {
      const t0 = performance.now();
      made = generateLevels(rules, ctx.need('rng').seeded(rules.seed), solver);
      ms = performance.now() - t0;
      for (const m of made.missed) {
        ctx.log.warn(`Level ${m.id} has par ${m.got}, not ${m.wanted}: no board with par ${m.wanted} turned up in ${rules.maxTries} tries`, m);
      }
      ctx.write('levels', { status: 'ready', list: made.list, chapters });
      ctx.log.info(`Made ${made.list.length} levels in ${ms.toFixed(1)} ms`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      ctx.log.error(`Couldn't make the levels: ${message}`, err);
      fail(`Couldn't make the levels: ${message}`);
    }

    const refuse = (levelId: number, reason: 'locked' | 'unknown' | 'not_ready') => ctx.emit('levels:refused', { levelId, reason });

    ctx.on('levels:start', ({ levelId }) => {
      const state = ctx.read('levels');
      if (state?.status !== 'ready') return refuse(levelId, 'not_ready');
      const level = Number.isInteger(levelId) ? state.list[levelId - 1] : undefined;
      if (!level || level.id !== levelId) return refuse(levelId, 'unknown');
      const progress = ctx.read('progress');
      if (progress && levelId > progress.unlockedUpTo) return refuse(levelId, 'locked');
      ctx.emit('board:load', { levelId, cells: level.cells, par: level.par });
      ctx.emit('levels:started', { levelId, par: level.par, count: state.list.length });
    });

    return {
      // emitted once every module has initialised, so all listeners hear it
      start() {
        const state = ctx.read('levels');
        if (state?.status === 'ready') ctx.emit('levels:generated', { count: state.list.length, pars: state.list.map((l) => l.par) });
      },
      debug: () => ({ ms: Number(ms.toFixed(2)), tries: made?.tries, missed: made?.missed }),
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
          return state.list.map((l) => `${l.id}: ${l.par}`).join('\n');
        },
      },
    };
  },
};
export default levels;
