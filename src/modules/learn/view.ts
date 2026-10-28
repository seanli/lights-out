// The Learn screen view: lesson list, lesson steps, mini boards, the demo player.
// Demo progress is presentation (timers), so it lives here, not in the store.
import { CLASSIC_SHAPE, SIZE, type Cells, type Ctx, type LearnState, type Pack, type Rng, type Shape, type SolverService } from '../../contracts';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import { emptyCells, gridSize, isCell, shapeKey } from '../../lib/shape';
import { roomGlyph } from '../../lib/glyph';
import { attachAim, type AimHandle, type AimMode } from '../../lib/aim';
import type { Catalog, LearnCopy, LearnRules } from './index';
import type { DemoEnd, MiniSpec, Phase, Step } from './lessons';
import { BOTTOM, blank, bottomColumns, chase, chaseShape, coachPhase, lit, litIndexes, lookup, methodTaps, onlyBottom, pressAll, startCells, type TableEntry } from './method';
import { createDrill, deriveView, names, picker, rulesView, stackView, tableList, type DrillStore } from './echo-steps';

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

/** a board much taller than wide (the Tower): practice scrolls with the page instead of shrinking */
const isTall = (s: Shape) => s.rows >= 2 * s.cols;

/**
 * A demo playing on a mini board (shape absent = the classic board). `end`: the line when it stops with lights on;
 * `orders`: each Replay plays the next order of the same taps; `markAll`: dot every tap to come; `ring`: lights outlined
 * until tapped (the lights step's top lights); `paused`: a tap on the board stopped it, each further tap steps once.
 */
interface Demo {
  start: Cells; taps: number[]; phases: (Phase | null)[]; pos: number; cells: Cells; cancel: (() => void) | null; shape?: Shape;
  end?: DemoEnd; orders?: number[][]; round: number; markAll?: boolean; ring?: number[]; paused: boolean;
}

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
  let practiceEls: { board: HTMLElement; line: HTMLElement; moves: HTMLElement; another: HTMLButtonElement; assist: HTMLButtonElement | null; suggest: number | null; start: Cells | null } | null = null;
  /** the practice board's pointer helper (aim bubble / scroll-safe taps) and its size watcher, undone on every rebuild */
  let practiceInput: { aim: AimHandle; observer: ResizeObserver | null } | null = null;
  /** `edges`: the top-edge lights, outlined while a top-edge tap is next (shaped rooms) */
  let demoEls: { board: HTMLElement; line: HTMLElement; button: HTMLButtonElement; echo: number | null; edges: number[]; end?: string } | null = null;
  /** practice on small lights: the aim tip shows after a miss or a drag, until the next clean tap */
  let aimHelp = false;
  const parCache = new Map<string, number>();

  const state = (): LearnState => ctx.read('learn')!;
  const visible = () => { const nav = ctx.read('nav'); return !nav || nav.screen === 'learn'; };

  // ---------- mini boards ----------

  /**
   * marks: on a practice board the tap pointer (data-suggest); on illustrations a quiet, non-interactive mark.
   * shape absent = classic 5×5; a room's gaps keep their grid slot and are drawn empty (never cells or buttons).
   */
  function miniBoard(cells: readonly boolean[], kind: 'practice' | 'show' | 'demo', marks: readonly number[] = [], shape?: Shape): HTMLElement {
    const s = shape ?? CLASSIC_SHAPE;
    const n = Math.max(s.cols, s.rows);
    const board = h('div', {
      class: `board board--mini board--${kind}`, 'data-mini-board': kind, 'data-cols': s.cols,
      ...(shape ? { 'data-mini-n': n, 'data-tall': isTall(s) ? 'true' : null, style: `--board-n:${n};${ratio(s)}` } : {}),
      ...(kind === 'practice' ? { role: 'grid' } : { 'aria-hidden': 'true' }),
    });
    const markAttr = kind === 'practice' ? 'data-suggest' : 'data-mark';
    for (let i = 0; i < gridSize(s); i++) {
      if (!isCell(s, i)) {
        board.append(h('span', { class: 'mini-gap', 'data-gap': '', 'aria-hidden': 'true' }));
        continue;
      }
      const attrs = {
        class: 'cell',
        'data-mini-cell': '', 'data-index': i, 'data-lit': String(!!cells[i]),
        [markAttr]: marks.includes(i) ? 'true' : null,
      };
      board.append(kind === 'practice' ? h('button', { ...attrs, type: 'button', tabindex: i === firstCell(s) ? 0 : -1 }) : h('span', attrs));
    }
    if (kind === 'practice') wirePractice(board, s);
    return board;
  }
  const firstCell = (s: Shape) => { for (let i = 0; i < gridSize(s); i++) if (isCell(s, i)) return i; return 0; };
  /** columns and rows for the grid and its aspect ratio (CSS: --board-cols / --board-rows) */
  const ratio = (s: Shape) => `--board-cols:${s.cols};--board-rows:${s.rows}`;

  function patchBoard(board: HTMLElement, cells: readonly boolean[], suggest: readonly number[], ring: readonly number[] = []) {
    const markAttr = board.dataset.miniBoard === 'practice' ? 'data-suggest' : 'data-mark';
    const cols = Number(board.dataset.cols) || 5;
    board.querySelectorAll<HTMLElement>('[data-mini-cell]').forEach((el) => {
      const i = Number(el.dataset.index);
      setAttr(el, 'data-lit', String(!!cells[i]));
      setAttr(el, markAttr, suggest.includes(i) ? 'true' : null);
      setAttr(el, 'data-ring', ring.includes(i) ? 'true' : null);
      if (el.tagName === 'BUTTON') {
        const row = Math.floor(i / cols) + 1, col = (i % cols) + 1;
        setAttr(el, 'aria-label', fmt(cells[i] ? copy.cellOn : copy.cellOff, { row, col }));
      }
    });
  }

  /**
   * Press on pointerdown like the main board; a keyboard click (detail 0) presses too; arrows move focus (never into a gap).
   * Lights under the tap minimum (8×8 on narrow phones, 10×10): press-and-hold aims with a magnifying bubble, lift presses.
   * A tall board (the Tower) scrolls with the page: a press lands on release, and a swipe never presses (src/lib/aim.ts).
   */
  function wirePractice(board: HTMLElement, s: Shape) {
    let pointerPressed = -1;
    const indexOf = (e: Event) => {
      const cell = (e.target as Element | null)?.closest?.('[data-mini-cell]') as HTMLElement | null;
      return cell ? Number(cell.dataset.index) : -1;
    };
    /** slots under this aim, like the main board (decision 48) */
    const aimBelow = () => parseFloat(getComputedStyle(board).getPropertyValue('--aim-below')) || 40;
    /** one light's slot: the distance from a light to the next one in its row */
    const slot = () => {
      for (let i = 0; i + 1 < gridSize(s); i++) {
        if (!isCell(s, i) || !isCell(s, i + 1) || (i + 1) % s.cols === 0) continue;
        const a = board.querySelector(`[data-index="${i}"]`)?.getBoundingClientRect();
        const b = board.querySelector(`[data-index="${i + 1}"]`)?.getBoundingClientRect();
        return a && b ? b.left - a.left : Infinity;
      }
      return Infinity;
    };
    const mode = (): AimMode | null => {
      if (isTall(s)) return 'tap';
      const w = slot();
      return w > 0 && w < aimBelow() ? 'aim' : null;
    };
    /** the light whose slot holds a point (the gutters count), or -1 off the board */
    const cellAt = (x: number, y: number) => {
      const r = board.getBoundingClientRect();
      if (x < r.left || x >= r.right || y < r.top || y >= r.bottom) return -1;
      const css = getComputedStyle(board);
      const padX = parseFloat(css.paddingLeft) || 0, padY = parseFloat(css.paddingTop) || 0;
      const col = Math.min(s.cols - 1, Math.max(0, Math.floor(((x - r.left - padX) / (r.width - 2 * padX)) * s.cols)));
      const row = Math.min(s.rows - 1, Math.max(0, Math.floor(((y - r.top - padY) / (r.height - 2 * padY)) * s.rows)));
      const i = row * s.cols + col;
      return isCell(s, i) ? i : -1;
    };
    // one aim gesture: the lights it passed over and whether it pressed. A miss or a drag shows the aim tip.
    let trail: number[] = [];
    let pressed = false;
    const aim = attachAim(board, {
      mode,
      cellAt,
      litAt: (i) => (isCell(s, i) ? !!state().practice?.cells[i] : null),
      cols: () => s.cols,
      press: (i) => { pressed = true; ctx.emit('learn:press', { index: i }); },
      onAim: (i) => {
        if (i >= 0) trail.push(i);
        board.querySelectorAll<HTMLElement>('[data-mini-cell]').forEach((el) => setAttr(el, 'data-aimed', Number(el.dataset.index) === i ? 'true' : null));
      },
    });
    const gestureEnd = () => {
      if (board.dataset.aim === 'true' && trail.length) {
        const help = !pressed || new Set(trail).size > 1;
        if (help !== aimHelp) { aimHelp = help; patchPractice(state()); }
      }
      trail = [];
      pressed = false;
    };
    board.addEventListener('pointerup', gestureEnd);
    board.addEventListener('pointercancel', gestureEnd);
    // touch-action has to be set before a finger lands, so the aim mode follows the board's size
    const fit = () => {
      const aiming = mode() === 'aim';
      if (board.dataset.aim === String(aiming)) return;
      setAttr(board, 'data-aim', String(aiming));
      patchPractice(state());
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(board);
    practiceInput = { aim, observer };
    board.addEventListener('pointerdown', (e) => {
      if ((e as PointerEvent).button > 0 || aim.active()) return;
      const i = indexOf(e);
      if (i < 0) return;
      pointerPressed = i;
      ctx.emit('learn:press', { index: i });
    });
    board.addEventListener('click', (e) => {
      const i = indexOf(e);
      if (i < 0) return;
      // aim and tap modes already pressed on release; only a keyboard click (detail 0) presses here
      if ((e as MouseEvent).detail !== 0 && mode() !== null) return;
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

  /** a lesson's picture: the room glyph of the classic board, lit as the lesson's idea */
  function lessonGlyph(cells: Cells): HTMLElement {
    const g = roomGlyph({ shape: CLASSIC_SHAPE, count: 1 }, 0);
    g.querySelectorAll<HTMLElement>('i').forEach((dot, i) => setAttr(dot, 'data-lit', String(!!cells[i])));
    return g;
  }

  function buildList(s: LearnState): HTMLElement[] {
    root.classList.add('screen--scroll', 'learn-screen--list');
    const header = h('header', { class: 'screen-header' },
      h('button', { class: 'btn btn--icon', type: 'button', 'data-action': 'learn-back', 'aria-label': copy.back, onclick: () => ctx.emit('nav:back', {}) }, icon(CHEVRON_LEFT)),
      h('div', { class: 'screen-header__title' }, h('span', { class: 'eyebrow' }, copy.subtitle), h('strong', {}, copy.title)),
      h('div', { class: 'screen-header__end' }),
    );
    // one menu row per lesson or guide, like the home menu: picture, title, one dim line, done mark
    const row = (id: string, glyph: HTMLElement, title: string, summary: string) => {
      const done = s.completed.includes(id);
      return h('li', {},
        h('button', { class: 'menu-row lesson-tile', type: 'button', 'data-lesson-tile': '', 'data-lesson': id, 'data-completed': String(done), onclick: () => ctx.emit('learn:open', { lessonId: id }) },
          h('span', { class: 'menu-row__glyph' }, glyph),
          h('span', { class: 'menu-row__body' },
            h('span', { class: 'menu-row__title' }, title),
            h('span', { class: 'menu-row__sub' }, summary)),
          // done: the check; not yet: an empty ring in the same place, so the column reads as a checklist
          h('span', { class: 'menu-row__end' },
            h('span', { class: 'menu-row__mark lesson-tile__mark', 'data-done': String(done), role: done ? 'img' : null, 'aria-label': done ? copy.done : null }, done ? icon(CHECK) : null)),
        ));
    };
    const section = (key: 'basics' | 'boards', items: HTMLElement[]) => h('section', { class: 'section learn-section', 'data-learn-section': key },
      h('h2', { class: 'eyebrow learn-section__title' }, copy.sections[key]), h('ol', { class: 'menu-list learn-list' }, ...items));
    const basics = rules.lessons.map((id) => row(id, lessonGlyph(TILE_GLYPH[id]?.(d) ?? blank()), copy.lessons[id]!.title, copy.lessons[id]!.summary));
    const progress = ctx.read('progress');
    // the room's own picture, lit as it is on the menu (the share of its levels solved)
    const glyph = (pack: Pack) => roomGlyph(pack, progress?.packs?.[pack.id]?.solved ?? 0);
    const boards = catalog.guides().map((g) => row(g.id, glyph(g.pack), g.pack.name, copy.guides[g.pack.id]!.summary));
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
    return { start, taps: [col, ...rest], phases: [null, ...rest.map(() => 'chase' as const)], pos: 0, cells: start, cancel: null, round: 0, paused: false };
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
    return { start, taps, phases, pos: 0, cells: start, cancel: null, shape, end: step.end, orders: step.orders, round: 0, markAll: step.markAll, paused: false };
  }

  /** a full rectangle's lone bottom light: its top lights to tap outlined, tap them, then chase again */
  function lightPlan(row: { bottom: number; top: number[] }, shape: Shape): Demo {
    const start = emptyCells(shape).map((_, i) => i === row.bottom);
    const again = chaseShape(solver, pressAll(solver, start, row.top, shape), shape).taps;
    return {
      start, taps: [...row.top, ...again], phases: [...row.top.map(() => 'top' as const), ...again.map(() => 'chase2' as const)],
      pos: 0, cells: start, cancel: null, shape, round: 0, ring: row.top, paused: false,
    };
  }

  /** "A", "A and B", "A, B and C" */
  const listOf = (names: readonly string[]) => names.length < 2 ? (names[0] ?? '')
    : `${names.slice(0, -1).join(copy.comma)}${copy.and}${names.at(-1)}`;
  const letterOf = (i: number, cols: number) => copy.letters[i % cols] ?? '';

  function paintDemo() {
    if (!demo || !demoEls) return;
    const cols = demo.shape?.cols ?? SIZE;
    const next = demo.taps[demo.pos];
    const doneAll = demo.pos >= demo.taps.length;
    const done = demo.taps.slice(0, demo.pos);
    const phase = doneAll ? null : demo.phases[demo.pos] ?? null;
    // the next tap is dotted (every tap to come on a markAll demo); outlined: the top lights still to tap, or while
    // a top-edge tap is next, every top-edge light (lights with nothing above them)
    const dots = doneAll ? [] : demo.markAll ? demo.taps.slice(demo.pos) : [next!];
    const ring = phase === 'edge' ? demoEls.edges : (demo.ring ?? []).filter((i) => !done.includes(i));
    patchBoard(demoEls.board, demo.cells, dots, ring);
    let text: string;
    if (doneAll) {
      const left = litIndexes(demo.cells).length;
      text = demoEls.echo !== null ? fmt(copy.echo.caption, { name: copy.letters[demoEls.echo]! })
        : demo.end === 'cancelled' ? copy.demoEnd.cancelled
        : left === 0 ? demoEls.end ?? copy.demoDone
        : fmt(copy.demoEnd[demo.end ?? 'left'], { n: left });
    } else {
      const tap = { n: demo.pos + 1, total: demo.taps.length };
      // a top light tapped a second time: say that it cancels
      text = phase === 'top' && done.includes(next!) ? fmt(copy.demoCancel, { name: letterOf(next!, cols) })
        : phase ? fmt(copy.demoPhaseTap, { phase: copy.demoPhase[phase], ...tap }) : fmt(copy.demoTap, tap);
    }
    setText(demoEls.line, text);
    setAttr(demoEls.line, 'data-tone', 'coach');
    const auto = !view.reducedMotion() && !demo.paused;
    setText(demoEls.button, doneAll ? copy.demoReplay : auto ? copy.demoPlay : copy.demoStep);
    demoEls.button.hidden = auto && !doneAll;
  }

  /** the Tower's demos are full size and scroll with the step: keep the next tap (or the last one) in view */
  function followDemo() {
    if (!demo || !demoEls || demoEls.board.dataset.tall !== 'true') return;
    const i = demo.taps[Math.min(demo.pos, demo.taps.length - 1)];
    demoEls.board.querySelector<HTMLElement>(`[data-mini-cell][data-index="${i}"]`)?.scrollIntoView?.({ block: 'nearest', behavior: view.reducedMotion() ? 'auto' : 'smooth' });
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
    followDemo();
    if (!demo.paused && !view.reducedMotion() && demo.pos < demo.taps.length && clock) demo.cancel = clock.setTimeout(demoTick, delayBefore(demo.pos));
  }

  /**
   * A top-row (or top-edge) tap and a spotted shape are held a little longer, so the eye finds them before they happen.
   * Other taps speed up on a long demo (10×10, the Tower), so a whole demo runs about demoMaxMs.
   */
  const HOLD: (Phase | null | undefined)[] = ['top', 'edge', 'spot'];
  const delayBefore = (pos: number) => (HOLD.includes(demo?.phases[pos]) ? rules.demoHoldMs
    : Math.min(rules.demoStepMs, Math.round(rules.demoMaxMs / Math.max(1, demo?.taps.length ?? 1))));

  /** from the start; `again` (Replay) plays the next order of a demo that has several */
  function restartDemo(again = false) {
    if (!demo) return;
    stopDemo();
    if (again && demo.orders?.length) {
      demo.round++;
      demo.taps = demo.orders[demo.round % demo.orders.length]!;
    }
    demo.pos = 0;
    demo.cells = demo.start;
    demo.paused = false;
    paintDemo();
    followDemo();
    if (!view.reducedMotion() && clock && visible() && demo.taps.length) demo.cancel = clock.setTimeout(demoTick, Math.max(rules.demoStartMs, delayBefore(0)));
  }

  /** Play / Next tap / Replay: a step stops the auto-play, each press steps once */
  function onDemoButton() {
    if (!demo) return;
    if (demo.pos >= demo.taps.length) return restartDemo(true);
    demo.paused = true;
    stopDemo();
    demoTick();
  }

  /** a tap on a playing demo pauses it; then each tap steps once; at the end it replays */
  function onDemoBoard() {
    if (!demo) return;
    if (demo.pos >= demo.taps.length) return restartDemo(true);
    if (!demo.paused && !view.reducedMotion()) {
      demo.paused = true;
      stopDemo();
      return paintDemo();
    }
    onDemoButton();
  }

  function buildLesson(s: LearnState): HTMLElement[] {
    root.classList.remove('screen--scroll', 'learn-screen--list');
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
        // a full rectangle's guide names its size: "6×6 · Step 1 of 4"
        h('span', { class: 'eyebrow' }, fmt(shape && lesson.coach === 'rect' ? copy.stepOfSize : copy.stepOf, { step: s.step + 1, total: lesson.steps.length, cols: shape?.cols ?? SIZE, rows: shape?.rows ?? SIZE })),
        h('strong', {}, c.title)),
      h('div', { class: 'screen-header__end' }),
    );
    const dots = h('div', { class: 'learn-dots', 'aria-hidden': 'true' }, ...lesson.steps.map((_, k) => h('i', { 'data-state': k < s.step ? 'done' : k === s.step ? 'now' : 'todo' })));
    const text = h('p', { class: 'learn-text' }, c.steps[s.step] ?? '');
    // the stage fills what is left: the fit box (the picture, as large as it fits), then the line and buttons
    const tall = !!shape && isTall(shape);
    const stage = h('div', {
      class: `learn-stage learn-stage--${step.kind}`, 'data-shape': shape ? shapeKey(shape) : null,
      'data-tall': tall ? 'true' : null, style: shape ? ratio(shape) : null,
    });
    const fit = h('div', { class: 'learn-fit' });
    const under = h('div', { class: 'learn-under' });

    practiceEls = null;
    stopInput();
    demoEls = null;
    stopDemo();
    demo = null;
    aimHelp = false;

    const demoLine = () => h('p', { class: 'tutorial-line', 'data-learn-line': 'demo', 'data-tone': 'coach', 'aria-live': 'polite' });
    const demoButton = () => h('button', { class: 'btn btn--ghost learn-small', type: 'button', 'data-action': 'learn-demo', onclick: onDemoButton }, copy.demoPlay);
    const cols = shape?.cols ?? SIZE;
    /** letters over a board's columns: quiet labels, or a picker; the board's own padding and gaps line them up */
    const group = (letters: HTMLElement | null, board: HTMLElement, kind: 'static' | 'pick' | 'hint') => {
      setAttr(stage, 'data-letters', kind);
      return h('div', { class: 'learn-pickboard', 'data-room': shape && Math.max(shape.cols, shape.rows) !== SIZE ? 'true' : null }, letters, board);
    };
    const quietLetters = () => h('div', { class: 'learn-picker learn-picker--static', 'aria-hidden': 'true', style: `--pick-n:${cols}` },
      ...[...copy.letters.slice(0, cols)].map((l) => h('span', { class: 'learn-pick' }, l)));
    /** a demo board: tap it to pause, then to step */
    const demoBoard = (cells: Cells, sh?: Shape) => {
      const board = miniBoard(cells, 'demo', [], sh);
      board.addEventListener('click', onDemoBoard);
      return board;
    };

    if (step.kind === 'show') {
      const captioned = step.boards.some((b) => !!b.caption);
      fit.append(h('div', { class: 'learn-figs', 'data-n': step.boards.length, 'data-captions': captioned ? 'true' : null, style: `--n:${step.boards.length}` }, ...step.boards.map((b) => figure(b, shape))));
    } else if (step.kind === 'demo') {
      demo = demoPlan(step, shape);
      const board = demoBoard(demo.start, shape);
      const line = demoLine();
      const button = demoButton();
      fit.append(step.letters ? group(quietLetters(), board, 'static') : board);
      under.append(line, h('div', { class: 'learn-controls' }, button));
      // shaped rooms: the lights with nothing above them, outlined while a top-edge tap is next
      demoEls = { board, line, button, echo: null, edges: shape && step.phases?.includes('edge') ? startCells(shape) : [] };
    } else if (step.kind === 'echo') {
      // pick a top-row light; the demo taps it and chases down to its echo
      const col = 1;
      demo = echoPlan(col);
      const board = demoBoard(demo.start);
      const line = demoLine();
      const button = demoButton();
      // the A–E buttons sit over the board's columns
      fit.append(group(picker(copy, col, (c) => { if (!demoEls) return; demoEls.echo = c; demo = echoPlan(c); restartDemo(); }), board, 'pick'));
      under.append(line, h('div', { class: 'learn-controls' }, button));
      demoEls = { board, line, button, echo: col, edges: [] };
    } else if (step.kind === 'lights' && shape) {
      // board first: a letter over each column picks a bottom light; its top lights to tap are outlined, then the demo
      // taps them and chases again
      demo = lightPlan(step.rows[step.pick]!, shape);
      const board = demoBoard(demo.start, shape);
      const line = demoLine();
      const button = demoButton();
      const letters = picker(copy, step.pick, (c) => { demo = lightPlan(step.rows[c]!, shape); restartDemo(); }, {
        n: cols, action: 'learn-strip', label: copy.lights.pick,
        say: (c) => fmt(copy.lights.row, { name: copy.letters[c]!, taps: listOf(step.rows[c]!.top.map((i) => letterOf(i, cols))) }),
      });
      fit.append(group(letters, board, 'pick'));
      under.append(line, h('div', { class: 'learn-controls' }, button));
      demoEls = { board, line, button, echo: null, edges: [], end: copy.lights.end };
    } else if (step.kind === 'table') {
      fit.append(tableList(copy, d.table()));
    } else if (step.kind === 'stack') {
      fit.append(stackView(copy, solver, step.pairs));
    } else if (step.kind === 'rules') {
      fit.append(rulesView(copy, d.table()));
    } else if (step.kind === 'derive') {
      fit.append(deriveView(copy));
    } else if (step.kind === 'drill') {
      const drill = createDrill({ copy, rules, solver, rng: d.rng, table: d.table(), store: d.drillStore });
      fit.append(drill.root);
      under.append(drill.line, drill.controls);
    } else {
      const p = s.practice;
      const board = miniBoard(p?.cells ?? (shape ? emptyCells(shape) : blank()), 'practice', [], shape);
      const line = h('p', { class: 'tutorial-line', 'data-learn-line': 'practice', 'data-tone': 'coach', 'aria-live': 'polite' });
      const moves = h('span', { class: 'learn-moves num', 'data-learn-moves': '' });
      const assist = lesson.assist
        ? h('button', { class: 'btn btn--ghost learn-small', type: 'button', 'data-action': 'learn-assist', 'aria-pressed': String(s.assist), onclick: () => ctx.emit('learn:set_assist', { on: !state().assist }) }, copy.assist)
        : null;
      const another = h('button', { class: 'btn btn--ghost learn-small', type: 'button', 'data-action': 'learn-practice', onclick: () => ctx.emit('learn:new_practice', {}) }, copy.newBoard);
      fit.append(board);
      under.append(line, h('div', { class: 'learn-controls' }, moves, assist, another));
      practiceEls = { board, line, moves, another, assist, suggest: null, start: null };
    }
    // "Go deeper" sits under the last idea before practice (lesson 4's list, lesson 5's two answers), never under a practice board
    const deeperAt = lesson.steps.reduce((at, x, k) => (x.kind === 'practice' ? at : k), -1);
    if (lesson.deeper && s.step === deeperAt) {
      under.append(h('button', { class: 'btn btn--link learn-link', type: 'button', 'data-action': 'learn-deeper', onclick: () => ctx.emit('learn:open', { lessonId: lesson.deeper! }) }, copy.deeper));
    }
    stage.append(fit);
    if (under.childElementCount) { stage.append(under); setAttr(stage, 'data-under', 'true'); }
    // lists that scroll inside the stage (the five rules, how an echo forms) fade at the edge with more to see
    const scroller = fit.querySelector<HTMLElement>('.learn-rules, .learn-derive');
    if (scroller) { scroller.classList.add('learn-scroll'); afterLayout(() => watchEdges(scroller)); }

    const navRow = h('nav', { class: 'bar learn-nav' },
      h('button', { class: 'btn btn--ghost', type: 'button', 'data-action': 'learn-prev', disabled: s.step === 0, onclick: () => ctx.emit('learn:step', { delta: -1 }) }, copy.prev),
      h('button', { class: 'btn btn--primary bar__main', type: 'button', 'data-action': 'learn-next', onclick: () => ctx.emit('learn:step', { delta: 1 }) }, last ? copy.finish : copy.next),
    );
    const body = h('div', { class: 'learn-step', 'data-step': s.step, 'data-kind': step.kind }, dots, text, stage);
    const wrap = h('div', { class: 'learn-lesson', 'data-lesson-view': id, 'data-step': s.step }, header, body, navRow);
    return [wrap];
  }

  /** run once the new step is laid out (next frame); skipped where there is no layout (tests) */
  function afterLayout(fn: () => void) {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { if (root.isConnected) fn(); });
  }
  /** mark a scrolling box's edges that hide more (CSS fades them) */
  function watchEdges(el: HTMLElement) {
    const paint = () => {
      setAttr(el, 'data-more-above', el.scrollTop > 1 ? 'true' : null);
      setAttr(el, 'data-more-below', el.scrollTop + el.clientHeight < el.scrollHeight - 1 ? 'true' : null);
    };
    el.addEventListener('scroll', paint, { passive: true });
    paint();
  }


  function parOf(start: Cells, shape?: Shape): number {
    const key = `${shape ? shapeKey(shape) : ''}|${start.map((b) => (b ? 1 : 0)).join('')}`;
    let par = parCache.get(key);
    if (par === undefined) { par = (shape ? solver.solve(start, shape) : solver.solve(start))?.length ?? 0; parCache.set(key, par); }
    return par;
  }

  /** a guide's practice line by phase: chase; bottom light(s) and their top lights; chase again (shaped rooms: the top edge) */
  function coachLine(id: string, shape: Shape, kind: 'rect' | 'shape', start: Cells, cells: Cells): string {
    const fixer = catalog.fixer(id);
    const c = fixer ? coachPhase(solver, fixer, shape, start, cells) : null;
    if (!c) return '';
    if (c.phase === 'chase') return copy.coach.chase;
    if (c.phase === 'again') return copy.coach.again;
    if (kind === 'shape') return fmt(copy.coach.shapeFix, { n: c.fix.length });
    const say = (xs: number[]) => listOf(xs.map((i) => letterOf(i, shape.cols)));
    return fmt(c.ends.length > 1 ? copy.coach.bottoms : copy.coach.bottom, { names: say(c.ends), taps: say(c.fix) });
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
    const moved = p.cells.some((on, i) => on !== p.start[i]);
    let line = '';
    const tone = 'coach'; // teal is the paid Hint's colour only
    if (p.status === 'solved') line = fmt(showPar ? (p.moves <= par ? copy.solvedAtPar : copy.solvedPar) : copy.solved, { moves: p.moves, par });
    else if (echo) line = fmt(copy.echoMatch, { name: names(copy, echo.top) });
    else if (aimHelp && practiceEls.board.dataset.aim === 'true') line = copy.aimTip;
    else if (lesson?.coach && lesson.shape) line = coachLine(s.lessonId!, lesson.shape, lesson.coach, p.start, p.cells);
    else if (lesson?.undoHint && moved) line = copy.undoHint;
    else if (p.suggest !== null) line = copy.assistLine;
    setText(practiceEls.line, line);
    const board = practiceEls.board;
    const into = (i: number | undefined, block: ScrollLogicalPosition = 'nearest') => board.querySelector<HTMLElement>(`[data-mini-cell][data-index="${i}"]`)?.scrollIntoView?.({ block, behavior: view.reducedMotion() ? 'auto' : 'smooth' });
    // the Tower scrolls inside its box: a new board opens on its first light; a newly ringed light comes into view too
    if (p.start !== practiceEls.start) {
      practiceEls.start = p.start;
      if (board.dataset.tall === 'true') afterLayout(() => into(p.cells.findIndex(Boolean), 'center'));
    }
    if (p.suggest !== practiceEls.suggest) {
      practiceEls.suggest = p.suggest;
      if (p.suggest !== null && board.dataset.tall === 'true') into(p.suggest);
    }
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

  function stopInput() {
    practiceInput?.aim.destroy();
    practiceInput?.observer?.disconnect();
    practiceInput = null;
  }

  return {
    stop: () => { stopDemo(); stopInput(); },
    debug: () => (demo ? { demoAt: demo.pos, demoTaps: demo.taps.length } : null),
  };
}
