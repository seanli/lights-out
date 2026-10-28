// In-game pattern reference: fills view.region('slot:reference') (play-view places it).
// Built once; every board change only patches attributes and a few lines of text (well under 1 ms).
// Never marks the main board: the panel teaches the method, the paid Hint stays the only on-board help.
// Classic 5×5: live advice, live bottom row, the 7-row table; the matching row's echo and rule in one line.
// Other full rectangles: chase advice for that size, no table. Shaped rooms: one line about using the shape.
import { BOTTOM, blank, rectTaps, rectTopSets, type TableEntry } from './method';
import { CELL_COUNT, SIZE, type BoardState, type Ctx, type Shape, type SolverService } from '../../contracts';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import { shapeKey } from '../../lib/shape';

export interface ReferenceCopy {
  yourRow: string;
  bottom: string;
  top: string;
  echo: string;
  lessons: string;
  shaped: string;
  status: { start: string; chase: string; match: string; progress: string; clear: string; nomatch: string; rectBottom: string; rectMatch: string };
  /** the strategy line for full rectangles: chase alone clears it / three above each light / each light its own taps */
  rect: { chaseClears: string; threeAbove: string; ownTaps: string };
}

export type ReferenceStatus = 'chase' | 'match' | 'nomatch' | 'clear';
export type BoardKind = 'classic' | 'rect' | 'shaped';
export interface Advice {
  status: ReferenceStatus; text: string; match: number;
  /** full rectangles at bottom-row time: the player's bottom row and the top-row taps that clear it */
  rect?: { bottom: number[]; taps: number[] };
}

const ABOVE_BOTTOM = (1 << BOTTOM) - 1;
const toMask = (cells: readonly boolean[]) => { let m = 0; for (let i = 0; i < CELL_COUNT; i++) if (cells[i]) m |= 1 << i; return m; };
const rowMask = (cols: readonly number[]) => cols.reduce((m, c) => m | (1 << c), 0);

/** classic = no shape (or 5×5 without gaps); rect = any other full rectangle; shaped = a mask with gaps */
export function kindOf(shape: Shape | undefined): BoardKind {
  if (!shape) return 'classic';
  if (shape.mask && shape.mask.some((m) => !m)) return 'shaped';
  return shape.cols === SIZE && shape.rows === SIZE ? 'classic' : 'rect';
}

type Board = Pick<BoardState, 'status' | 'cells'> & { shape?: Shape };

/** What to do next, from the board alone. Pure, so tests can check it without a DOM. */
export function createAdvisor(solver: Pick<SolverService, 'press'>, table: readonly TableEntry[], copy: ReferenceCopy['status'], shapedLine = '') {
  // what each top-row tap toggles, read from the solver once
  const topPress = Array.from({ length: SIZE }, (_, c) => toMask(solver.press(blank(), c)));
  const entries = table.map((e) => ({ bottom: rowMask(e.bottom), top: rowMask(e.top) }));
  const byBottom = new Map(entries.map((e, k) => [e.bottom, k]));

  const classic = (m: number): Advice => {
    // part-way through a table row's top taps? (board = that bottom row + some of its taps)
    for (let t = 1; t < 1 << SIZE; t++) {
      let before = m;
      for (let c = 0; c < SIZE; c++) if ((t >> c) & 1) before ^= topPress[c]!;
      if (before === 0 || before & ABOVE_BOTTOM) continue;
      const k = byBottom.get(before >>> BOTTOM);
      if (k !== undefined && (t & ~entries[k]!.top) === 0 && t !== entries[k]!.top) return { status: 'match', text: copy.progress, match: k };
    }
    if (m & ABOVE_BOTTOM) {
      const row = Math.floor((31 - Math.clz32(m & -m)) / SIZE) + 1;
      return { status: 'chase', text: fmt(copy.chase, { row }), match: -1 };
    }
    const k = byBottom.get(m >>> BOTTOM);
    return k === undefined ? { status: 'nomatch', text: copy.nomatch, match: -1 } : { status: 'match', text: copy.match, match: k };
  };

  /** per full-rectangle shape: each bottom light's top-row taps (from the solver, once per shape) */
  const rectSets = new Map<string, ReturnType<typeof rectTopSets>>();
  const setsFor = (shape: Shape) => {
    const key = shapeKey(shape);
    let sets = rectSets.get(key);
    if (!sets) { sets = rectTopSets(solver, shape as Shape & { mask: null }); rectSets.set(key, sets); }
    return sets;
  };

  /** any full rectangle: chase row by row; at bottom-row time, each lit bottom light's top taps (overlaps cancel) */
  const rect = (cells: readonly boolean[], shape: Shape): Advice => {
    const { cols, rows } = shape;
    const bottomOf = () => { const out: number[] = []; for (let c = 0; c < cols; c++) if (cells[(rows - 1) * cols + c]) out.push(c); return out; };
    // part-way through the top taps? rows 0–1 hold exactly the taps' pattern, nothing else above the bottom row
    let mid = false;
    for (let i = 2 * cols; i < (rows - 1) * cols; i++) if (cells[i]) { mid = true; break; }
    if (!mid && rows > 2) {
      let tapped = 0, row0 = 0;
      for (let c = 0; c < cols; c++) { if (cells[cols + c]) tapped |= 1 << c; if (cells[c]) row0 |= 1 << c; }
      const spread = (tapped ^ (tapped << 1) ^ (tapped >> 1)) & ((1 << cols) - 1);
      const bottom = bottomOf();
      if (tapped && row0 === spread && bottom.length) {
        const taps = rectTaps(setsFor(shape).perLight, bottom);
        const want = taps ? taps.reduce((m, c) => m | (1 << c), 0) : 0;
        if (taps && (tapped & ~want) === 0 && tapped !== want) return { status: 'match', text: copy.progress, match: -1, rect: { bottom, taps } };
      }
    }
    const first = cells.indexOf(true);
    const row = Math.floor(first / cols);
    if (row < rows - 1) return { status: 'chase', text: fmt(copy.chase, { row: row + 1 }), match: -1 };
    const bottom = bottomOf();
    const taps = rectTaps(setsFor(shape).perLight, bottom);
    if (!taps) return { status: 'nomatch', text: copy.rectBottom, match: -1 };
    return { status: 'match', text: copy.rectMatch, match: -1, rect: { bottom, taps } };
  };

  /** the strategy line for a full rectangle, read from its per-light sets */
  const rectLine = (shape: Shape, lines: ReferenceCopy['rect']): string => {
    const { perLight, chaseClears } = setsFor(shape);
    if (chaseClears) return fmt(lines.chaseClears, { cols: shape.cols, rows: shape.rows });
    const threeAbove = perLight.every((set, c) => set !== null && set.join() === [c - 1, c, c + 1].filter((x) => x >= 0 && x < shape.cols).join());
    return threeAbove ? lines.threeAbove : lines.ownTaps;
  };

  const advise = (board: Board | undefined): Advice => {
    if (!board || board.status === 'empty') return { status: 'chase', text: copy.start, match: -1 };
    if (board.status === 'solved' || !board.cells.includes(true)) return { status: 'clear', text: copy.clear, match: -1 };
    const kind = kindOf(board.shape);
    if (kind === 'shaped') return { status: 'nomatch', text: shapedLine, match: -1 };
    if (kind === 'rect') return rect(board.cells, board.shape!);
    return classic(toMask(board.cells));
  };
  return Object.assign(advise, { rectLine });
}

/** teal stays the paid Hint's colour: the panel speaks in the coach tone, warm when a row matches */
const TONE: Record<ReferenceStatus, string> = { chase: 'coach', match: 'match', clear: 'coach', nomatch: 'warn' };

export interface ReferenceLabels {
  /** "B" / "A + D" for a table row's top taps */
  echo: (top: readonly number[]) => string;
  /** column letters, A first */
  letters: string;
}

export function createReference(ctx: Ctx, solver: SolverService, table: readonly TableEntry[], copy: ReferenceCopy, labels: ReferenceLabels) {
  const slot = ctx.need('view').region('slot:reference');
  const advise = createAdvisor(solver, table, copy.status, copy.shaped);

  /** a strip of n cells; on a top strip the cells to tap carry the pointer ring and their column letter */
  const strip = (kind: 'bottom' | 'top' | 'live', cols: readonly number[], n = SIZE) => {
    const r = h('span', { class: `learn-row learn-row--${kind}`, 'aria-hidden': 'true', style: n === SIZE ? null : `--strip-n:${n}` });
    for (let c = 0; c < n; c++) {
      const tap = kind === 'top' && cols.includes(c);
      r.append(h('span', {
        class: 'cell', 'data-mini-cell': '', 'data-index': (kind === 'top' ? 0 : BOTTOM) + c,
        'data-lit': String(kind === 'bottom' && cols.includes(c)), 'data-suggest': tap ? 'true' : null, 'data-letter': tap ? labels.letters[c] : null,
      }));
    }
    return r;
  };
  /** retarget a strip's cells (lit for a bottom strip, pointer + letter for a top strip) */
  const paintStrip = (el: HTMLElement, kind: 'bottom' | 'top', cols: readonly number[]) => {
    [...el.children].forEach((cell, c) => {
      setAttr(cell, 'data-lit', String(kind === 'bottom' && cols.includes(c)));
      setAttr(cell, 'data-suggest', kind === 'top' && cols.includes(c) ? 'true' : null);
      setAttr(cell, 'data-letter', kind === 'top' && cols.includes(c) ? labels.letters[c]! : null);
    });
  };

  const status = h('p', { class: 'reference__status', 'data-reference-status': 'chase', role: 'status', 'aria-live': 'polite' });
  const rule = h('p', { class: 'reference__rule', 'data-reference-rule': '', hidden: true });
  const live = strip('live', []);
  live.setAttribute('data-reference-bottom', '');
  const rows = table.map((e) =>
    h('div', { class: 'reference__row', 'data-pattern-row': '', 'data-pattern': e.bottom.join(','), 'data-match': 'false' },
      strip('bottom', e.bottom), h('span', { class: 'learn-table__arrow', 'aria-hidden': 'true' }, '→'), strip('top', e.top)));
  // the matching row's one line: "Echo of B"
  const ruleOf = table.map((e) => fmt(copy.echo, { name: labels.echo(e.top) }));
  // full rectangles at bottom-row time: your bottom row, and the top lights to tap (rebuilt when the width changes)
  const rectBottom = h('div', { class: 'reference__you' }, h('span', { class: 'caption' }, copy.yourRow));
  const rectTop = h('div', { class: 'reference__you' }, h('span', { class: 'caption' }, copy.top));
  const rectBox = h('div', { class: 'reference__rect', hidden: true }, rectBottom, rectTop);
  let rectCols = 0;
  const tableEl = h('div', { class: 'reference__table', role: 'table' },
    h('div', { class: 'reference__head', role: 'row' },
      h('span', { class: 'caption', role: 'columnheader' }, copy.bottom), h('span', { 'aria-hidden': 'true' }), h('span', { class: 'caption', role: 'columnheader' }, copy.top),
      // repeated over the second column of rows when the panel is wide
      h('span', { class: 'caption reference__head2', 'aria-hidden': 'true' }, copy.bottom), h('span', { class: 'reference__head2', 'aria-hidden': 'true' }),
      h('span', { class: 'caption reference__head2', 'aria-hidden': 'true' }, copy.top)),
    ...rows);
  const root = h('div', { class: 'reference', 'data-reference': '', 'data-reference-kind': 'classic' },
    // status and rule stay pinned at the top while the table scrolls under them
    h('div', { class: 'reference__pin' },
      h('div', { class: 'reference__top' },
        status,
        h('button', { class: 'btn btn--ghost reference__lessons', type: 'button', 'data-action': 'learn', onclick: () => ctx.emit('learn:open', {}) }, copy.lessons),
        rule)),
    h('div', { class: 'reference__you' }, h('span', { class: 'caption' }, copy.yourRow), live),
    tableEl,
    rectBox,
  );
  slot.replaceChildren(root);
  const liveCells = [...live.children] as HTMLElement[];

  // ---- scrolling: keep the matching row in view, and fade the bottom edge while more is below ----
  let matched = -1;
  const reveal = () => {
    if (matched < 0) return;
    const target = rows[matched]!.firstElementChild as HTMLElement | null; // rows are display: contents
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  const fade = () => setAttr(root, 'data-overflow', String(root.scrollHeight - root.scrollTop - root.clientHeight > 2));
  root.addEventListener('scroll', fade, { passive: true });
  // fires when the panel opens (display: none → a size) and on every resize: re-check the fade, re-show the match
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { fade(); reveal(); }) : null;
  observer?.observe(root);

  const update = (board: BoardState | undefined) => {
    const kind = kindOf(board?.shape);
    const a = advise(board);
    setAttr(root, 'data-reference-kind', kind);
    setAttr(status, 'data-reference-status', a.status);
    setAttr(status, 'data-tone', kind === 'classic' || a.status !== 'nomatch' ? TONE[a.status] : 'coach');
    setText(status, a.text);
    const classic = kind === 'classic';
    for (let c = 0; c < SIZE; c++) setAttr(liveCells[c]!, 'data-lit', String(classic && !!board?.cells[BOTTOM + c]));
    const match = classic ? a.match : -1;
    rows.forEach((r, k) => setAttr(r, 'data-match', String(k === match)));
    setAttr(root, 'data-matched', String(match >= 0 || !!a.rect));
    // full rectangles: the strip pair at bottom-row time
    rectBox.hidden = !a.rect;
    if (a.rect && board?.shape) {
      const n = board.shape.cols;
      if (n !== rectCols) {
        rectCols = n;
        rectBottom.replaceChildren(rectBottom.firstChild!, strip('bottom', [], n));
        rectTop.replaceChildren(rectTop.firstChild!, strip('top', [], n));
      }
      paintStrip(rectBottom.lastElementChild as HTMLElement, 'bottom', a.rect.bottom);
      paintStrip(rectTop.lastElementChild as HTMLElement, 'top', a.rect.taps);
    }
    const line = match >= 0 ? ruleOf[match]! : kind === 'rect' && board?.shape ? advise.rectLine(board.shape, copy.rect) : '';
    rule.hidden = !line;
    setText(rule, line);
    if (match !== matched) {
      matched = match;
      reveal();
    }
  };
  ctx.watch('board', update);
  update(ctx.read('board'));
  return { advise, stop: () => observer?.disconnect() };
}

