// learn: the Learn screen. Five lessons that teach the patterns that solve any board, each a few
// short steps (illustration, animated demo, table, practice). Owns the `learn` slice.
import * as v from 'valibot';
import { CELL_COUNT, type Cells, type LearnState, type ModuleDef } from '../../contracts';
import { LESSONS } from './lessons';
import { bottomRowTable, chaseSuggest, isClear, makeBoard, methodSuggest, quietPatterns, type TableEntry } from './method';
import { ruleFor } from './lessons';
import { emptySave, type DrillSave } from './drill';
import { createReference } from './reference';
import { createLearnView } from './view';
import './learn.css';

const int = v.pipe(v.number(), v.integer());
const RulesSchema = v.object({
  lessons: v.pipe(v.array(v.picklist(Object.keys(LESSONS) as [string, ...string[]])), v.minLength(1)),
  practicePresses: v.record(v.string(), v.pipe(v.tuple([v.pipe(int, v.minValue(1)), v.pipe(int, v.maxValue(CELL_COUNT))]), v.check(([a, b]) => a <= b, 'min must not exceed max'))),
  demoStartMs: v.pipe(int, v.minValue(0)),
  demoStepMs: v.pipe(int, v.minValue(50)),
  saveKey: v.pipe(v.string(), v.minLength(1)),
  drill: v.object({
    cards: v.pipe(int, v.minValue(1)),
    boxes: v.pipe(int, v.minValue(2)),
    missGap: v.pipe(int, v.minValue(1)),
    saveKey: v.pipe(v.string(), v.minLength(1)),
  }),
});
export type LearnRules = v.InferOutput<typeof RulesSchema>;

const text = v.pipe(v.string(), v.minLength(1));
const CopySchema = v.looseObject({
  title: text, subtitle: text, intro: text, back: text, backToLessons: text, stepOf: text, prev: text, next: text, finish: text,
  done: text, assist: text, newBoard: text, another: text, practiceGoal: text, assistLine: text, moves: text, movesPar: text,
  solved: text, solvedPar: text, solvedAtPar: text, demoPlay: text, demoReplay: text, demoStep: text, demoTap: text, demoDone: text,
  demoPhase: v.object({ chase: text, top: text, chase2: text }),
  captions: v.record(v.string(), text), cellOn: text, cellOff: text,
  letters: v.pipe(v.string(), v.length(5)), echoJoin: text, deeper: text,
  echo: v.object({ pick: text, caption: text }),
  stack: v.object({ of: text, both: text, cancel: text }),
  derive: v.object({ rule: text, row: text, echo: text, tip: text }),
  rules: v.object({ three: text, allButMiddle: text, pairLoner: text, corners: text, gap: text, mirror: text }),
  drill: v.object({ intro: text, start: text, again: text, prompt: text, check: text, next: text, card: text, right: text, wrong: text, score: text, scoreLine: text }),
  reference: v.object({
    yourRow: text, bottom: text, top: text, echo: text, lessons: text, shaped: text,
    status: v.object({ start: text, chase: text, match: text, progress: text, clear: text, nomatch: text, rectBottom: text }),
  }),
  lessons: v.record(v.string(), v.object({ title: text, summary: text, steps: v.array(text) })),
});
export type LearnCopy = v.InferOutput<typeof CopySchema>;

const SaveSchema = v.object({ completed: v.array(v.string()) });
const DrillSaveSchema = v.object({ boxes: v.record(v.string(), v.number()), rounds: v.number() });

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
    const extras = rules.lessons.flatMap((id) => (LESSONS[id]!.deeper ? [LESSONS[id]!.deeper!] : []));
    const hasPractice = (id: string) => LESSONS[id]!.steps.some((s) => s.kind === 'practice');
    // every lesson needs its copy, one sentence per step, and a practice range if it has a practice step
    for (const id of [...rules.lessons, ...extras]) {
      const c = copy.lessons[id];
      if (!LESSONS[id]) throw new Error(`lessons.ts has no "${id}" lesson`);
      if (!c) throw new Error(`copy.json → learn.lessons has no "${id}" lesson`);
      if (c.steps.length !== LESSONS[id]!.steps.length) throw new Error(`copy.json → learn.lessons.${id}.steps needs ${LESSONS[id]!.steps.length} sentences, not ${c.steps.length}`);
      if (hasPractice(id) && !rules.practicePresses[id]) throw new Error(`rules.json → learn.practicePresses has no range for "${id}"`);
    }

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

    const loadCompleted = (): string[] => {
      try {
        const saved = v.safeParse(SaveSchema, storage?.get(rules.saveKey));
        return saved.success ? saved.output.completed.filter((id) => rules.lessons.includes(id)) : [];
      } catch (err) {
        ctx.log.warn('Saved lesson progress could not be read', err);
        return [];
      }
    };
    write({ status: error ? 'error' : 'ready', lessonId: null, step: 0, completed: loadCompleted(), practice: null, assist: false, ...(error ? { error } : {}) });

    const lessonOf = (id: string | null) => (id && (rules.lessons.includes(id) || extras.includes(id)) ? LESSONS[id] : undefined);
    const practiceStep = (id: string) => LESSONS[id]!.steps.findIndex((s) => s.kind === 'practice');

    const suggestFor = (s: Pick<LearnState, 'lessonId' | 'assist'>, cells: Cells): number | null => {
      const mode = lessonOf(s.lessonId)?.assist;
      if (!s.assist || !mode || isClear(cells)) return null;
      if (mode === 'chase') return chaseSuggest(cells) ?? methodSuggest(solver, table, cells);
      return methodSuggest(solver, table, cells);
    };

    const newPractice = (s: LearnState): LearnState => {
      const id = s.lessonId!;
      const [min, max] = rules.practicePresses[id]!;
      const pool = LESSONS[id]!.pool ?? [...Array(CELL_COUNT).keys()];
      const cells = makeBoard(solver, (n) => rng.int(n), min + rng.int(max - min + 1), pool);
      return { ...s, practice: { cells, start: cells, moves: 0, suggest: suggestFor(s, cells), status: 'playing' } };
    };

    /** a state at this step: practice steps get a fresh board, other steps none */
    const atStep = (s: LearnState, step: number): LearnState => {
      const next: LearnState = { ...s, step, practice: null };
      return next.lessonId && LESSONS[next.lessonId]!.steps[step]?.kind === 'practice' ? newPractice(next) : next;
    };

    const complete = (id: string) => {
      const s = read();
      if (s.completed.includes(id) || !rules.lessons.includes(id)) return;
      const completed = rules.lessons.filter((l) => l === id || s.completed.includes(l));
      write({ ...s, completed });
      try {
        if (storage && !storage.set(rules.saveKey, { completed })) ctx.log.warn('Lesson progress is only kept until the page closes');
      } catch (err) {
        ctx.log.warn('Lesson progress could not be saved', err);
      }
      ctx.emit('learn:lesson_completed', { lessonId: id });
    };

    const open = (lessonId: string | null) => {
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
        return open(null);
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
      const index = p?.index;
      if (!Number.isInteger(index) || index < 0 || index >= CELL_COUNT) {
        ctx.log.warn('Refused a practice press on a cell that does not exist', { index });
        return ctx.emit('learn:refused', { command: 'learn:press', reason: 'bad_index' });
      }
      const cells = solver.press(pr.cells, index);
      const solved = isClear(cells);
      const moves = pr.moves + 1;
      write({ ...s, practice: { ...pr, cells, moves, status: solved ? 'solved' : 'playing', suggest: solved ? null : suggestFor(s, cells) } });
      if (!solved) return;
      const par = solver.solve(pr.start)?.length ?? moves;
      ctx.emit('learn:practice_solved', { lessonId: s.lessonId, moves, par });
      if (s.step === LESSONS[s.lessonId!]!.steps.length - 1) complete(s.lessonId!);
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
    const view = createLearnView({ ctx, rules, copy, solver, rng, drillStore, table: () => table, quiet: () => quiet });
    const letters = (cols: readonly number[]) => cols.map((c) => copy.letters[c]).join(copy.echoJoin);
    const reference = createReference(ctx, solver, table, copy.reference, {
      echo: letters,
      rule: (bottom) => {
        const r = ruleFor(bottom);
        return r ? copy.rules[r.key as keyof LearnCopy['rules']] : '';
      },
    });

    const showTable = () => {
      const row = (cols: number[]) => [0, 1, 2, 3, 4].map((c) => (cols.includes(c) ? '●' : '○')).join('');
      return [`bottom row → tap in top row (${table.length} patterns)`, ...table.map((e) => `${row(e.bottom)} → ${row(e.top)}`)].join('\n');
    };

    return {
      stop: () => { view.stop(); reference.stop(); },
      debug: () => ({ table: showTable(), quiet, demo: view.debug() }),
      commands: {
        /** open [lessonId]: show the lesson list, or a lesson */
        open(args) {
          const id = args[0];
          if (id && !lessonOf(id)) return `unknown lesson "${id}". Lessons: ${rules.lessons.join(', ')}`;
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
