// In-game pattern reference: fills view.region('slot:reference') (play-view places it).
// Built once; every board change only patches attributes and a few lines of text (well under 1 ms).
// Never marks the main board: the panel teaches the method, the paid Hint stays the only on-board help.
// Classic 5×5: live advice, live bottom row, the 7-row table; the matching row's echo and rule in one line.
// Other full rectangles: chase advice for that size, no table. Shaped rooms: one line about using the shape.
import { BOTTOM, blank, type TableEntry } from './method';
import { ruleFor } from './lessons';
import { CELL_COUNT, SIZE, type BoardState, type Ctx, type Shape, type SolverService } from '../../contracts';
import { fmt, h, setAttr, setText } from '../../lib/dom';

export interface ReferenceCopy {
  yourRow: string;
  bottom: string;
  top: string;
  echo: string;
  lessons: string;
  shaped: string;
  status: { start: string; chase: string; match: string; progress: string; clear: string; nomatch: string; rectBottom: string };
}

export type ReferenceStatus = 'chase' | 'match' | 'nomatch' | 'clear';
export type BoardKind = 'classic' | 'rect' | 'shaped';
export interface Advice { status: ReferenceStatus; text: string; match: number }

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

  /** any full rectangle: chase row by row; a lit bottom row has no table here, so it is worked out (or hinted) */
  const rect = (cells: readonly boolean[], shape: Shape): Advice => {
    const first = cells.indexOf(true);
    const row = Math.floor(first / shape.cols);
    if (row < shape.rows - 1) return { status: 'chase', text: fmt(copy.chase, { row: row + 1 }), match: -1 };
    return { status: 'nomatch', text: fmt(copy.rectBottom, { cols: shape.cols, rows: shape.rows }), match: -1 };
  };

  return (board: Board | undefined): Advice => {
    if (!board || board.status === 'empty') return { status: 'chase', text: copy.start, match: -1 };
    if (board.status === 'solved' || !board.cells.includes(true)) return { status: 'clear', text: copy.clear, match: -1 };
    const kind = kindOf(board.shape);
    if (kind === 'shaped') return { status: 'nomatch', text: shapedLine, match: -1 };
    if (kind === 'rect') return rect(board.cells, board.shape!);
    return classic(toMask(board.cells));
  };
}

const TONE: Record<ReferenceStatus, string> = { chase: 'coach', match: 'hint', clear: 'coach', nomatch: 'warn' };

export interface ReferenceLabels {
  /** "echo of B" / "echoes A + D" for a table row */
  echo: (top: readonly number[]) => string;
  /** the remembered rule for a bottom row, or '' */
  rule: (bottom: readonly number[]) => string;
}

export function createReference(ctx: Ctx, solver: SolverService, table: readonly TableEntry[], copy: ReferenceCopy, labels: ReferenceLabels) {
  const slot = ctx.need('view').region('slot:reference');
  const advise = createAdvisor(solver, table, copy.status, copy.shaped);

  const strip = (kind: 'bottom' | 'top' | 'live', cols: readonly number[]) => {
    const r = h('span', { class: `learn-row learn-row--${kind}`, 'aria-hidden': 'true' });
    for (let c = 0; c < SIZE; c++) {
      r.append(h('span', {
        class: 'cell', 'data-mini-cell': '', 'data-index': (kind === 'top' ? 0 : BOTTOM) + c,
        'data-lit': String(kind === 'bottom' && cols.includes(c)), 'data-suggest': kind === 'top' && cols.includes(c) ? 'true' : null,
      }));
    }
    return r;
  };

  const status = h('p', { class: 'reference__status', 'data-reference-status': 'chase', role: 'status', 'aria-live': 'polite' });
  const rule = h('p', { class: 'reference__rule', 'data-reference-rule': '', hidden: true });
  const live = strip('live', []);
  live.setAttribute('data-reference-bottom', '');
  const rows = table.map((e) =>
    h('div', { class: 'reference__row', 'data-pattern-row': '', 'data-pattern': e.bottom.join(','), 'data-match': 'false' },
      strip('bottom', e.bottom), h('span', { class: 'learn-table__arrow', 'aria-hidden': 'true' }, '→'), strip('top', e.top)));
  // the matching row's one line: "Echo of B · Three in a row: tap above the middle one."
  const ruleOf = table.map((e) => [`${copy.echo} ${labels.echo(e.top)}`, labels.rule(e.bottom)].filter(Boolean).join(' · '));
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
    setAttr(root, 'data-matched', String(match >= 0));
    const line = match >= 0 ? ruleOf[match]! : '';
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

export { ruleFor };
