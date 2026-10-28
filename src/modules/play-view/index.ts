// play-view: the play screen. Renders the board, hints, tutorial and progress slices and turns taps into commands.
// The DOM is built once; every change only touches the attributes and text that differ.
import * as v from 'valibot';
import { CELL_COUNT, SIZE, type BoardState, type HintsState, type LevelsState, type ModuleDef, type ProgressState, type TutorialState } from '../../contracts';
import { flip, measure } from './flip';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import './play-view.css';

const text = v.pipe(v.string(), v.minLength(1));
const CopySchema = v.object({
  chapter: text, level: text, moves: text, par: text, undo: text, restart: text, hint: text, hintCost: text,
  back: text, patterns: text, board: text, maxStars: text, hintUsed: text, maxAria: text, hintLine: text,
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

const rowOf = (i: number) => (i / SIZE) | 0;
const colOf = (i: number) => i % SIZE;
const ARROWS: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/** a CSS time token in ms ("800ms" / ".8s"), or NaN */
function ms(value: string): number {
  const n = parseFloat(value);
  return /ms\s*$/.test(value) ? n : /s\s*$/.test(value) ? n * 1000 : NaN;
}

const playView: ModuleDef = {
  manifest: {
    name: 'play-view',
    emits: ['board:press', 'board:undo', 'board:restart', 'hints:request', 'nav:go'],
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
    const levelEl = h('strong', { 'data-level-label': '' });
    const maxStars = stars(3);
    const maxUsed = h('span', { class: 'caption', hidden: true }, copy.hintUsed);
    const maxBox = h('div', { class: 'play-max', role: 'img' }, h('span', { class: 'caption' }, copy.maxStars), starRow('stars--md', maxStars), maxUsed);
    const refBtn = h('button', {
      class: 'btn btn--icon', type: 'button', 'data-action': 'reference', 'aria-label': copy.patterns, title: copy.patterns,
      'aria-expanded': 'false', 'aria-controls': 'play-reference', hidden: true,
    }, icon(ICON.book));
    const header = h('header', { class: 'screen-header' },
      back,
      h('div', { class: 'screen-header__title' }, chapterEl, levelEl),
      h('div', { class: 'screen-header__end play-head-end' }, maxBox, refBtn));

    const movesEl = h('span', { class: 'stat__value', 'data-moves': '' }, '0');
    const parEl = h('span', { class: 'stat__value', 'data-par': '' }, '0');
    const stats = h('div', { class: 'play-stats' },
      h('div', { class: 'stat' }, h('span', { class: 'eyebrow' }, copy.moves), movesEl),
      h('div', { class: 'stat stat--end stat--muted' }, h('span', { class: 'eyebrow' }, copy.par), parEl));

    const tiers = [3, 2, 1].map((base) => {
      const label = h('span', {});
      const list = stars(3);
      const el = h('span', { class: 'chip', role: 'listitem' }, label, starRow('stars--xs', list));
      return { base, el, label, stars: list };
    });
    const tiersEl = h('div', { class: 'play-tiers', role: 'list' }, ...tiers.map((t) => t.el));

    const labels = { on: [] as string[], off: [] as string[] };
    const board = h('div', { class: 'board', 'data-board': '', 'data-status': 'playing', role: 'group', 'aria-label': copy.board });
    const cells: HTMLButtonElement[] = [];
    for (let i = 0; i < CELL_COUNT; i++) {
      const pos = { row: rowOf(i) + 1, col: colOf(i) + 1 };
      labels.on.push(fmt(copy.cellOn, pos));
      labels.off.push(fmt(copy.cellOff, pos));
      const cell = h('button', {
        class: 'cell', type: 'button', 'data-cell': '', 'data-index': i, 'data-lit': 'false',
        'aria-pressed': 'false', 'aria-label': labels.off[i], tabindex: i === 0 ? '0' : '-1',
      });
      cell.style.setProperty('--i', String(rowOf(i) + colOf(i)));
      cells.push(cell);
      board.append(cell);
    }

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

    // ---------- input ----------
    const press = (index: number) => {
      if (ctx.read('board')?.status !== 'playing') return; // solved / sweeping: taps do nothing
      ctx.emit('board:press', { index });
    };
    const cellIndex = (target: EventTarget | null): number => {
      const el = (target as Element | null)?.closest?.('[data-cell]') as HTMLElement | null | undefined;
      return el && board.contains(el) ? Number(el.dataset.index) : -1;
    };
    /** cells pressed on pointerdown whose trailing click must be swallowed */
    const pending = new Uint8Array(CELL_COUNT);
    board.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // primary mouse button; every touch/pen contact is button 0
      const i = cellIndex(e.target);
      if (i < 0) return;
      pending[i] = 1;
      press(i);
    });
    board.addEventListener('click', (e) => {
      const i = cellIndex(e.target);
      if (i < 0) return;
      if (e.detail === 0) return press(i); // keyboard (Enter/Space) or assistive tech
      if (pending[i]) { pending[i] = 0; return; } // already pressed on pointerdown
      press(i); // a click with no pointerdown before it
    });
    let focusIndex = 0;
    const rove = (i: number) => {
      if (i === focusIndex) return;
      cells[focusIndex]!.tabIndex = -1;
      cells[i]!.tabIndex = 0;
      focusIndex = i;
    };
    board.addEventListener('focusin', (e) => { const i = cellIndex(e.target); if (i >= 0) rove(i); });
    board.addEventListener('keydown', (e) => {
      const i = cellIndex(e.target);
      if (i < 0) return;
      let next = -1;
      const step = ARROWS[e.key];
      if (step) {
        const r = rowOf(i) + step[0], c = colOf(i) + step[1];
        next = r >= 0 && r < SIZE && c >= 0 && c < SIZE ? r * SIZE + c : i;
      } else if (e.key === 'Home') next = rowOf(i) * SIZE;
      else if (e.key === 'End') next = rowOf(i) * SIZE + SIZE - 1;
      if (next < 0) return;
      e.preventDefault();
      rove(next);
      cells[next]!.focus();
    });
    board.addEventListener('contextmenu', (e) => e.preventDefault());
    board.addEventListener('touchstart', () => {}, { passive: true }); // lets iOS apply :active on the cells

    const onAction = (el: HTMLButtonElement, fn: () => void) =>
      el.addEventListener('click', () => { if (el.getAttribute('aria-disabled') !== 'true') fn(); });
    onAction(back, () => ctx.emit('nav:go', { screen: 'home' }));
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
    const stopSweep = () => {
      cancelAnimationFrame(sweepFrame);
      cancelSweep?.();
      cancelSweep = null;
      if (!board.classList.contains('board--sweep')) return;
      board.classList.remove('board--sweep');
      cells.forEach((c, i) => c.style.setProperty('--i', String(rowOf(i) + colOf(i))));
    };
    /** a ripple from the winning tap: each cell waits by its distance, scaled so the farthest one ends on --dur-sweep */
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
        const dist = cells.map((_, i) => Math.hypot(rowOf(i) - rowOf(origin), colOf(i) - colOf(origin)));
        const far = Math.max(...dist) || 1;
        const scale = Number.isFinite(span) && span > 0 ? span / far : 1;
        cells.forEach((c, i) => c.style.setProperty('--i', (dist[i]! * scale).toFixed(2)));
        board.classList.add('board--sweep');
        if (clock && Number.isFinite(total)) cancelSweep = clock.setTimeout(stopSweep, total);
      });
    };

    // ---------- render ----------
    const shown = new Int8Array(CELL_COUNT).fill(-1);
    let lastStatus: BoardState['status'] | null = null;
    let lastLevel: number | null = null;
    let hintCell = -1;
    let pointerCell = -1;

    const mark = (attr: string, prev: number, next: number): number => {
      if (prev === next) return prev;
      if (prev >= 0) cells[prev]!.removeAttribute(attr);
      if (next >= 0) cells[next]!.setAttribute(attr, 'true');
      return next;
    };
    const setStars = (list: HTMLElement[], on: number) => list.forEach((s, k) => setAttr(s, 'data-state', k < on ? 'on' : 'off'));
    const disable = (el: HTMLElement, off: boolean) => setAttr(el, 'aria-disabled', off ? 'true' : null);

    const renderBoard = (b: BoardState | undefined) => {
      if (!b) return;
      for (let i = 0; i < CELL_COUNT; i++) {
        const lit = b.cells[i] ? 1 : 0;
        if (shown[i] === lit) continue;
        shown[i] = lit;
        const cell = cells[i]!;
        cell.dataset.lit = lit ? 'true' : 'false';
        cell.setAttribute('aria-pressed', lit ? 'true' : 'false');
        cell.setAttribute('aria-label', lit ? labels.on[i]! : labels.off[i]!);
      }
      const solved = b.status === 'solved';
      if (solved && lastStatus === 'playing' && lastLevel === b.levelId) startSweep(b.history.at(-1) ?? (CELL_COUNT >> 1));
      else if (!solved) stopSweep();
      lastStatus = b.status;
      lastLevel = b.levelId;
      setAttr(board, 'data-status', solved ? 'solved' : 'playing');
      setText(movesEl, String(b.moves));
      setText(parEl, String(b.par));
      disable(undo, b.status !== 'playing' || b.history.length === 0);
      disable(restart, b.status === 'empty' || b.moves === 0);
    };

    const renderHeader = (b: BoardState | undefined, levels: LevelsState | undefined, progress: ProgressState | undefined) => {
      const id = b?.levelId ?? null;
      setText(levelEl, id === null ? '' : fmt(copy.level, { level: id }));
      const chapter = id === null ? -1 : (levels?.chapters ?? []).findIndex((c) => id >= c.from && id <= c.to);
      setText(chapterEl, chapter < 0 ? '' : fmt(copy.chapter, { chapter: chapter + 1 }));

      const scoring = progress?.scoring;
      maxBox.hidden = !scoring || id === null;
      tiersEl.hidden = !scoring || id === null;
      setAttr(slot, 'data-tiers', tiersEl.hidden ? 'false' : 'true');
      if (!scoring || !b || id === null) return;
      const used = progress?.save.pendingHints[String(id)] ?? 0;
      const starsFor = (base: number) => Math.min(3, Math.max(scoring.minStars, base - used * scoring.hintCost));
      const max = starsFor(3);
      setStars(maxStars, max);
      maxUsed.hidden = used === 0;
      setAttr(maxBox, 'aria-label', fmt(copy.maxAria, { stars: max }));

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
      const coaching = tutorial?.status === 'active';
      const pointing = coaching && tutorial!.target !== null && (tutorial!.levelId === null || tutorial!.levelId === b?.levelId);
      // the tutorial's ring wins: a hint mark never shares the board with it (both draw on ::before)
      const showing = hints?.status === 'showing' && hints.cell !== null && b?.status === 'playing' && !pointing;
      if (pointing) hintCell = mark('data-hint', hintCell, -1);
      pointerCell = mark('data-pointer', pointerCell, pointing ? tutorial!.target! : -1);
      hintCell = mark('data-hint', hintCell, showing ? hints!.cell! : -1);
      hintLine.hidden = !showing;
      setAttr(line, 'data-hint', showing ? 'true' : 'false');
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
    render();

    return {
      start: render,
      stop: () => {
        cancelSweep?.();
        document.removeEventListener('pointerup', release, true);
        document.removeEventListener('pointercancel', release, true);
        document.removeEventListener('keydown', onKey);
      },
      debug: () => ({ hintCell, pointerCell, focusIndex, reference: refOpen ? 'open' : 'closed', sweeping: board.classList.contains('board--sweep') }),
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
