// The Learn screen view: lesson list, lesson steps, mini boards, the demo player.
// Demo progress is presentation (timers), so it lives here, not in the store.
import { CLASSIC_SHAPE, SIZE, type Cells, type Ctx, type LearnState, type Rng, type Shape, type SolverService } from '../../contracts';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import { emptyCells, gridSize, isCell, shapeKey } from '../../lib/shape';
import { roomGlyph } from '../../lib/glyph';
import type { Catalog, LearnCopy, LearnRules } from './index';
import type { MiniSpec, Phase, Step } from './lessons';
import { BOTTOM, blank, bottomColumns, chase, chaseShape, lit, litIndexes, lookup, methodTaps, onlyBottom, pressAll, type TableEntry } from './method';
import { createDrill, deriveView, names, picker, rulesView, stackView, strip, tableList, type DrillStore } from './echo-steps';

interface Deps {
  ctx: Ctx;
  rules: LearnRules;
  copy: LearnCopy;
  solver: SolverService;
  rng: Rng;
  drillStore: DrillStore;
  catalog: Catalog;
  table: () => TableEntry[];
  quiet: () => number[][];
}

/** shape absent = the classic board */
interface Demo { start: Cells; taps: number[]; phases: (Phase | null)[]; pos: number; cells: Cells; cancel: (() => void) | null; shape?: Shape }

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
  const { ctx, copy, rules, solver, catalog } = d;
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

  /**
   * marks: on a practice board the tap pointer (data-suggest); on illustrations a quiet, non-interactive mark.
   * shape absent = classic 5×5; a room's gaps keep their grid slot and are drawn empty (never cells or buttons).
   */
  function miniBoard(cells: readonly boolean[], kind: 'practice' | 'show' | 'demo' | 'glyph', marks: readonly number[] = [], shape?: Shape): HTMLElement {
    const s = shape ?? CLASSIC_SHAPE;
    const n = Math.max(s.cols, s.rows);
    const board = h('div', {
      class: `board board--mini board--${kind}`, 'data-mini-board': kind, 'data-cols': s.cols,
      ...(shape ? { 'data-mini-n': n, style: `--board-n:${n}` } : {}),
      ...(kind === 'practice' ? { role: 'grid' } : { 'aria-hidden': 'true' }),
    });
    const markAttr = kind === 'practice' ? 'data-suggest' : 'data-mark';
    for (let i = 0; i < gridSize(s); i++) {
      if (!isCell(s, i)) {
        board.append(h('span', { class: 'mini-gap', 'data-gap': '', 'aria-hidden': 'true' }));
        continue;
      }
      const attrs = {
        class: kind === 'glyph' ? 'mini-dot' : 'cell',
        'data-mini-cell': '', 'data-index': i, 'data-lit': String(!!cells[i]),
        [markAttr]: marks.includes(i) ? 'true' : null,
      };
      board.append(kind === 'practice' ? h('button', { ...attrs, type: 'button', tabindex: i === firstCell(s) ? 0 : -1 }) : h('span', attrs));
    }
    if (kind === 'practice') wirePractice(board, s);
    return board;
  }
  const firstCell = (s: Shape) => { for (let i = 0; i < gridSize(s); i++) if (isCell(s, i)) return i; return 0; };

  function patchBoard(board: HTMLElement, cells: readonly boolean[], suggest: readonly number[]) {
    const markAttr = board.dataset.miniBoard === 'practice' ? 'data-suggest' : 'data-mark';
    const cols = Number(board.dataset.cols) || 5;
    board.querySelectorAll<HTMLElement>('[data-mini-cell]').forEach((el) => {
      const i = Number(el.dataset.index);
      setAttr(el, 'data-lit', String(!!cells[i]));
      setAttr(el, markAttr, suggest.includes(i) ? 'true' : null);
      if (el.tagName === 'BUTTON') {
        const row = Math.floor(i / cols) + 1, col = (i % cols) + 1;
        setAttr(el, 'aria-label', fmt(cells[i] ? copy.cellOn : copy.cellOff, { row, col }));
      }
    });
  }

  /** press on pointerdown like the main board; a keyboard click (detail 0) presses too; arrows move focus (never into a gap) */
  function wirePractice(board: HTMLElement, s: Shape) {
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
      const move: Record<string, number> = { ArrowUp: -s.cols, ArrowDown: s.cols, ArrowLeft: -1, ArrowRight: 1 };
      const delta = move[(e as KeyboardEvent).key];
      if (i < 0 || delta === undefined) return;
      const to = i + delta;
      if (!isCell(s, to) || (Math.abs(delta) === 1 && Math.floor(to / s.cols) !== Math.floor(i / s.cols))) return;
      e.preventDefault();
      const cells = board.querySelectorAll<HTMLElement>('[data-mini-cell]');
      cells.forEach((c) => setAttr(c, 'tabindex', Number(c.dataset.index) === to ? '0' : '-1'));
      board.querySelector<HTMLElement>(`[data-mini-cell][data-index="${to}"]`)?.focus();
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
    const tile = (id: string, glyph: HTMLElement, num: number | null, title: string, summary: string) => {
      const done = s.completed.includes(id);
      return h('li', {},
        h('button', { class: 'lesson-tile', type: 'button', 'data-lesson-tile': '', 'data-lesson': id, 'data-completed': String(done), onclick: () => ctx.emit('learn:open', { lessonId: id }) },
          glyph,
          h('span', { class: 'lesson-tile__body' },
            h('span', { class: 'lesson-tile__title' }, num === null ? null : h('span', { class: 'lesson-tile__num num' }, num), title),
            h('span', { class: 'lesson-tile__summary' }, summary)),
          h('span', { class: 'lesson-tile__done', 'aria-label': done ? copy.done : null }, done ? icon(CHECK) : null),
        ));
    };
    const section = (key: 'basics' | 'boards', items: HTMLElement[]) => h('section', { class: 'learn-section', 'data-learn-section': key },
      h('h2', { class: 'eyebrow learn-section__title' }, copy.sections[key]), h('ol', { class: 'learn-list' }, ...items));
    const basics = rules.lessons.map((id, k) => tile(id, miniBoard(TILE_GLYPH[id]?.(d) ?? blank(), 'glyph'), k + 1, copy.lessons[id]!.title, copy.lessons[id]!.summary));
    const progress = ctx.read('progress');
    // the room's own picture, lit as it is on the menu (the share of its levels solved)
    const boards = catalog.guides().map((g) => tile(g.id, roomGlyph(g.pack, progress?.packs?.[g.pack.id]?.solved ?? 0), null, g.pack.name, copy.guides[g.pack.id]!.summary));
    return [header, section('basics', basics), ...(boards.length ? [section('boards', boards)] : [])];
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

  function figure(spec: MiniSpec, shape?: Shape): HTMLElement {
    let cells = pressAll(solver, shape ? emptyCells(shape) : blank(), spec.from, shape);
    if (spec.chased) cells = shape ? chaseShape(solver, cells, shape).cells : chase(solver, cells).cells;
    const marks = marksFor(spec, cells);
    const fig = h('figure', { class: 'learn-fig' }, miniBoard(cells, 'show', marks, shape));
    if (spec.caption) fig.append(h('figcaption', { class: 'learn-caption' }, fmt(copy.captions[spec.caption] ?? '', { n: marks.length })));
    return fig;
  }

  /** one top-row tap on a dark board, then the chase down to its echo */
  function echoPlan(col: number): Demo {
    const start = blank();
    const rest = chase(solver, solver.press(start, col)).taps;
    return { start, taps: [col, ...rest], phases: [null, ...rest.map(() => 'chase' as const)], pos: 0, cells: start, cancel: null };
  }

  function demoPlan(step: Extract<Step, { kind: 'demo' }>, shape?: Shape): Demo {
    const dark = shape ? emptyCells(shape) : blank();
    const start = step.lit ? dark.map((_, i) => step.lit!.includes(i))
      : step.bottom ? lit(step.bottom.map((c) => BOTTOM + c))
      : pressAll(solver, dark, step.from, shape);
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
      phases = step.phases ?? taps.map(() => null);
    }
    return { start, taps, phases, pos: 0, cells: start, cancel: null, shape };
  }

  /** a full rectangle's lone bottom light: tap its top lights, then chase again */
  function lightPlan(row: { bottom: number; top: number[] }, shape: Shape): Demo {
    const start = emptyCells(shape).map((_, i) => i === row.bottom);
    const again = chaseShape(solver, pressAll(solver, start, row.top, shape), shape).taps;
    return { start, taps: [...row.top, ...again], phases: [...row.top.map(() => 'top' as const), ...again.map(() => 'chase2' as const)], pos: 0, cells: start, cancel: null, shape };
  }

  function paintDemo() {
    if (!demo || !demoEls) return;
    const next = demo.taps[demo.pos];
    patchBoard(demoEls.board, demo.cells, next === undefined ? [] : [next]);
    const doneAll = demo.pos >= demo.taps.length;
    const phase = demo.phases[Math.min(demo.pos, demo.taps.length - 1)];
    const tap = fmt(copy.demoTap, { n: Math.min(demo.pos + 1, demo.taps.length), total: demo.taps.length });
    const done = demoEls.echo !== null ? fmt(copy.echo.caption, { name: copy.letters[demoEls.echo]! }) : copy.demoDone;
    setText(demoEls.line, doneAll ? done : phase ? `${copy.demoPhase[phase]} · ${tap}` : tap);
    setAttr(demoEls.line, 'data-tone', 'coach');
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
    demo.cells = pressAll(solver, demo.cells, [demo.taps[demo.pos]!], demo.shape);
    demo.pos++;
    paintDemo();
    if (demo.pos < demo.taps.length && clock) demo.cancel = clock.setTimeout(demoTick, delayBefore(demo.pos));
  }

  /** a top-row (or top-edge) tap and a spotted shape are held a little longer, so the eye finds them before they happen */
  const HOLD: (Phase | null | undefined)[] = ['top', 'edge', 'spot'];
  const delayBefore = (pos: number) => (HOLD.includes(demo?.phases[pos]) ? rules.demoHoldMs : rules.demoStepMs);

  function restartDemo() {
    if (!demo) return;
    stopDemo();
    demo.pos = 0;
    demo.cells = demo.start;
    paintDemo();
    if (!view.reducedMotion() && clock && visible() && demo.taps.length) demo.cancel = clock.setTimeout(demoTick, Math.max(rules.demoStartMs, delayBefore(0)));
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
    const lesson = catalog.lesson(id)!;
    const c = catalog.text(id)!;
    const shape = lesson.shape;
    const step = lesson.steps[s.step]!;
    const last = s.step === lesson.steps.length - 1;
    // opened from a level or a board screen: Back goes straight back there
    const direct = catalog.direct();

    const header = h('header', { class: 'screen-header learn-head' },
      h('button', {
        class: 'btn btn--icon', type: 'button', 'data-action': 'learn-back', 'aria-label': direct ? copy.back : copy.backToLessons,
        onclick: () => (catalog.direct() ? ctx.emit('nav:back', {}) : ctx.emit('learn:open', {})),
      }, icon(CHEVRON_LEFT)),
      h('div', { class: 'screen-header__title' },
        h('span', { class: 'eyebrow' }, fmt(copy.stepOf, { step: s.step + 1, total: lesson.steps.length })),
        h('strong', {}, c.title)),
      h('div', { class: 'screen-header__end' }),
    );
    const dots = h('div', { class: 'learn-dots', 'aria-hidden': 'true' }, ...lesson.steps.map((_, k) => h('i', { 'data-state': k < s.step ? 'done' : k === s.step ? 'now' : 'todo' })));
    const text = h('p', { class: 'learn-text' }, c.steps[s.step] ?? '');
    const stage = h('div', { class: `learn-stage learn-stage--${step.kind}`, 'data-shape': shape ? shapeKey(shape) : null });
    const under = h('div', { class: 'learn-under' });

    practiceEls = null;
    demoEls = null;
    stopDemo();
    demo = null;

    if (step.kind === 'show') {
      const figs = h('div', { class: 'learn-figs', style: `--n:${step.boards.length}` }, ...step.boards.map((b) => figure(b, shape)));
      stage.append(figs);
    } else if (step.kind === 'demo') {
      demo = demoPlan(step, shape);
      const board = miniBoard(demo.start, 'demo', [], shape);
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
      // the A–E buttons sit over the board's columns
      stage.append(h('div', { class: 'learn-echo' }, picker(copy, col, (c) => { if (!demoEls) return; demoEls.echo = c; demo = echoPlan(c); restartDemo(); }), board));
      under.append(line, h('div', { class: 'learn-controls' }, button));
      demoEls = { board, line, button, echo: col };
    } else if (step.kind === 'lights' && shape) {
      // each lone bottom light → the top lights that clear it; tapping a row plays it on the board below
      const cols = shape.cols;
      demo = lightPlan(step.rows[step.pick]!, shape);
      const board = miniBoard(demo.start, 'demo', [], shape);
      const line = h('p', { class: 'tutorial-line', 'data-learn-line': 'demo', 'aria-live': 'polite' });
      const button = h('button', { class: 'btn btn--ghost learn-small', type: 'button', 'data-action': 'learn-demo', onclick: onDemoButton }, copy.demoPlay);
      const rowsEl = step.rows.map((r, c) => h('button', {
        class: 'learn-lights__row', type: 'button', 'data-action': 'learn-strip', 'data-col': c, 'aria-pressed': String(c === step.pick),
        'aria-label': fmt(copy.lights.row, { name: copy.letters[c]!, taps: names(copy, r.top) }),
        onclick: () => {
          rowsEl.forEach((el, k) => setAttr(el, 'aria-pressed', String(k === c)));
          demo = lightPlan(r, shape);
          restartDemo();
          board.scrollIntoView?.({ block: 'nearest', behavior: view.reducedMotion() ? 'auto' : 'smooth' });
        },
      }, strip({ lit: [c], n: cols, bottom: r.bottom - c }), h('span', { class: 'learn-table__arrow', 'aria-hidden': 'true' }, '→'), strip({ ring: r.top, row: 'top', kind: 'top', letters: copy.letters, n: cols })));
      stage.append(h('div', { class: 'learn-lights', style: `--strip-n:${cols}` },
        h('div', { class: 'learn-lights__list', role: 'group', 'aria-label': copy.lights.pick }, ...rowsEl), board));
      under.append(line, h('div', { class: 'learn-controls' }, button));
      demoEls = { board, line, button, echo: null };
    } else if (step.kind === 'table') {
      stage.append(tableList(copy, d.table()));
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
      const board = miniBoard(p?.cells ?? (shape ? emptyCells(shape) : blank()), 'practice', [], shape);
      const line = h('p', { class: 'tutorial-line', 'data-learn-line': 'practice', 'aria-live': 'polite' });
      const moves = h('span', { class: 'learn-moves num', 'data-learn-moves': '' });
      const assist = lesson.assist
        ? h('button', { class: 'btn btn--ghost learn-small', type: 'button', 'data-action': 'learn-assist', 'aria-pressed': String(s.assist), onclick: () => ctx.emit('learn:set_assist', { on: !state().assist }) }, copy.assist)
        : null;
      const another = h('button', { class: 'btn btn--ghost learn-small', type: 'button', 'data-action': 'learn-practice', onclick: () => ctx.emit('learn:new_practice', {}) }, copy.newBoard);
      stage.append(board);
      under.append(line, h('div', { class: 'learn-controls' }, moves, assist, another));
      if (lesson.echoHelp) under.append(h('p', { class: 'learn-caption' }, copy.echoTip));
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

  function parOf(start: Cells, shape?: Shape): number {
    const key = `${shape ? shapeKey(shape) : ''}|${start.map((b) => (b ? 1 : 0)).join('')}`;
    let par = parCache.get(key);
    if (par === undefined) { par = (shape ? solver.solve(start, shape) : solver.solve(start))?.length ?? 0; parCache.set(key, par); }
    return par;
  }

  function patchPractice(s: LearnState) {
    const p = s.practice;
    if (!practiceEls || !p) return;
    const lesson = catalog.lesson(s.lessonId);
    const showPar = !!lesson?.showPar;
    const par = parOf(p.start, lesson?.shape);
    patchBoard(practiceEls.board, p.cells, p.suggest === null ? [] : [p.suggest]);
    setAttr(practiceEls.board, 'data-status', p.status);
    setText(practiceEls.moves, fmt(showPar ? copy.movesPar : copy.moves, { moves: p.moves, par }));
    // once only the bottom row is left (lesson 4), name its echo: "That's B's echo: tap B, then chase again."
    const echo = lesson?.echoHelp && p.status === 'playing' && onlyBottom(p.cells) ? lookup(d.table(), bottomColumns(p.cells)) : undefined;
    let line = '';
    const tone = 'coach'; // teal is the paid Hint's colour only
    if (p.status === 'solved') line = fmt(showPar ? (p.moves <= par ? copy.solvedAtPar : copy.solvedPar) : copy.solved, { moves: p.moves, par });
    else if (echo) line = fmt(copy.echoMatch, { name: names(copy, echo.top) });
    else if (p.suggest !== null) line = copy.assistLine;
    setText(practiceEls.line, line);
    setAttr(practiceEls.line, 'data-tone', tone);
    setText(practiceEls.another, p.status === 'solved' ? copy.another : copy.newBoard);
    if (practiceEls.assist) setAttr(practiceEls.assist, 'aria-pressed', String(s.assist));
  }

  /** the guide tiles depend on the rooms (levels) and how far the player got in each (progress) */
  const listKey = () => {
    const packs = ctx.read('progress')?.packs ?? {};
    return catalog.guides().map((g) => `${g.id}:${packs[g.pack.id]?.solved ?? 0}`).join(',');
  };

  function render() {
    const s = ctx.read('learn');
    if (!s) return;
    const key = s.lessonId === null ? `list|${s.completed.join(',')}|${listKey()}` : `${s.lessonId}|${s.step}|${s.practice ? 'p' : '-'}`;
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
  ctx.watch('levels', render);
  ctx.watch('progress', render);
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
