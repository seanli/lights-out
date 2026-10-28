// The Learn screen view: lesson list, lesson steps, mini boards, the demo player.
// Demo progress is presentation (timers), so it lives here, not in the store.
import { CELL_COUNT, SIZE, type Cells, type Ctx, type LearnState, type Rng, type SolverService } from '../../contracts';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import type { LearnCopy, LearnRules } from './index';
import { LESSONS, type MiniSpec, type Step } from './lessons';
import { blank, bottomColumns, chase, echoOf, lit, litIndexes, lookup, methodTaps, pressAll, type TableEntry } from './method';
import { createDrill, deriveView, picker, rowText, rulesView, stackView, type DrillStore } from './echo-steps';

interface Deps {
  ctx: Ctx;
  rules: LearnRules;
  copy: LearnCopy;
  solver: SolverService;
  rng: Rng;
  drillStore: DrillStore;
  table: () => TableEntry[];
  quiet: () => number[][];
}

type Phase = 'chase' | 'top' | 'chase2';
interface Demo { start: Cells; taps: number[]; phases: (Phase | null)[]; pos: number; cells: Cells; cancel: (() => void) | null }

const SVG = 'http://www.w3.org/2000/svg';
function icon(d: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute('d', d);
  svg.append(path);
  return svg;
}
const CHEVRON_LEFT = 'M15 18l-6-6 6-6';
const CHECK = 'M5 12.5l4.5 4.5L19 7.5';

/** the picture on each lesson tile, as taps from dark */
const TILE_GLYPH: Record<string, (d: Deps) => Cells> = {
  shapes: () => lit([7, 11, 12, 13, 17]),
  order: (d) => pressAll(d.solver, blank(), [6, 18]),
  chase: (d) => pressAll(d.solver, blank(), [6, 8, 12, 17]),
  'bottom-row': (d) => chase(d.solver, pressAll(d.solver, blank(), [1, 8, 12, 16, 24])).cells,
  shortest: (d) => lit(d.quiet()[1] ?? []),
};

export function createLearnView(d: Deps) {
  const { ctx, copy, rules, solver } = d;
  const root = ctx.need('view').region('screen:learn');
  root.classList.add('learn-screen');
  const view = ctx.need('view');
  const clock = ctx.service('clock');

  let builtKey = '';
  let demo: Demo | null = null;
  /** the practice board and its line, kept to patch on every tap */
  let practiceEls: { board: HTMLElement; line: HTMLElement; moves: HTMLElement; another: HTMLButtonElement; assist: HTMLButtonElement | null } | null = null;
  let demoEls: { board: HTMLElement; line: HTMLElement; button: HTMLButtonElement; echo: number | null } | null = null;
  const parCache = new Map<string, number>();

  const state = (): LearnState => ctx.read('learn')!;
  const visible = () => { const nav = ctx.read('nav'); return !nav || nav.screen === 'learn'; };

  // ---------- mini boards ----------

  function miniBoard(cells: readonly boolean[], kind: 'practice' | 'show' | 'demo' | 'glyph', marks: readonly number[] = []): HTMLElement {
    const board = h('div', { class: `board board--mini board--${kind}`, 'data-mini-board': kind, ...(kind === 'practice' ? { role: 'grid' } : { 'aria-hidden': 'true' }) });
    for (let i = 0; i < CELL_COUNT; i++) {
      const attrs = {
        class: kind === 'glyph' ? 'mini-dot' : 'cell',
        'data-mini-cell': '', 'data-index': i, 'data-lit': String(!!cells[i]),
        'data-suggest': marks.includes(i) ? 'true' : null,
      };
      board.append(kind === 'practice' ? h('button', { ...attrs, type: 'button', tabindex: i === 0 ? 0 : -1 }) : h('span', attrs));
    }
    if (kind === 'practice') wirePractice(board);
    return board;
  }

  function patchBoard(board: HTMLElement, cells: readonly boolean[], suggest: readonly number[]) {
    board.querySelectorAll<HTMLElement>('[data-mini-cell]').forEach((el, i) => {
      setAttr(el, 'data-lit', String(!!cells[i]));
      setAttr(el, 'data-suggest', suggest.includes(i) ? 'true' : null);
      if (el.tagName === 'BUTTON') {
        const row = Math.floor(i / SIZE) + 1, col = (i % SIZE) + 1;
        setAttr(el, 'aria-label', fmt(cells[i] ? copy.cellOn : copy.cellOff, { row, col }));
      }
    });
  }

  /** press on pointerdown like the main board; a keyboard click (detail 0) presses too; arrows move focus */
  function wirePractice(board: HTMLElement) {
    let pointerPressed = -1;
    const indexOf = (e: Event) => {
      const cell = (e.target as Element | null)?.closest?.('[data-mini-cell]') as HTMLElement | null;
      return cell ? Number(cell.dataset.index) : -1;
    };
    board.addEventListener('pointerdown', (e) => {
      if ((e as PointerEvent).button > 0) return;
      const i = indexOf(e);
      if (i < 0) return;
      pointerPressed = i;
      ctx.emit('learn:press', { index: i });
    });
    board.addEventListener('click', (e) => {
      const i = indexOf(e);
      if (i < 0) return;
      if (pointerPressed === i && (e as MouseEvent).detail !== 0) { pointerPressed = -1; return; }
      pointerPressed = -1;
      ctx.emit('learn:press', { index: i });
    });
    board.addEventListener('keydown', (e) => {
      const i = indexOf(e);
      const move: Record<string, number> = { ArrowUp: -SIZE, ArrowDown: SIZE, ArrowLeft: -1, ArrowRight: 1 };
      const delta = move[(e as KeyboardEvent).key];
      if (i < 0 || delta === undefined) return;
      const to = i + delta;
      if (to < 0 || to >= CELL_COUNT || (Math.abs(delta) === 1 && Math.floor(to / SIZE) !== Math.floor(i / SIZE))) return;
      e.preventDefault();
      const cells = board.querySelectorAll<HTMLElement>('[data-mini-cell]');
      cells.forEach((c, k) => setAttr(c, 'tabindex', k === to ? '0' : '-1'));
      cells[to]?.focus();
    });
  }

  // ---------- the list ----------

  function buildList(s: LearnState): HTMLElement[] {
    root.classList.add('screen--scroll');
    const header = h('header', { class: 'screen-header' },
      h('button', { class: 'btn btn--icon', type: 'button', 'data-action': 'learn-back', 'aria-label': copy.back, onclick: () => ctx.emit('nav:back', {}) }, icon(CHEVRON_LEFT)),
      h('div', { class: 'screen-header__title' }, h('span', { class: 'eyebrow' }, copy.subtitle), h('strong', {}, copy.title)),
      h('div', { class: 'screen-header__end' }),
    );
    const intro = h('p', { class: 'muted learn-intro' }, copy.intro);
    const list = h('ol', { class: 'learn-list' });
    rules.lessons.forEach((id, k) => {
      const c = copy.lessons[id]!;
      const done = s.completed.includes(id);
      const glyph = miniBoard(TILE_GLYPH[id]?.(d) ?? blank(), 'glyph');
      list.append(h('li', {},
        h('button', { class: 'lesson-tile', type: 'button', 'data-lesson-tile': '', 'data-lesson': id, 'data-completed': String(done), onclick: () => ctx.emit('learn:open', { lessonId: id }) },
          glyph,
          h('span', { class: 'lesson-tile__body' },
            h('span', { class: 'lesson-tile__title' }, h('span', { class: 'lesson-tile__num num' }, k + 1), c.title),
            h('span', { class: 'lesson-tile__summary' }, c.summary)),
          h('span', { class: 'lesson-tile__done', 'aria-label': done ? copy.done : null }, done ? icon(CHECK) : null),
        )));
    });
    return [header, intro, list];
  }

  // ---------- a lesson ----------

  function marksFor(spec: MiniSpec, cells: Cells): number[] {
    if (spec.quiet !== undefined) return d.quiet()[spec.quiet] ?? [];
    switch (spec.marks) {
      case 'taps': return spec.from;
      case 'chase-first-row': return litIndexes(cells).filter((i) => i < SIZE).map((i) => i + SIZE);
      case 'method': return methodTaps(solver, d.table(), cells) ?? [];
      case 'shortest': return solver.solve(cells) ?? [];
      default: return Array.isArray(spec.marks) ? spec.marks : [];
    }
  }

  function figure(spec: MiniSpec): HTMLElement {
    let cells = pressAll(solver, blank(), spec.from);
    if (spec.chased) cells = chase(solver, cells).cells;
    const marks = marksFor(spec, cells);
    const fig = h('figure', { class: 'learn-fig' }, miniBoard(cells, 'show', marks));
    if (spec.caption) fig.append(h('figcaption', { class: 'learn-caption' }, fmt(copy.captions[spec.caption] ?? '', { n: marks.length })));
    return fig;
  }

  /** one top-row tap on a dark board, then the chase down to its echo */
  function echoPlan(col: number): Demo {
    const start = blank();
    const rest = chase(solver, solver.press(start, col)).taps;
    return { start, taps: [col, ...rest], phases: [null, ...rest.map(() => 'chase' as const)], pos: 0, cells: start, cancel: null };
  }

  function demoPlan(step: Extract<Step, { kind: 'demo' }>): Demo {
    const start = pressAll(solver, blank(), step.from);
    let taps: number[];
    let phases: (Phase | null)[];
    if (step.play === 'chase') {
      taps = chase(solver, start).taps;
      phases = taps.map(() => 'chase');
    } else if (step.play === 'method') {
      const c1 = chase(solver, start);
      const top = lookup(d.table(), bottomColumns(c1.cells))?.top ?? [];
      const c2 = chase(solver, pressAll(solver, c1.cells, top));
      taps = [...c1.taps, ...top, ...c2.taps];
      phases = [...c1.taps.map(() => 'chase' as const), ...top.map(() => 'top' as const), ...c2.taps.map(() => 'chase2' as const)];
    } else {
      taps = step.play;
      phases = taps.map(() => null);
    }
    return { start, taps, phases, pos: 0, cells: start, cancel: null };
  }

  function paintDemo() {
    if (!demo || !demoEls) return;
    const next = demo.taps[demo.pos];
    patchBoard(demoEls.board, demo.cells, next === undefined ? [] : [next]);
    const doneAll = demo.pos >= demo.taps.length;
    const phase = demo.phases[Math.min(demo.pos, demo.taps.length - 1)];
    const tap = fmt(copy.demoTap, { n: Math.min(demo.pos + 1, demo.taps.length), total: demo.taps.length });
    const done = demoEls.echo !== null ? fmt(copy.echo.caption, { name: copy.letters[demoEls.echo]!, row: rowText(copy, bottomColumns(demo.cells)) }) : copy.demoDone;
    setText(demoEls.line, doneAll ? done : phase ? `${copy.demoPhase[phase]} · ${tap}` : tap);
    setAttr(demoEls.line, 'data-tone', doneAll ? 'coach' : 'hint');
    const auto = !view.reducedMotion();
    setText(demoEls.button, doneAll ? copy.demoReplay : auto ? copy.demoPlay : copy.demoStep);
    demoEls.button.hidden = auto && !doneAll;
  }

  function stopDemo() {
    demo?.cancel?.();
    if (demo) demo.cancel = null;
  }

  function demoTick() {
    if (!demo) return;
    demo.cancel = null;
    if (demo.pos >= demo.taps.length || !visible()) return paintDemo();
    demo.cells = solver.press(demo.cells, demo.taps[demo.pos]!);
    demo.pos++;
    paintDemo();
    if (demo.pos < demo.taps.length && clock) demo.cancel = clock.setTimeout(demoTick, rules.demoStepMs);
  }

  function restartDemo() {
    if (!demo) return;
    stopDemo();
    demo.pos = 0;
    demo.cells = demo.start;
    paintDemo();
    if (!view.reducedMotion() && clock && visible() && demo.taps.length) demo.cancel = clock.setTimeout(demoTick, rules.demoStartMs);
  }

  function onDemoButton() {
    if (!demo) return;
    if (demo.pos >= demo.taps.length) return restartDemo();
    stopDemo();
    demoTick();
  }

  function buildLesson(s: LearnState): HTMLElement[] {
    root.classList.remove('screen--scroll');
    const id = s.lessonId!;
    const lesson = LESSONS[id]!;
    const c = copy.lessons[id]!;
    const step = lesson.steps[s.step]!;
    const last = s.step === lesson.steps.length - 1;

    const header = h('header', { class: 'screen-header learn-head' },
      h('button', { class: 'btn btn--icon', type: 'button', 'data-action': 'learn-back', 'aria-label': copy.backToLessons, onclick: () => ctx.emit('learn:open', {}) }, icon(CHEVRON_LEFT)),
      h('div', { class: 'screen-header__title' },
        h('span', { class: 'eyebrow' }, fmt(copy.stepOf, { step: s.step + 1, total: lesson.steps.length })),
        h('strong', {}, c.title)),
      h('div', { class: 'screen-header__end' }),
    );
    const dots = h('div', { class: 'learn-dots', 'aria-hidden': 'true' }, ...lesson.steps.map((_, k) => h('i', { 'data-state': k < s.step ? 'done' : k === s.step ? 'now' : 'todo' })));
    const text = h('p', { class: 'learn-text' }, c.steps[s.step] ?? '');
    const stage = h('div', { class: `learn-stage learn-stage--${step.kind}` });
    const under = h('div', { class: 'learn-under' });

    practiceEls = null;
    demoEls = null;
    stopDemo();
    demo = null;

    if (step.kind === 'show') {
      const figs = h('div', { class: 'learn-figs', style: `--n:${step.boards.length}` }, ...step.boards.map(figure));
      stage.append(figs);
    } else if (step.kind === 'demo') {
      demo = demoPlan(step);
      const board = miniBoard(demo.start, 'demo');
      const line = h('p', { class: 'tutorial-line', 'data-learn-line': 'demo', 'aria-live': 'polite' });
      const button = h('button', { class: 'btn btn--ghost learn-small', type: 'button', 'data-action': 'learn-demo', onclick: onDemoButton }, copy.demoPlay);
      stage.append(board);
      under.append(line, h('div', { class: 'learn-controls' }, button));
      demoEls = { board, line, button, echo: null };
    } else if (step.kind === 'echo') {
      // pick a top-row light; the demo taps it and chases down to its echo
      const col = 1;
      demo = echoPlan(col);
      const board = miniBoard(demo.start, 'demo');
      const line = h('p', { class: 'tutorial-line', 'data-learn-line': 'demo', 'aria-live': 'polite' });
      const button = h('button', { class: 'btn btn--ghost learn-small', type: 'button', 'data-action': 'learn-demo', onclick: onDemoButton }, copy.demoPlay);
      stage.append(board);
      under.append(picker(copy, col, (c) => { if (!demoEls) return; demoEls.echo = c; demo = echoPlan(c); restartDemo(); }), line, h('div', { class: 'learn-controls' }, button));
      demoEls = { board, line, button, echo: col };
    } else if (step.kind === 'stack') {
      stage.append(stackView(copy, solver, step.pairs));
    } else if (step.kind === 'rules') {
      stage.append(rulesView(copy, d.table()));
    } else if (step.kind === 'derive') {
      stage.append(deriveView(copy));
    } else if (step.kind === 'drill') {
      const drill = createDrill({ copy, rules, solver, rng: d.rng, table: d.table(), store: d.drillStore });
      stage.append(drill.root);
      under.append(drill.line, drill.controls);
    } else {
      const p = s.practice;
      const board = miniBoard(p?.cells ?? blank(), 'practice');
      const line = h('p', { class: 'tutorial-line', 'data-learn-line': 'practice', 'aria-live': 'polite' });
      const moves = h('span', { class: 'learn-moves num', 'data-learn-moves': '' });
      const assist = lesson.assist
        ? h('button', { class: 'btn btn--hint learn-small', type: 'button', 'data-action': 'learn-assist', 'aria-pressed': String(s.assist), onclick: () => ctx.emit('learn:set_assist', { on: !state().assist }) }, copy.assist)
        : null;
      const another = h('button', { class: 'btn btn--ghost learn-small', type: 'button', 'data-action': 'learn-practice', onclick: () => ctx.emit('learn:new_practice', {}) }, copy.newBoard);
      stage.append(board);
      under.append(line, h('div', { class: 'learn-controls' }, moves, assist, another));
      practiceEls = { board, line, moves, another, assist };
    }

    const navRow = h('nav', { class: 'learn-nav' },
      h('button', { class: 'btn btn--ghost', type: 'button', 'data-action': 'learn-prev', disabled: s.step === 0, onclick: () => ctx.emit('learn:step', { delta: -1 }) }, copy.prev),
      h('button', { class: 'btn btn--primary', type: 'button', 'data-action': 'learn-next', onclick: () => ctx.emit('learn:step', { delta: 1 }) }, last ? copy.finish : copy.next),
    );
    if (last && lesson.deeper) {
      under.append(h('button', { class: 'btn btn--ghost learn-link', type: 'button', 'data-action': 'learn-deeper', onclick: () => ctx.emit('learn:open', { lessonId: lesson.deeper! }) }, copy.deeper));
    }
    const body = h('div', { class: 'learn-step', 'data-step': s.step, 'data-kind': step.kind }, dots, text, stage, under);
    const wrap = h('div', { class: 'learn-lesson', 'data-lesson-view': id, 'data-step': s.step }, header, body, navRow);
    return [wrap];
  }

  function parOf(start: Cells): number {
    const key = start.map((b) => (b ? 1 : 0)).join('');
    let par = parCache.get(key);
    if (par === undefined) { par = solver.solve(start)?.length ?? 0; parCache.set(key, par); }
    return par;
  }

  function patchPractice(s: LearnState) {
    const p = s.practice;
    if (!practiceEls || !p) return;
    const showPar = !!LESSONS[s.lessonId!]?.showPar;
    const par = parOf(p.start);
    patchBoard(practiceEls.board, p.cells, p.suggest === null ? [] : [p.suggest]);
    setAttr(practiceEls.board, 'data-status', p.status);
    setText(practiceEls.moves, fmt(showPar ? copy.movesPar : copy.moves, { moves: p.moves, par }));
    let line: string;
    let tone: string;
    if (p.status === 'solved') {
      line = fmt(showPar ? (p.moves <= par ? copy.solvedAtPar : copy.solvedPar) : copy.solved, { moves: p.moves, par });
      tone = 'coach';
    } else if (p.suggest !== null) {
      line = copy.assistLine;
      tone = 'hint';
    } else {
      line = copy.practiceGoal;
      tone = 'coach';
    }
    setText(practiceEls.line, line);
    setAttr(practiceEls.line, 'data-tone', tone);
    setText(practiceEls.another, p.status === 'solved' ? copy.another : copy.newBoard);
    practiceEls.another.className = `btn ${p.status === 'solved' ? 'btn--primary' : 'btn--ghost'} learn-small`;
    if (practiceEls.assist) setAttr(practiceEls.assist, 'aria-pressed', String(s.assist));
  }

  function render() {
    const s = ctx.read('learn');
    if (!s) return;
    const key = s.lessonId === null ? `list|${s.completed.join(',')}` : `${s.lessonId}|${s.step}|${s.practice ? 'p' : '-'}`;
    if (key !== builtKey) {
      builtKey = key;
      const hadFocus = root.contains(document.activeElement);
      root.replaceChildren(...(s.lessonId === null ? buildList(s) : buildLesson(s)));
      if (demo) restartDemo();
      if (hadFocus) root.querySelector<HTMLElement>('[data-action="learn-next"], [data-lesson-tile], button')?.focus({ preventScroll: true });
    }
    patchPractice(s);
  }

  ctx.watch('learn', render);
  ctx.watch('nav', (nav) => {
    if (nav?.screen === 'learn') { if (demo) restartDemo(); }
    else stopDemo();
  });
  render();

  return {
    stop: stopDemo,
    debug: () => (demo ? { demoAt: demo.pos, demoTaps: demo.taps.length } : null),
  };
}
