// tutorial: coaches the first levels. Points at one cell of a fewest-presses solution (the play view
// draws the ring from this slice) and writes one coach sentence into the 'slot:coach' region.
import * as v from 'valibot';
import { LevelIdSchema, type Cells, type LevelId, type ModuleDef, type TutorialState } from '../../contracts';
import { fmt, setText } from '../../lib/dom';

const Rules = v.object({ levels: v.array(LevelIdSchema) });
const Flags = v.object({ enabled: v.boolean() });
/** keyed by level number: one sentence per step; the last one repeats for later steps */
const Copy = v.record(
  v.pipe(v.string(), v.regex(/^[1-9]\d*$/, 'keys must be level numbers')),
  v.pipe(v.array(v.pipe(v.string(), v.minLength(1))), v.minLength(1, 'needs at least one sentence')),
);
const Saved = v.object({ done: v.array(v.number()) });

const STORAGE_KEY = 'tutorial';

const tutorial: ModuleDef = {
  manifest: {
    name: 'tutorial',
    emits: ['tutorial:step_shown', 'tutorial:finished'],
    listens: ['board:loaded', 'board:pressed', 'board:undone', 'board:restarted', 'board:solved', 'tutorial:skip'],
    owns: ['tutorial'],
    optional: ['solver', 'storage', 'view'],
    data: { rules: Rules, flags: Flags, copy: Copy },
  },
  init(ctx) {
    if (!(ctx.data.flags as v.InferOutput<typeof Flags>).enabled) {
      ctx.log.info('The tutorial is switched off in flags.json');
      ctx.write('tutorial', { status: 'done', levelId: null, step: 0, target: null, copyKey: null });
      return;
    }
    const levels = (ctx.data.rules as v.InferOutput<typeof Rules>).levels;
    const copy = ctx.data.copy as v.InferOutput<typeof Copy>;
    const missing = levels.filter((l) => !copy[String(l)]);
    if (missing.length) throw new Error(`copy.json → tutorial has no sentences for level ${missing.join(', ')}`);

    const storage = ctx.service('storage');
    const solver = ctx.service('solver');
    const view = ctx.service('view');
    if (!solver) ctx.log.warn('No solver service: the tutorial shows its sentences without pointing at a cell');

    const done = new Set<number>(loadDone());

    function loadDone(): number[] {
      const raw = storage?.get(STORAGE_KEY);
      if (raw === undefined) return [];
      const parsed = v.safeParse(Saved, raw);
      if (parsed.success) return parsed.output.done;
      ctx.log.warn('Saved tutorial progress was unreadable, so the tutorial starts over', raw);
      return [];
    }

    function persist() {
      if (!storage) return;
      if (!storage.set(STORAGE_KEY, { done: [...done].sort((a, b) => a - b) })) ctx.log.info('Finished tutorial levels are kept only for this session');
    }

    const read = () => ctx.read('tutorial')!;
    /** the state when no level is being coached: 'done' once every tutorial level is finished */
    const rest = (): TutorialState => ({
      status: levels.every((l) => done.has(l)) ? 'done' : 'idle', levelId: null, step: 0, target: null, copyKey: null,
    });

    /** lowest index of a fewest-presses solution, or null (no solver, or nothing to press) */
    function targetFor(cells: Cells): number | null {
      const solution = solver?.solve(cells);
      if (!solution || solution.length === 0) return null;
      return Math.min(...solution);
    }

    const keyFor = (levelId: LevelId, step: number) => `${levelId}.${Math.min(step, copy[String(levelId)]!.length - 1)}`;

    function show(levelId: LevelId, step: number, target: number | null) {
      ctx.write('tutorial', { status: 'active', levelId, step, target, copyKey: keyFor(levelId, step) });
      ctx.emit('tutorial:step_shown', { levelId, step, target });
    }

    function setRest() {
      const next = rest();
      const cur = read();
      if (cur.status !== next.status || cur.levelId !== null) ctx.write('tutorial', next);
    }

    /** the active tutorial state for this level, or undefined */
    const activeOn = (levelId: LevelId) => {
      const cur = read();
      return cur.status === 'active' && cur.levelId === levelId ? cur : undefined;
    };

    ctx.on('board:loaded', ({ levelId, cells }) => {
      if (levels.includes(levelId) && !done.has(levelId)) show(levelId, 0, targetFor(cells));
      else setRest();
    });

    ctx.on('board:pressed', ({ levelId, index, cells, litCount }) => {
      const cur = activeOn(levelId);
      if (!cur || litCount === 0) return; // the winning press is handled by board:solved
      show(levelId, index === cur.target ? cur.step + 1 : cur.step, targetFor(cells));
    });

    const repoint = ({ levelId, cells }: { levelId: LevelId; cells: Cells }) => {
      const cur = activeOn(levelId);
      if (!cur) return;
      const target = targetFor(cells);
      if (target !== cur.target) show(levelId, cur.step, target);
    };
    ctx.on('board:undone', repoint);
    ctx.on('board:restarted', repoint);

    ctx.on('board:solved', ({ levelId }) => {
      if (!activeOn(levelId)) return;
      done.add(levelId);
      persist();
      ctx.write('tutorial', rest());
      ctx.emit('tutorial:finished', { levelId });
    });

    ctx.on('tutorial:skip', () => {
      for (const l of levels) done.add(l);
      persist();
      ctx.write('tutorial', rest());
    });

    // ---- the coach sentence ----
    const slot = view?.region('slot:coach');
    let line: HTMLParagraphElement | null = null;
    const sentence = (key: string): string | undefined => {
      const [level, step] = key.split('.');
      return copy[level!]?.[Number(step)];
    };
    const render = (s: TutorialState | undefined) => {
      if (!slot) return;
      const text = s?.status === 'active' && s.copyKey ? sentence(s.copyKey) : undefined;
      if (text === undefined) {
        if (slot.firstChild) slot.replaceChildren();
        return;
      }
      if (!line) {
        line = document.createElement('p');
        line.className = 'tutorial-line';
        line.dataset.tutorial = '';
        line.setAttribute('aria-live', 'polite');
      }
      if (line.parentNode !== slot) slot.replaceChildren(line);
      setText(line, fmt(text, { level: s!.levelId ?? '' }));
    };
    ctx.watch('tutorial', render);

    ctx.write('tutorial', rest());

    return {
      debug: () => ({ levels, done: [...done].sort((a, b) => a - b), solver: !!solver, state: read() }),
      commands: {
        /** forget finished levels; coaches the current board again if it is a tutorial level */
        reset() {
          done.clear();
          storage?.remove(STORAGE_KEY);
          const board = ctx.read('board');
          if (board?.status === 'playing' && board.levelId !== null && levels.includes(board.levelId)) {
            show(board.levelId, 0, targetFor(board.cells));
          } else ctx.write('tutorial', rest());
          return `tutorial levels ${levels.join(', ')} will show again`;
        },
      },
    };
  },
};
export default tutorial;
