// In-game pattern reference: fills view.region('slot:reference') (play-view places it).
// Built once; every board change only patches attributes and two lines of text (well under 1 ms).
// Never marks the main board: the panel teaches the method, the paid Hint stays the only on-board help.
import { BOTTOM, blank, type TableEntry } from './method';
import { CELL_COUNT, SIZE, type BoardState, type Ctx, type SolverService } from '../../contracts';
import { fmt, h, setAttr, setText } from '../../lib/dom';

export interface ReferenceCopy {
  chase: string;
  yourRow: string;
  bottom: string;
  top: string;
  lessons: string;
  status: { start: string; chase: string; match: string; progress: string; clear: string; nomatch: string };
}

export type ReferenceStatus = 'chase' | 'match' | 'nomatch' | 'clear';
export interface Advice { status: ReferenceStatus; text: string; match: number }

const ABOVE_BOTTOM = (1 << BOTTOM) - 1;
const toMask = (cells: readonly boolean[]) => { let m = 0; for (let i = 0; i < CELL_COUNT; i++) if (cells[i]) m |= 1 << i; return m; };
const rowMask = (cols: readonly number[]) => cols.reduce((m, c) => m | (1 << c), 0);

/** What to do next, from the board alone. Pure, so tests can check it without a DOM. */
export function createAdvisor(solver: Pick<SolverService, 'press'>, table: readonly TableEntry[], copy: ReferenceCopy['status']) {
  // what each top-row tap toggles, read from the solver once
  const topPress = Array.from({ length: SIZE }, (_, c) => toMask(solver.press(blank(), c)));
  const entries = table.map((e) => ({ bottom: rowMask(e.bottom), top: rowMask(e.top) }));
  const byBottom = new Map(entries.map((e, k) => [e.bottom, k]));

  return (board: Pick<BoardState, 'status' | 'cells'> | undefined): Advice => {
    if (!board || board.status === 'empty') return { status: 'chase', text: copy.start, match: -1 };
    const m = toMask(board.cells);
    if (m === 0 || board.status === 'solved') return { status: 'clear', text: copy.clear, match: -1 };
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
}

const TONE: Record<ReferenceStatus, string> = { chase: 'coach', match: 'hint', clear: 'coach', nomatch: 'warn' };

export function createReference(ctx: Ctx, solver: SolverService, table: readonly TableEntry[], copy: ReferenceCopy) {
  const slot = ctx.need('view').region('slot:reference');
  const advise = createAdvisor(solver, table, copy.status);

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
  const live = strip('live', []);
  live.setAttribute('data-reference-bottom', '');
  const rows = table.map((e) =>
    h('div', { class: 'reference__row', 'data-pattern-row': '', 'data-pattern': e.bottom.join(','), 'data-match': 'false' },
      strip('bottom', e.bottom), h('span', { class: 'learn-table__arrow', 'aria-hidden': 'true' }, '→'), strip('top', e.top)));
  const root = h('div', { class: 'reference', 'data-reference': '' },
    h('div', { class: 'reference__top' },
      status,
      h('button', { class: 'btn btn--ghost reference__lessons', type: 'button', 'data-action': 'learn', onclick: () => ctx.emit('learn:open', {}) }, copy.lessons)),
    h('p', { class: 'reference__chase' }, copy.chase),
    h('div', { class: 'reference__you' }, h('span', { class: 'caption' }, copy.yourRow), live),
    h('div', { class: 'reference__table', role: 'table' },
      h('div', { class: 'reference__head', role: 'row' },
        h('span', { class: 'caption', role: 'columnheader' }, copy.bottom), h('span', { 'aria-hidden': 'true' }), h('span', { class: 'caption', role: 'columnheader' }, copy.top),
        // repeated over the second column of rows when the panel is wide
        h('span', { class: 'caption reference__head2', 'aria-hidden': 'true' }, copy.bottom), h('span', { class: 'reference__head2', 'aria-hidden': 'true' }), h('span', { class: 'caption reference__head2', 'aria-hidden': 'true' }, copy.top)),
      ...rows),
  );
  slot.replaceChildren(root);
  const liveCells = [...live.children] as HTMLElement[];

  const update = (board: BoardState | undefined) => {
    const a = advise(board);
    setAttr(status, 'data-reference-status', a.status);
    setAttr(status, 'data-tone', TONE[a.status]);
    setText(status, a.text);
    for (let c = 0; c < SIZE; c++) setAttr(liveCells[c]!, 'data-lit', String(!!board?.cells[BOTTOM + c]));
    rows.forEach((r, k) => setAttr(r, 'data-match', String(k === a.match)));
  };
  ctx.watch('board', update);
  update(ctx.read('board'));
  return { advise };
}
