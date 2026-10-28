// learn: the Learn screen. Five lessons that teach the patterns that solve any board, each a few
// short steps (illustration, animated demo, table, practice), and one short guide per room
// on that room's own shape. Owns the `learn` slice.
import * as v from 'valibot';
import { CELL_COUNT, CLASSIC_SHAPE, MAX_CELLS, type Cells, type LearnState, type ModuleDef, type Pack } from '../../contracts';
import { cellIndexes, isCell, isPressable, isStuck, shapeKey } from '../../lib/shape';
import { LESSONS, type Lesson } from './lessons';
import { bottomRowTable, chaseShape, chaseSuggest, createFixer, fixSuggest, isClear, makeBoard, methodSuggest, quietPatterns, touches, type Fixer, type TableEntry } from './method';
import { GUIDE_PREFIX, GUIDE_STEPS, TWISTS, buildGuide, guideId, guideKind, spotOrder, type GuideKind } from './guides';
import { emptySave, type DrillSave } from './drill';
import { createReference } from './reference';
import { createLearnView } from './view';
import './learn.css';

const int = v.pipe(v.number(), v.integer());
const RulesSchema = v.object({
  lessons: v.pipe(v.array(v.picklist(Object.keys(LESSONS) as [string, ...string[]])), v.minLength(1)),
  /** taps that make a practice board, per lesson id (board guides: "guide-<room id>") */
  practicePresses: v.record(v.string(), v.pipe(v.tuple([v.pipe(int, v.minValue(1)), v.pipe(int, v.maxValue(MAX_CELLS))]), v.check(([a, b]) => a <= b, 'min must not exceed max'))),
  demoStartMs: v.pipe(int, v.minValue(0)),
  demoStepMs: v.pipe(int, v.minValue(50)),
  demoHoldMs: v.pipe(int, v.minValue(50)),
  /** a long demo (10×10, the Tower) plays its taps faster so the whole demo takes about this long */
  demoMaxMs: v.pipe(int, v.minValue(1000)),
  saveKey: v.pipe(v.string(), v.minLength(1)),
  drill: v.object({
    cards: v.pipe(int, v.minValue(1)),
    boxes: v.pipe(int, v.minValue(2)),
    missGap: v.pipe(int, v.minValue(1)),
    saveKey: v.pipe(v.string(), v.minLength(1)),
  }),
});
export type LearnRules = v.InferOutput<typeof RulesSchema>;
/** a guide with no range in rules.json → learn.practicePresses (requests.md: the twist rooms' ranges belong there) */
const GUIDE_PRESSES: [number, number] = [3, 4];

const text = v.pipe(v.string(), v.minLength(1));
const CopySchema = v.looseObject({
  title: text, subtitle: text, back: text, backToLessons: text, stepOf: text, stepOfSize: text, prev: text, next: text, finish: text,
  done: text, assist: text, newBoard: text, another: text, assistLine: text, aimTip: text, undoHint: text, moves: text, movesPar: text,
  solved: text, solvedPar: text, solvedAtPar: text, demoPlay: text, demoReplay: text, demoStep: text, demoTap: text, demoPhaseTap: text,
  demoDone: text, demoCancel: text,
  /** how a demo ends when it doesn't end dark ({n} = lights left) */
  demoEnd: v.object({ left: text, stuck: text, stuckShape: text, cancelled: text }),
  demoPhase: v.object({ chase: text, top: text, edge: text, chase2: text, spot: text }),
  /** a guide's practice line by phase: chasing, only the bottom (end) lights left, after the top taps; edgeFix: the Stuck room's */
  coach: v.object({ chase: text, bottom: text, bottoms: text, again: text, shapeFix: text, edgeFix: text }),
  captions: v.record(v.string(), text), cellOn: text, cellOff: text,
  /** "A and B", "A, B and C" */
  and: text, comma: text,
  letters: v.pipe(v.string(), v.minLength(10)), echoJoin: text, deeper: text, echoMatch: text, tableBottom: text, tableTop: text,
  echo: v.object({ pick: text, caption: text }),
  stack: v.object({ of: text, both: text, cancel: text }),
  derive: v.object({ row: text, echo: text }),
  rules: v.object({ three: text, allButMiddle: text, pairLoner: text, corners: text, gap: text, mirror: text }),
  drill: v.object({ check: text, next: text, again: text, card: text, right: text, wrong: text, score: text, scoreLine: text }),
  reference: v.object({
    yourRow: text, bottom: text, top: text, echo: text, lessons: text, guide: text,
    status: v.object({
      start: text, chase: text, match: text, progress: text, clear: text, nomatch: text, rectBottom: text, rectMatch: text,
      shapedFix: text, shapedProgress: text, shapedNomatch: text,
    }),
    /** the rule line per full rectangle: the rule its maths follows (method.ts → RECT_RULES), else ownTaps */
    rect: v.object({ chaseClears: text, straightAbove: text, threeAbove: text, twoAside: text, aboveTwoAside: text, ownTaps: text }),
    /** the one-line tip on a board with no bottom row to read: a honeycomb, a cube, wired or stuck switches */
    tips: v.object({ hex: text, cube: text, wired: text, stuck: text }),
  }),
  lessons: v.record(v.string(), v.object({ title: text, summary: text, steps: v.array(text) })),
  /** the Learn list's two groups */
  sections: v.object({ basics: text, boards: text }),
  /** board guides by room id; the title is the room's name. A room with no entry gets no guide. */
  guides: v.record(v.string(), v.object({ summary: text, steps: v.array(text) })),
  /** the lights step of a full-rectangle guide: the letters' group label, one letter read aloud, the end line */
  lights: v.object({ pick: text, row: text, end: text }),
});
export type LearnCopy = v.InferOutput<typeof CopySchema>;

const SaveSchema = v.object({ completed: v.array(v.string()) });
const DrillSaveSchema = v.object({ boxes: v.record(v.string(), v.number()), rounds: v.number() });

/** what the view needs to know about lessons and guides */
export interface Catalog {
  lesson(id: string | null): Lesson | undefined;
  /** title, summary and one sentence per step */
  text(id: string): { title: string; summary: string; steps: string[] } | undefined;
  /** rooms with a guide, in menu order */
  guides(): { id: string; pack: Pack }[];
  /** true when the open lesson was opened from outside Learn (Back and Done return there) */
  direct(): boolean;
  /** a guide's top-edge fixes (its coach line and its demos' top-edge lights) */
  fixer(id: string): Fixer | null;
}

const learn: ModuleDef = {
  manifest: {
    name: 'learn',
    emits: [
      'learn:lesson_opened', 'learn:lesson_completed', 'learn:practice_solved', 'learn:refused', 'nav:go', 'nav:back',
      'learn:open', 'learn:step', 'learn:press', 'learn:new_practice', 'learn:set_assist',
    ],
    listens: ['learn:open', 'learn:step', 'learn:press', 'learn:new_practice', 'learn:set_assist'],
    owns: ['learn'],
    uses: ['view', 'solver', 'rng'],
    optional: ['storage', 'clock'],
    data: { rules: RulesSchema, copy: CopySchema },
  },
  init(ctx) {
    const rules = ctx.data.rules as LearnRules;
    const copy = ctx.data.copy as LearnCopy;
    const solver = ctx.need('solver');
    const rng = ctx.need('rng');
    const storage = ctx.service('storage');

    /** lessons opened from a "Go deeper" link, not shown in the list */
    const extras = rules.lessons.flatMap((id) => (LESSONS[id]?.deeper ? [LESSONS[id]!.deeper!] : []));
    const hasPractice = (id: string) => LESSONS[id]!.steps.some((s) => s.kind === 'practice');
    // every lesson needs its copy, one sentence per step, and a practice range if it has a practice step
    for (const id of [...rules.lessons, ...extras]) {
      const c = copy.lessons[id];
      if (!LESSONS[id]) throw new Error(`lessons.ts has no "${id}" lesson`);
      if (!c) throw new Error(`copy.json → learn.lessons has no "${id}" lesson`);
      if (c.steps.length !== LESSONS[id]!.steps.length) throw new Error(`copy.json → learn.lessons.${id}.steps needs ${LESSONS[id]!.steps.length} sentences, not ${c.steps.length}`);
      if (hasPractice(id) && !rules.practicePresses[id]) throw new Error(`rules.json → learn.practicePresses has no range for "${id}"`);
    }
    // every guide ends in practice: its range comes from rules.json, else the shaped rooms' default (GUIDE_PRESSES)
    const guideIds = Object.keys(copy.guides).map(guideId);
    const pressesFor = (id: string) => rules.practicePresses[id] ?? GUIDE_PRESSES;

    const read = (): LearnState => ctx.read('learn')!;
    const write = (next: LearnState) => ctx.write('learn', next);

    let table: TableEntry[] = [];
    let quiet: number[][] = [];
    let error: string | undefined;
    try {
      table = bottomRowTable(solver);
      quiet = quietPatterns(solver);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      ctx.log.error(`Couldn't work out the lesson tables: ${error}`, err);
    }

    // ---------- board guides: built from the room's shape when first opened, cached per shape ----------
    const kinds = new Map<string, GuideKind | null>();
    /** rooms whose guide copy doesn't fit their board (logged once) */
    const misfit = new Set<string>();
    const built = new Map<string, ReturnType<typeof buildGuide> | null>();
    const fixers = new Map<string, Fixer | null>();
    const packById = (id: string): Pack | undefined => ctx.read('levels')?.packs?.find((p) => p.id === id);
    /** the room behind a guide id, if it has a guide: a room pack, its copy, and copy with one sentence per step */
    const guidePack = (id: string): Pack | undefined => {
      if (!id.startsWith(GUIDE_PREFIX)) return undefined;
      const pack = packById(id.slice(GUIDE_PREFIX.length));
      const c = pack && pack.kind !== 'classic' ? copy.guides[pack.id] : undefined;
      if (!pack || !c) return undefined;
      // a stuck or wired room's pack is a plain grid: its kind tells its guide apart
      const key = `${pack.kind}|${shapeKey(pack.shape)}`;
      if (!kinds.has(key)) {
        try {
          kinds.set(key, guideKind(solver, pack));
        } catch (err) {
          kinds.set(key, null);
          ctx.log.error(`Couldn't work out the guide for the ${pack.id} board`, err);
        }
      }
      const kind = kinds.get(key);
      if (!kind) return undefined;
      if (c.steps.length !== GUIDE_STEPS[kind]) {
        if (!misfit.has(pack.id)) ctx.log.error(`copy.json → learn.guides.${pack.id}.steps needs ${GUIDE_STEPS[kind]} sentences for this board, not ${c.steps.length}`);
        misfit.add(pack.id);
        return undefined;
      }
      return pack;
    };
    const guideOf = (id: string) => {
      const pack = guidePack(id);
      if (!pack) return undefined;
      const key = `${pack.id}|${pack.kind}|${shapeKey(pack.shape)}`;
      if (!built.has(key)) {
        try {
          built.set(key, buildGuide(solver, pack));
        } catch (err) {
          built.set(key, null);
          ctx.log.error(`Couldn't build the ${pack.id} guide`, err);
        }
      }
      return built.get(key) ?? undefined;
    };
    /** the start-cell fix for a board shape (the Patterns panel uses it on every room) */
    const fixerFor = (shape: Pack['shape']): Fixer | null => {
      const key = shapeKey(shape);
      if (!fixers.has(key)) {
        try {
          fixers.set(key, createFixer(solver, shape));
        } catch (err) {
          fixers.set(key, null);
          ctx.log.error(`Couldn't work out the top-edge fixes for board ${key}`, err);
        }
      }
      return fixers.get(key) ?? null;
    };

    const loadCompleted = (): string[] => {
      try {
        const saved = v.safeParse(SaveSchema, storage?.get(rules.saveKey));
        return saved.success ? saved.output.completed.filter((id) => rules.lessons.includes(id) || guideIds.includes(id)) : [];
      } catch (err) {
        ctx.log.warn('Saved lesson progress could not be read', err);
        return [];
      }
    };
    write({ status: error ? 'error' : 'ready', lessonId: null, step: 0, completed: loadCompleted(), practice: null, assist: false, ...(error ? { error } : {}) });

    const lessonOf = (id: string | null): Lesson | undefined => {
      if (!id) return undefined;
      if (rules.lessons.includes(id) || extras.includes(id)) return LESSONS[id];
      return guideOf(id)?.lesson;
    };
    const practiceStep = (id: string) => lessonOf(id)!.steps.findIndex((s) => s.kind === 'practice');
    let direct = false;

    const suggestFor = (s: Pick<LearnState, 'lessonId' | 'assist'>, cells: Cells): number | null => {
      const lesson = lessonOf(s.lessonId);
      const mode = lesson?.assist;
      if (!s.assist || !mode || isClear(cells)) return null;
      if (mode === 'fix') {
        const fixer = guideOf(s.lessonId!)?.fixer;
        return fixer && lesson.shape ? fixSuggest(fixer, cells, lesson.shape) : null;
      }
      if (mode === 'chase') return chaseSuggest(cells) ?? methodSuggest(solver, table, cells);
      if (mode === 'par') return (lesson.shape ? solver.solve(cells, lesson.shape) : solver.solve(cells))?.[0] ?? null;
      if (mode === 'spot') return lesson.shape ? spotOrder(solver, lesson.shape, cells)?.[0] ?? null : null;
      return methodSuggest(solver, table, cells);
    };

    const newPractice = (s: LearnState): LearnState => {
      const id = s.lessonId!;
      const lesson = lessonOf(id)!;
      const [min, max] = pressesFor(id);
      // never a stuck switch: its press does nothing
      const pool = lesson.pool ?? (lesson.shape ? cellIndexes(lesson.shape).filter((i) => isPressable(lesson.shape!, i)) : [...Array(CELL_COUNT).keys()]);
      // lesson 2: shapes that don't touch, so every lit light belongs to one whole shape
      const apart = lesson.apart ? (taps: readonly number[]) => taps.every((a, k) => taps.slice(k + 1).every((b) => !touches(lesson.shape ?? CLASSIC_SHAPE, a, b))) : undefined;
      const make = () => makeBoard(solver, (n) => rng.int(n), min + rng.int(max - min + 1), pool, lesson.shape, apart);
      let cells = make();
      // a full rectangle's guide teaches the bottom-row step: a few taps low on the board (a short first chase, which
      // clears exactly what they lit) plus one or two lone bottom lights, which are what that chase leaves.
      // Every board on these rooms is solvable (each lone bottom light has its top lights), so it stays winnable.
      if (lesson.leftover && lesson.shape) {
        const shape = lesson.shape;
        const withLeftover = () => {
          const bottom = [...Array(shape.cols).keys()].map((c) => (shape.rows - 1) * shape.cols + c);
          const extra = [bottom.splice(rng.int(bottom.length), 1)[0]!, ...(rng.int(2) ? [bottom[rng.int(bottom.length)]!] : [])];
          return make().map((on, i) => (extra.includes(i) ? !on : on));
        };
        const ok = (b: Cells) => !isClear(chaseShape(solver, b, shape).cells) && solver.isSolvable(b, shape);
        cells = withLeftover();
        for (let k = 0; k < 30 && !ok(cells); k++) cells = withLeftover();
      }
      return { ...s, practice: { cells, start: cells, moves: 0, suggest: suggestFor(s, cells), status: 'playing' } };
    };

    /** a state at this step: practice steps get a fresh board, other steps none */
    const atStep = (s: LearnState, step: number): LearnState => {
      const next: LearnState = { ...s, step, practice: null };
      return next.lessonId && lessonOf(next.lessonId)?.steps[step]?.kind === 'practice' ? newPractice(next) : next;
    };

    const complete = (id: string) => {
      const s = read();
      const order = [...rules.lessons, ...guideIds];
      if (s.completed.includes(id) || !order.includes(id)) return;
      const completed = order.filter((l) => l === id || s.completed.includes(l));
      write({ ...s, completed });
      try {
        if (storage && !storage.set(rules.saveKey, { completed })) ctx.log.warn('Lesson progress is only kept until the page closes');
      } catch (err) {
        ctx.log.warn('Lesson progress could not be saved', err);
      }
      ctx.emit('learn:lesson_completed', { lessonId: id });
    };

    const open = (lessonId: string | null) => {
      const nav = ctx.read('nav');
      direct = lessonId !== null && !!nav && nav.screen !== 'learn';
      write(atStep({ ...read(), lessonId }, 0));
      ctx.emit('learn:lesson_opened', { lessonId });
      ctx.emit('nav:go', { screen: 'learn' });
    };

    ctx.on('learn:open', (p) => {
      const id = p?.lessonId ?? null;
      if (id !== null && !lessonOf(id)) {
        ctx.log.warn('Refused to open a lesson that does not exist', { lessonId: id });
        return ctx.emit('learn:refused', { command: 'learn:open', reason: 'unknown_lesson' });
      }
      open(id);
    });

    ctx.on('learn:step', (p) => {
      const s = read();
      const lesson = lessonOf(s.lessonId);
      if (!lesson) return ctx.emit('learn:refused', { command: 'learn:step', reason: 'unknown_lesson' });
      const to = s.step + (p?.delta === -1 ? -1 : 1);
      if (to < 0) return;
      if (to >= lesson.steps.length) {
        complete(s.lessonId!);
        if (!direct) return open(null);
        // opened from a level or a board screen: Done goes back there
        direct = false;
        write(atStep({ ...read(), lessonId: null }, 0));
        ctx.emit('learn:lesson_opened', { lessonId: null });
        return ctx.emit('nav:back', {});
      }
      write(atStep(s, to));
    });

    ctx.on('learn:new_practice', () => {
      const s = read();
      if (!lessonOf(s.lessonId)) return ctx.emit('learn:refused', { command: 'learn:new_practice', reason: 'no_practice' });
      const step = practiceStep(s.lessonId!);
      if (step < 0) return ctx.emit('learn:refused', { command: 'learn:new_practice', reason: 'no_practice' });
      write(step === s.step ? newPractice(s) : atStep(s, step));
    });

    ctx.on('learn:press', (p) => {
      const s = read();
      const pr = s.practice;
      if (!pr || pr.status !== 'playing') return ctx.emit('learn:refused', { command: 'learn:press', reason: 'no_practice' });
      const shape = lessonOf(s.lessonId)?.shape;
      const index = p?.index;
      const real = shape ? isCell(shape, index) : Number.isInteger(index) && index >= 0 && index < CELL_COUNT;
      if (!real) {
        ctx.log.warn('Refused a practice press on a cell that does not exist', { index });
        return ctx.emit('learn:refused', { command: 'learn:press', reason: 'bad_index' });
      }
      // a stuck switch can't be pressed (the view shakes it, as the play board does); no tap is counted
      if (shape && isStuck(shape, index)) return ctx.emit('learn:refused', { command: 'learn:press', reason: 'stuck' });
      const cells = shape ? solver.press(pr.cells, index, shape) : solver.press(pr.cells, index);
      const solved = isClear(cells);
      const moves = pr.moves + 1;
      write({ ...s, practice: { ...pr, cells, moves, status: solved ? 'solved' : 'playing', suggest: solved ? null : suggestFor(s, cells) } });
      if (!solved) return;
      const par = (shape ? solver.solve(pr.start, shape) : solver.solve(pr.start))?.length ?? moves;
      ctx.emit('learn:practice_solved', { lessonId: s.lessonId, moves, par });
      if (s.step === lessonOf(s.lessonId)!.steps.length - 1) complete(s.lessonId!);
    });

    ctx.on('learn:set_assist', (p) => {
      const s = read();
      const assist = !!p?.on;
      const practice = s.practice && { ...s.practice, suggest: s.practice.status === 'playing' ? suggestFor({ ...s, assist }, s.practice.cells) : null };
      write({ ...s, assist, practice });
    });

    const drillStore = {
      load: (): DrillSave => {
        try {
          const saved = v.safeParse(DrillSaveSchema, storage?.get(rules.drill.saveKey));
          return saved.success ? saved.output : emptySave();
        } catch (err) {
          ctx.log.warn('Saved drill progress could not be read', err);
          return emptySave();
        }
      },
      save: (save: DrillSave) => {
        try {
          if (storage && !storage.set(rules.drill.saveKey, save)) ctx.log.info('Drill progress is only kept until the page closes');
        } catch (err) {
          ctx.log.warn('Drill progress could not be saved', err);
        }
      },
    };
    const catalog: Catalog = {
      lesson: lessonOf,
      text(id) {
        const pack = guidePack(id);
        if (pack) return { title: pack.name, ...copy.guides[pack.id]! };
        return copy.lessons[id];
      },
      guides: () => (ctx.read('levels')?.packs ?? []).flatMap((p) => (guidePack(guideId(p.id)) ? [{ id: guideId(p.id), pack: p }] : [])),
      direct: () => direct,
      fixer: (id) => guideOf(id)?.fixer ?? null,
    };
    const view = createLearnView({ ctx, rules, copy, solver, rng, drillStore, catalog, table: () => table, quiet: () => quiet });
    const letters = (cols: readonly number[]) => cols.map((c) => copy.letters[c]).join(copy.echoJoin);
    const reference = createReference(ctx, solver, table, copy.reference, { echo: letters, letters: copy.letters }, {
      fixer: fixerFor,
      guideFor: (pack) => (guidePack(guideId(pack)) ? guideId(pack) : null),
    });

    const showTable = () => {
      const row = (cols: number[]) => [0, 1, 2, 3, 4].map((c) => (cols.includes(c) ? '●' : '○')).join('');
      return [`bottom row → tap in top row (${table.length} patterns)`, ...table.map((e) => `${row(e.bottom)} → ${row(e.top)}`)].join('\n');
    };

    return {
      stop: () => { view.stop(); reference.stop(); },
      debug: () => ({ table: showTable(), quiet, demo: view.debug(), guides: catalog.guides().map((g) => g.id) }),
      commands: {
        /** open [lessonId]: show the lesson list, or a lesson (board guides: guide-<room id>) */
        open(args) {
          const id = args[0];
          if (id && !lessonOf(id)) return `unknown lesson "${id}". Lessons: ${[...rules.lessons, ...catalog.guides().map((g) => g.id)].join(', ')}`;
          ctx.emit('learn:open', id ? { lessonId: id } : {});
          return id ? `opened ${id}` : 'opened the lesson list';
        },
        /** table: the bottom-row table worked out from the solver */
        table: () => showTable(),
      },
    };
  },
};
export default learn;
