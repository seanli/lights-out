// play-view: the play screen. Renders the board, hints, tutorial and progress slices and turns taps into commands.
// The DOM is built once (the grid again only when the board's shape changes); every change only touches what differs.
// How a touch presses depends on the measured board: instant on pointerdown (normal boards), on release unless the
// finger moved (a tall board that scrolls), or aim-and-release with a magnifier (slots under the tap minimum).
import * as v from 'valibot';
import { MAX_CELLS, type BoardState, type HintsState, type LevelsState, type ModuleDef, type ProgressState, type Shape, type TutorialState } from '../../contracts';
import { flip, measure } from './flip';
import { cellAt, isTall, rowEdge, stepFrom } from './grid';
import { attachAim, type AimMode } from '../../lib/aim';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import { skull } from '../../lib/icons';
import { cellIndexes, gridSize, isCell, shapeKey, shapeOf } from '../../lib/shape';
import './play-view.css';

const text = v.pipe(v.string(), v.minLength(1));
const CopySchema = v.object({
  chapter: text, level: text, boss: text, moves: text, par: text, undo: text, restart: text, hint: text, hintCost: text,
  back: text, patterns: text, board: text, maxAria: text, hintLine: text, hintChipCost: text, hintChipWord: text, hintChipAria: text,
  cellOn: text, cellOff: text, tierWithin: text, tierOver: text, tierWithinAria: text, tierOverAria: text,
});
type Copy = v.InferOutput<typeof CopySchema>;

// icon paths (24×24, stroked by .icon)
const ICON = {
  back: ['M15 5l-7 7 7 7'],
  book: ['M2 4h6a4 4 0 014 4v13a3 3 0 00-3-3H2z', 'M22 4h-6a4 4 0 00-4 4v13a3 3 0 013-3h7z'],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 010 12h-3'],
  restart: ['M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8', 'M3 3v5h5'],
  hint: ['M9 18h6M10 22h4', 'M12 2a7 7 0 00-4 12.7V16h8v-1.3A7 7 0 0012 2z'],
};

function icon(paths: string[]): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

const ARROWS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/** a CSS time token in ms ("800ms" / ".8s"), or NaN */
function ms(value: string): number {
  const n = parseFloat(value);
  return /ms\s*$/.test(value) ? n : /s\s*$/.test(value) ? n * 1000 : NaN;
}

/** same grid: size and gaps (store writes clone, so shapes are compared by value) */
function sameGrid(a: Shape, b: Shape): boolean {
  if (a.cols !== b.cols || a.rows !== b.rows) return false;
  if (!a.mask || !b.mask) return !a.mask === !b.mask || (a.mask ?? b.mask)!.every(Boolean);
  for (let k = 0; k < a.mask.length; k++) if (a.mask[k] !== b.mask[k]) return false;
  return true;
}

const playView: ModuleDef = {
  manifest: {
    name: 'play-view',
    emits: ['board:press', 'board:undo', 'board:restart', 'hints:request', 'nav:back'],
    listens: [],
    owns: [],
    uses: ['view'],
    optional: ['clock'],
    data: { copy: CopySchema },
  },
  init(ctx) {
    const copy = ctx.data.copy as Copy;
    const view = ctx.need('view');
    const clock = ctx.service('clock');

    // ---------- build once ----------
    const stars = (n: number) => Array.from({ length: n }, () => h('span', { class: 'star', 'data-state': 'on', 'aria-hidden': 'true' }));
    const starRow = (cls: string, list: HTMLElement[]) => h('span', { class: `stars ${cls}` }, ...list);

    const back = h('button', { class: 'btn btn--icon', type: 'button', 'data-action': 'back', 'aria-label': copy.back }, icon(ICON.back));
    const chapterEl = h('span', { class: 'eyebrow' });
    // a boss level: the skull beside the level's name (the eyebrow says "· Boss" in words)
    const skullEl = skull();
    skullEl.classList.add('play-skull');
    const levelText = h('span', {});
    const levelEl = h('strong', { 'data-level-label': '' }, skullEl, levelText);
    const refBtn = h('button', {
      class: 'btn btn--icon', type: 'button', 'data-action': 'reference', 'aria-label': copy.patterns, title: copy.patterns,
      'aria-expanded': 'false', 'aria-controls': 'play-reference', hidden: true,
    }, icon(ICON.book));
    const header = h('header', { class: 'screen-header' },
      back,
      h('div', { class: 'screen-header__title' }, chapterEl, levelEl),
      h('div', { class: 'screen-header__end' }, refBtn));

    const movesEl = h('span', { class: 'stat__value', 'data-moves': '' }, '0');
    const parEl = h('span', { class: 'stat__value', 'data-par': '' }, '0');
    const stats = h('div', { class: 'play-stats' },
      h('div', { class: 'stat' }, h('span', { class: 'eyebrow' }, copy.moves), movesEl),
      h('div', { class: 'stat stat--muted' }, h('span', { class: 'eyebrow' }, copy.par), parEl));

    const tiers = [3, 2, 1].map((base) => {
      const label = h('span', {});
      const list = stars(3);
      const el = h('span', { class: 'chip', role: 'listitem' }, label, starRow('stars--xs', list));
      return { base, el, label, stars: list };
    });
    // hints already taken on this level: the stars they cost, next to the tiers they lowered
    const hintCost = h('span', {});
    const hintWord = h('span', { class: 'play-hint-word' });
    const hintChip = h('span', { class: 'chip', 'data-state': 'hint', role: 'listitem', hidden: true }, hintCost, hintWord);
    const tiersEl = h('div', { class: 'play-tiers', role: 'list' }, ...tiers.map((t) => t.el), hintChip);

    const board = h('div', { class: 'board', 'data-board': '', 'data-status': 'playing', role: 'group', 'aria-label': copy.board });

    const hintLine = h('p', { class: 'tutorial-line', 'data-tone': 'hint', role: 'status', hidden: true }, copy.hintLine);
    const line = h('div', { class: 'play-line', 'data-hint': 'false' }, hintLine, view.region('slot:coach'));
    const slot = h('div', { class: 'board-slot', 'data-tiers': 'true' }, stats, tiersEl, board, line);

    // labels sit in .play-act__label so the compact layout (panel open) can hide them visually but keep them for screen readers
    const label = (...kids: (Node | string)[]) => h('span', { class: 'play-act__label' }, ...kids);
    const undo = h('button', { class: 'btn btn--stack', type: 'button', 'data-action': 'undo' }, icon(ICON.undo), label(copy.undo));
    const restart = h('button', { class: 'btn btn--stack', type: 'button', 'data-action': 'restart' }, icon(ICON.restart), label(copy.restart));
    const hintBtn = h('button', { class: 'btn btn--stack btn--hint', type: 'button', 'data-action': 'hint' },
      icon(ICON.hint), label(`${copy.hint} `, h('span', { class: 'btn__meta' }, `· ${copy.hintCost}`)));
    const actions = h('div', { class: 'play-actions' }, undo, restart, hintBtn);

    // the in-game pattern reference: learn fills slot:reference, we place it once and open/close it
    const reference = h('div', { class: 'play-reference', id: 'play-reference' }, view.region('slot:reference'));

    const root = view.region('screen:play');
    root.classList.add('screen--play');
    root.dataset.reference = 'closed';
    root.append(header, slot, actions, reference);

    // ---------- the grid: rebuilt only when the board's shape changes ----------
    let shape: Shape | null = null;
    /** one entry per grid position: the cell's button, or null for a gap */
    let cells: (HTMLButtonElement | null)[] = [];
    /** the real cells' grid indexes, ascending */
    let real: number[] = [];
    let labels = { on: [] as string[], off: [] as string[] };
    const shown = new Int8Array(MAX_CELLS).fill(-1);
    /** --flip-delay per cell as last written: 0 = 0ms, 1 = the stagger, -1 = never set */
    const delays = new Int8Array(MAX_CELLS).fill(-1);
    /** cells pressed on pointerdown whose trailing click must be swallowed */
    const pending = new Uint8Array(MAX_CELLS);
    let focusIndex = 0;
    let hintCell = -1;
    let pointerCell = -1;
    let aimedCell = -1;
    /** a tall board scrolls (presses land on release); `aim`: its slots are under the tap minimum (measured) */
    let tall = false;
    let aim = false;
    const rowOf = (i: number) => Math.floor(i / shape!.cols);
    const colOf = (i: number) => i % shape!.cols;
    const resetOrder = () => { for (const i of real) cells[i]!.style.setProperty('--i', String(rowOf(i) + colOf(i))); };

    const buildGrid = (next: Shape) => {
      stopSweep();
      shape = next;
      real = cellIndexes(next);
      labels = { on: [], off: [] };
      cells = [];
      const slots: HTMLElement[] = [];
      for (let i = 0; i < gridSize(next); i++) {
        const pos = { row: rowOf(i) + 1, col: colOf(i) + 1 };
        labels.on.push(fmt(copy.cellOn, pos));
        labels.off.push(fmt(copy.cellOff, pos));
        if (!isCell(next, i)) {
          // a gap keeps its grid slot and nothing else: not a button, not focusable, invisible to assistive tech
          cells.push(null);
          slots.push(h('div', { 'data-gap': '', 'aria-hidden': 'true' }));
          continue;
        }
        const cell = h('button', {
          class: 'cell', type: 'button', 'data-cell': '', 'data-index': i, 'data-lit': 'false',
          'aria-pressed': 'false', 'aria-label': labels.off[i], tabindex: i === real[0] ? '0' : '-1',
        });
        cells.push(cell);
        slots.push(cell);
      }
      board.replaceChildren(...slots);
      resetOrder();
      const n = Math.max(next.cols, next.rows);
      board.dataset.n = String(n);
      board.dataset.cols = String(next.cols);
      board.dataset.rows = String(next.rows);
      board.style.setProperty('--board-n', String(n));
      board.style.setProperty('--board-cols', String(next.cols));
      board.style.setProperty('--board-rows', String(next.rows));
      tall = isTall(next);
      setAttr(board, 'data-scroll', tall ? 'true' : null);
      shown.fill(-1);
      delays.fill(-1);
      pending.fill(0);
      focusIndex = real[0] ?? 0;
      hintCell = -1;
      pointerCell = -1;
      aimedCell = -1;
      measureSlot(); // the same box can hold a different grid (8×8 → 10×10): the observer wouldn't fire
    };

    // ---------- input ----------
    const press = (index: number) => {
      if (ctx.read('board')?.status !== 'playing') return; // solved / sweeping: taps do nothing
      ctx.emit('board:press', { index });
    };
    const cellIndex = (target: EventTarget | null): number => {
      const el = (target as Element | null)?.closest?.('[data-cell]') as HTMLElement | null | undefined;
      return el && board.contains(el) ? Number(el.dataset.index) : -1;
    };
    /** the real cell whose grid slot holds a client point (gutter and padding included; a scrolled board's content counts) */
    const pointCell = (x: number, y: number): number => {
      if (!shape) return -1;
      const r = board.getBoundingClientRect();
      const css = getComputedStyle(board);
      const px = (v: string) => parseFloat(v) || 0;
      return cellAt(shape, x - r.left + board.scrollLeft, y - r.top + board.scrollTop, {
        width: r.width, height: tall ? Math.max(board.scrollHeight, r.height) : r.height,
        padX: px(css.paddingLeft), padY: px(css.paddingTop), gapX: px(css.columnGap), gapY: px(css.rowGap),
      });
    };
    /** null = press at once on pointerdown; otherwise src/lib/aim.ts owns every pointer press */
    const pointerMode = (): AimMode | null => (tall ? 'tap' : aim ? 'aim' : null);
    const aimer = attachAim(board, {
      mode: pointerMode,
      cellAt: pointCell,
      litAt: (i) => (cells[i] ? shown[i] === 1 : null),
      cols: () => shape?.cols ?? 5,
      press,
      onAim: (i) => { aimedCell = mark('data-aimed', aimedCell, i); },
    });
    board.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || pointerMode()) return; // primary mouse button; every touch/pen contact is button 0
      let i = cellIndex(e.target);
      // the space between cells and the board's padding are hit area too (layout is clean: nothing written yet)
      if (i < 0 && e.target === board) i = pointCell(e.clientX, e.clientY);
      if (i < 0) return;
      if (cellIndex(e.target) === i) pending[i] = 1; // the click that follows lands on the cell; a gutter click lands on the board
      press(i);
    });
    board.addEventListener('click', (e) => {
      const i = cellIndex(e.target);
      if (i < 0) return;
      if (e.detail === 0) return press(i); // keyboard (Enter/Space) or assistive tech
      if (pending[i]) { pending[i] = 0; return; } // already pressed on pointerdown
      if (pointerMode() || aimer.active()) return; // pressed (or not) on release by the aim helper: never twice
      press(i); // a click with no pointerdown before it
    });

    // the slot (board size / cols, gutter included: DECISIONS #40) decides aim mode; measured, never on a tap
    let tapMin = 0;
    const measureSlot = () => {
      const r = board.getBoundingClientRect();
      if (shape && !tall && !r.width) return; // hidden: measured again when it shows
      tapMin ||= parseFloat(getComputedStyle(board).getPropertyValue('--tap-min')) || 44;
      // a scrolling board keeps its slots big (it fits its width) and needs its swipes: never aim there
      aim = !!shape && !tall && Math.min(r.width / shape.cols, r.height / shape.rows) < tapMin - 0.5;
      setAttr(board, 'data-aim', aim ? 'true' : null);
    };
    const resizes = typeof ResizeObserver === 'function' ? new ResizeObserver(() => measureSlot()) : null;
    resizes?.observe(board);
    if (!resizes) addEventListener('resize', measureSlot);
    const rove = (i: number) => {
      if (i === focusIndex) return;
      if (cells[focusIndex]) cells[focusIndex]!.tabIndex = -1;
      cells[i]!.tabIndex = 0;
      focusIndex = i;
    };
    board.addEventListener('focusin', (e) => { const i = cellIndex(e.target); if (i >= 0) rove(i); });
    board.addEventListener('keydown', (e) => {
      const i = cellIndex(e.target);
      if (i < 0 || !shape) return;
      const step = ARROWS[e.key];
      const next = step ? stepFrom(shape, i, step[0], step[1])
        : e.key === 'Home' ? rowEdge(shape, i, -1)
        : e.key === 'End' ? rowEdge(shape, i, 1) : -1;
      if (next < 0) return;
      e.preventDefault();
      rove(next);
      cells[next]!.focus();
    });
    // a flip marker lives for one animation (bloom / afterglow); the cell's own, not its rings'
    board.addEventListener('animationend', (e) => {
      const el = e.target as HTMLElement;
      if (!e.pseudoElement && el.hasAttribute?.('data-flip')) el.removeAttribute('data-flip');
    });
    board.addEventListener('contextmenu', (e) => e.preventDefault());
    board.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS apply :active on the cells

    const onAction = (el: HTMLButtonElement, fn: () => void) =>
      el.addEventListener('click', () => { if (el.getAttribute('aria-disabled') !== 'true') fn(); });
    // back to where the level was opened from: the menu (Continue) or the board's level screen
    onAction(back, () => ctx.emit('nav:back', {}));
    onAction(undo, () => ctx.emit('board:undo', {}));
    onAction(restart, () => ctx.emit('board:restart', {}));
    onAction(hintBtn, () => ctx.emit('hints:request', {}));

    // ---------- pattern reference (open/closed is instance state: it survives level changes, not reloads) ----------
    let refOpen = false;
    let refWanted = false;
    let boardPointers = 0;
    const applyReference = () => {
      if (refWanted === refOpen) return;
      const moving = [board, stats, actions];
      const before = measure(moving);
      refOpen = refWanted;
      root.dataset.reference = refOpen ? 'open' : 'closed';
      refBtn.setAttribute('aria-expanded', refOpen ? 'true' : 'false');
      if (!view.reducedMotion()) flip(moving, before, ms(getComputedStyle(root).getPropertyValue('--dur-sheet')));
    };
    /** never move the board under a finger: a change asked for mid-press waits for the release */
    const setReference = (open: boolean) => {
      refWanted = open && !!ctx.read('learn');
      if (boardPointers === 0) applyReference();
    };
    board.addEventListener('pointerdown', () => { boardPointers++; });
    const release = () => {
      if (boardPointers === 0) return;
      boardPointers--;
      if (boardPointers === 0) applyReference();
    };
    document.addEventListener('pointerup', release, true);
    document.addEventListener('pointercancel', release, true);
    onAction(refBtn, () => setReference(!refWanted));
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !refWanted || root.hidden || ctx.read('nav')?.sheet) return;
      const inside = reference.contains(document.activeElement);
      setReference(false);
      if (inside) refBtn.focus();
    };
    document.addEventListener('keydown', onKey);
    const renderLearn = () => {
      const has = !!ctx.read('learn');
      refBtn.hidden = !has;
      if (!has && refWanted) setReference(false);
    };
    ctx.watch('learn', renderLearn);
    renderLearn();

    // ---------- solve sweep ----------
    let cancelSweep: (() => void) | null = null;
    let sweepFrame = 0;
    function stopSweep() {
      cancelAnimationFrame(sweepFrame);
      cancelSweep?.();
      cancelSweep = null;
      if (!board.classList.contains('board--sweep')) return;
      board.classList.remove('board--sweep');
      resetOrder();
    }
    /** a ripple from the winning tap over the real cells: each waits by its distance, scaled so the farthest ends on --dur-sweep */
    let timing: { total: number; span: number } | null = null; // tokens never change at runtime: read once
    const startSweep = (origin: number) => {
      stopSweep();
      if (view.reducedMotion()) return;
      // start on the next frame: the winning tap's own light change paints first, and nothing
      // in the tap's handler forces a style or layout pass
      cancelAnimationFrame(sweepFrame);
      sweepFrame = requestAnimationFrame(() => {
        if (!timing) {
          const css = getComputedStyle(board);
          const total = ms(css.getPropertyValue('--dur-sweep'));
          timing = { total, span: (total - ms(css.getPropertyValue('--dur-sweep-cell'))) / ms(css.getPropertyValue('--sweep-step')) };
        }
        const { total, span } = timing;
        const dist = real.map((i) => Math.hypot(rowOf(i) - rowOf(origin), colOf(i) - colOf(origin)));
        const far = Math.max(...dist) || 1;
        const scale = Number.isFinite(span) && span > 0 ? span / far : 1;
        real.forEach((i, k) => cells[i]!.style.setProperty('--i', (dist[k]! * scale).toFixed(2)));
        board.classList.add('board--sweep');
        if (clock && Number.isFinite(total)) cancelSweep = clock.setTimeout(stopSweep, total);
      });
    };

    // ---------- level intro: the room's lights come on (paint only; taps work at once) ----------
    let cancelIntro: (() => void) | null = null;
    const endIntro = () => {
      cancelIntro?.();
      cancelIntro = null;
      board.classList.remove('board--intro');
    };
    let introTiming: { step: number; dur: number } | null = null; // tokens never change at runtime: read once, on a level load
    const startIntro = (lit: number[]) => {
      endIntro();
      if (!lit.length || view.reducedMotion()) return;
      board.classList.add('board--intro');
      if (!introTiming) {
        const css = getComputedStyle(board);
        introTiming = { step: ms(css.getPropertyValue('--power-step')), dur: ms(css.getPropertyValue('--dur-power-on')) };
      }
      const last = Math.max(...lit.map((i) => rowOf(i) + colOf(i)));
      const total = last * introTiming.step + introTiming.dur;
      if (clock) cancelIntro = clock.setTimeout(endIntro, Number.isFinite(total) ? total : 450);
    };

    // ---------- moves bump: one animation per change, restarted without a layout read ----------
    let bumpFrame = 0;
    const bump = () => {
      cancelAnimationFrame(bumpFrame);
      if (!movesEl.classList.contains('stat__value--bump')) { movesEl.classList.add('stat__value--bump'); return; }
      movesEl.classList.remove('stat__value--bump');
      bumpFrame = requestAnimationFrame(() => movesEl.classList.add('stat__value--bump'));
    };
    movesEl.addEventListener('animationend', () => movesEl.classList.remove('stat__value--bump'));

    // ---------- render ----------
    let lastStatus: BoardState['status'] | null = null;
    let lastLevel: number | null = null;
    let lastHistory = 0;

    const mark = (attr: string, prev: number, next: number): number => {
      if (prev === next) return prev;
      if (prev >= 0) cells[prev]?.removeAttribute(attr);
      if (next >= 0 && cells[next]) cells[next]!.setAttribute(attr, 'true');
      return cells[next] ? next : -1;
    };
    const setStars = (list: HTMLElement[], on: number) => list.forEach((s, k) => setAttr(s, 'data-state', k < on ? 'on' : 'off'));
    const disable = (el: HTMLElement, off: boolean) => setAttr(el, 'aria-disabled', off ? 'true' : null);

    const renderBoard = (b: BoardState | undefined) => {
      if (!b) return;
      const next = shapeOf(b.shape);
      const rebuilt = !shape || !sameGrid(shape, next);
      if (rebuilt) buildGrid(next);
      const load = rebuilt || b.levelId !== lastLevel;
      // a single new press ripples out from that cell; undo, restart and loads change everything at once
      const pressed = !load && b.history.length === lastHistory + 1 ? b.history.at(-1)! : -1;
      const lit: number[] = [];
      for (const i of real) {
        const on = b.cells[i] ? 1 : 0;
        if (on) lit.push(i);
        if (shown[i] === on) continue;
        const first = shown[i] === -1;
        shown[i] = on;
        const cell = cells[i]!;
        cell.dataset.lit = on ? 'true' : 'false';
        cell.setAttribute('aria-pressed', on ? 'true' : 'false');
        cell.setAttribute('aria-label', on ? labels.on[i]! : labels.off[i]!);
        if (first) continue;
        // the pressed cell answers at once, its neighbours a stagger later; everything else changes together
        const delay = pressed < 0 || i === pressed ? 0 : 1;
        if (delays[i] !== delay) {
          delays[i] = delay;
          cell.style.setProperty('--flip-delay', delay ? 'var(--flip-stagger)' : '0ms');
        }
        if (load) cell.removeAttribute('data-flip'); // a load is the intro's job (C4)
        else cell.setAttribute('data-flip', '');
      }
      if (load && tall) board.scrollTop = 0; // a new level starts at the top of the Tower
      if (load) startIntro(lit);
      else if (cancelIntro || board.classList.contains('board--intro')) endIntro(); // the first press ends the intro
      const solved = b.status === 'solved';
      if (solved && lastStatus === 'playing' && !load) startSweep(b.history.at(-1) ?? real[real.length >> 1]!);
      else if (!solved) stopSweep();
      const moved = !load && movesEl.textContent !== String(b.moves);
      lastStatus = b.status;
      lastLevel = b.levelId;
      lastHistory = b.history.length;
      setAttr(board, 'data-status', solved ? 'solved' : 'playing');
      setText(movesEl, String(b.moves));
      setText(parEl, String(b.par));
      if (moved) bump();
      disable(undo, b.status !== 'playing' || b.history.length === 0);
      disable(restart, b.status === 'empty' || b.moves === 0);
    };

    /** boss levels from the levels slice, gathered once per slice (the header renders on every move) */
    let bosses: { from: LevelsState | undefined; ids: Set<number> } | null = null;
    const isBoss = (levels: LevelsState | undefined, id: number) => {
      if (!bosses || bosses.from !== levels) bosses = { from: levels, ids: new Set(levels?.list.filter((l) => l.boss).map((l) => l.id)) };
      return bosses.ids.has(id);
    };

    const renderHeader = (b: BoardState | undefined, levels: LevelsState | undefined, progress: ProgressState | undefined) => {
      const id = b?.levelId ?? null;
      // a Variety level: the room's name over its place in the room; a classic level: its chapter over its number
      const pack = id === null ? undefined : levels?.packs?.find((p) => p.kind !== 'classic' && id >= p.first && id < p.first + p.count);
      setText(levelText, id === null ? '' : fmt(copy.level, { level: pack ? id - pack.first + 1 : id }));
      const chapter = id === null || pack ? -1 : (levels?.chapters ?? []).findIndex((c) => id >= c.from && id <= c.to);
      const name = pack ? pack.name : chapter < 0 ? '' : fmt(copy.chapter, { chapter: chapter + 1 });
      const boss = id !== null && isBoss(levels, id);
      setText(chapterEl, boss ? fmt(copy.boss, { name }) : name);
      setAttr(header, 'data-boss', boss ? 'true' : null);

      const scoring = progress?.scoring;
      tiersEl.hidden = !scoring || id === null;
      setAttr(slot, 'data-tiers', tiersEl.hidden ? 'false' : 'true');
      if (!scoring || !b || id === null) return;
      const used = progress?.save.pendingHints[String(id)] ?? 0;
      const starsFor = (base: number) => Math.min(3, Math.max(scoring.minStars, base - used * scoring.hintCost));
      const max = starsFor(3);
      setAttr(tiersEl, 'aria-label', fmt(copy.maxAria, { stars: max }));
      hintChip.hidden = used === 0;
      if (used > 0) {
        setText(hintCost, fmt(copy.hintChipCost, { stars: 3 - max }));
        setText(hintWord, fmt(copy.hintChipWord, { count: used }));
        setAttr(hintChip, 'aria-label', fmt(copy.hintChipAria, { stars: 3 - max, count: used }));
      }

      const limits = [b.par + scoring.threeStarsWithin, b.par + scoring.twoStarsWithin, b.par + scoring.twoStarsWithin + 1];
      let now = -1;
      tiers.forEach((t, k) => {
        const over = k === 2;
        t.el.hidden = k === 1 && scoring.twoStarsWithin <= scoring.threeStarsWithin;
        const limit = limits[k]!;
        const n = starsFor(t.base);
        setText(t.label, fmt(over ? copy.tierOver : copy.tierWithin, { moves: limit }));
        setAttr(t.el, 'aria-label', fmt(over ? copy.tierOverAria : copy.tierWithinAria, { moves: limit, stars: n }));
        setStars(t.stars, n);
        const lost = !over && b.moves > limit;
        if (now < 0 && !lost && !t.el.hidden) now = k;
        setAttr(t.el, 'data-state', lost ? 'lost' : now === k ? 'now' : null);
      });
    };

    const renderMarks = (b: BoardState | undefined, hints: HintsState | undefined, tutorial: TutorialState | undefined) => {
      const coaching = tutorial?.status === 'active' && (tutorial.levelId === null || tutorial.levelId === b?.levelId);
      const pointing = coaching && tutorial!.target !== null;
      // the tutorial's ring wins: a hint mark never shares the board with it (both draw on ::before)
      const showing = hints?.status === 'showing' && hints.cell !== null && b?.status === 'playing' && !pointing;
      const before = [hintCell, pointerCell];
      if (pointing) hintCell = mark('data-hint', hintCell, -1);
      pointerCell = mark('data-pointer', pointerCell, pointing ? tutorial!.target! : -1);
      hintCell = mark('data-hint', hintCell, showing ? hints!.cell! : -1);
      // on a scrolling board a new mark is brought into view (never on a normal board: no layout work on a tap)
      const fresh = hintCell >= 0 && hintCell !== before[0] ? hintCell : pointerCell >= 0 && pointerCell !== before[1] ? pointerCell : -1;
      if (tall && fresh >= 0) cells[fresh]!.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: view.reducedMotion() ? 'auto' : 'smooth' });
      hintLine.hidden = !showing;
      setAttr(line, 'data-hint', showing ? 'true' : 'false');
      // first-run focus: while the coach talks, only the board, the ring and one sentence
      setAttr(root, 'data-coaching', coaching ? 'true' : null);
      hintBtn.hidden = !hints;
      disable(hintBtn, !hints || hints.status === 'showing' || b?.status !== 'playing' || coaching);
    };

    // slices are frozen and replaced on change, so identical references mean nothing to do
    let seen: unknown[] = [];
    let headKey = '';
    const render = () => {
      const b = ctx.read('board'), hints = ctx.read('hints'), tutorial = ctx.read('tutorial');
      const levels = ctx.read('levels'), progress = ctx.read('progress');
      const now = [b, hints, tutorial, levels, progress];
      if (now.every((s, k) => s === seen[k])) return;
      if (b !== seen[0]) renderBoard(b);
      renderMarks(b, hints, tutorial);
      // the header only depends on level, moves and par (moves move the "now" tier chip)
      const key = `${b?.levelId}|${b?.moves}|${b?.par}`;
      if (key !== headKey || levels !== seen[3] || progress !== seen[4]) renderHeader(b, levels, progress);
      headKey = key;
      seen = now;
    };
    for (const slice of ['board', 'hints', 'tutorial', 'levels', 'progress'] as const) ctx.watch(slice, render);
    if (!ctx.read('board')) buildGrid(shapeOf(null));
    render();

    return {
      start: render,
      stop: () => {
        aimer.destroy();
        resizes?.disconnect();
        removeEventListener('resize', measureSlot);
        cancelSweep?.();
        cancelIntro?.();
        cancelAnimationFrame(bumpFrame);
        document.removeEventListener('pointerup', release, true);
        document.removeEventListener('pointercancel', release, true);
        document.removeEventListener('keydown', onKey);
      },
      debug: () => ({
        shape: shape ? shapeKey(shape) : null, press: pointerMode() ?? 'instant', hintCell, pointerCell, focusIndex,
        reference: refOpen ? 'open' : 'closed', sweeping: board.classList.contains('board--sweep'), intro: board.classList.contains('board--intro'),
      }),
      commands: {
        /** reference [open|close]: toggles the in-game pattern reference */
        reference(args) {
          setReference(args[0] === 'open' ? true : args[0] === 'close' ? false : !refWanted);
          return `reference ${refWanted ? 'open' : 'closed'}${refWanted === refOpen ? '' : ' (after the current press)'}`;
        },
      },
    };
  },
};
export default playView;
