// Lesson 4's echo steps and the "Go deeper" extras: stacked echoes, the five rules, how an echo forms,
// and the "whose echo is this?" drill. Every row shown is computed from the solver (method.ts).
import { SIZE, type Rng, type SolverService } from '../../contracts';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import type { LearnCopy, LearnRules } from './index';
import { RULES } from './lessons';
import { BOTTOM, clearsBottom, echoOf, echoOfSet, echoRows, type TableEntry } from './method';
import { answer, emptySave, finished, nextCard, planRound, type DrillSave, type Round } from './drill';

export interface DrillStore { load(): DrillSave; save(s: DrillSave): void }

/** a strip of `n` cells (default 5); `lit` columns glow, `ring` columns get the tap pointer and their letter, `cancel` columns the cancel mark */
export function strip(opts: { lit?: readonly number[]; ring?: readonly number[]; cancel?: readonly number[]; row?: 'top' | 'bottom'; kind?: string; letters?: string; n?: number; bottom?: number }) {
  const n = opts.n ?? SIZE;
  const r = h('span', { class: `learn-row learn-row--${opts.kind ?? 'bottom'}`, 'aria-hidden': 'true', style: n === SIZE ? null : `--strip-n:${n}` });
  const base = opts.row === 'top' ? 0 : (opts.bottom ?? BOTTOM);
  for (let c = 0; c < n; c++) {
    r.append(h('span', {
      class: 'cell', 'data-mini-cell': '', 'data-index': base + c,
      'data-lit': String(!!opts.lit?.includes(c)),
      'data-suggest': opts.ring?.includes(c) ? 'true' : null,
      'data-letter': opts.ring?.includes(c) && opts.letters ? opts.letters[c] : null,
      'data-cancel': opts.cancel?.includes(c) ? 'true' : null,
    }));
  }
  return r;
}

export const names = (copy: LearnCopy, cols: readonly number[]) => cols.map((c) => copy.letters[c]).join(copy.echoJoin);

/** A–E buttons, one over each board column; `onPick(col)`; the chosen one is aria-pressed */
export function picker(copy: LearnCopy, chosen: number, onPick: (col: number) => void) {
  const row = h('div', { class: 'learn-picker', role: 'group', 'aria-label': copy.echo.pick });
  const buttons = [...copy.letters.slice(0, SIZE)].map((l, c) =>
    h('button', { class: 'btn btn--ghost learn-pick', type: 'button', 'data-action': 'learn-echo', 'data-col': c, 'aria-pressed': String(c === chosen), onclick: () => pick(c) }, l));
  const pick = (c: number) => { buttons.forEach((b, k) => setAttr(b, 'aria-pressed', String(k === c))); onPick(c); };
  row.append(...buttons);
  return row;
}

/** two echoes stacked: each pair shows echo X, echo Y and both together, with the cancelled spots marked */
export function stackView(copy: LearnCopy, solver: Pick<SolverService, 'press'>, pairs: readonly [number, number][]) {
  const groups = pairs.map(([a, b]) => {
    const ea = echoOf(solver, a), eb = echoOf(solver, b);
    const both = echoOfSet(solver, [a, b]);
    const cancel = ea.filter((c) => eb.includes(c));
    const label = (text: string) => h('span', { class: 'caption learn-stack__label' }, text);
    // one grid per pair, so the labels and strips line up
    return h('div', { class: 'learn-stack__group', 'data-stack': `${a},${b}` },
      label(fmt(copy.stack.of, { name: copy.letters[a]! })), strip({ lit: ea }),
      label(fmt(copy.stack.of, { name: copy.letters[b]! })), strip({ lit: eb }),
      h('i', { class: 'learn-stack__rule', 'aria-hidden': 'true' }),
      label(fmt(copy.stack.both, { a: copy.letters[a]!, b: copy.letters[b]! })), strip({ lit: both, cancel, kind: 'sum' }));
  });
  return h('div', { class: 'learn-stack' }, ...groups, h('p', { class: 'learn-caption learn-stack__legend' }, h('i', { class: 'learn-cancel-key', 'aria-hidden': 'true' }), copy.stack.cancel));
}

/** lesson 4's list: every row a chase can leave → the top lights to tap (pointer + letter) */
export function tableList(copy: LearnCopy, table: readonly TableEntry[]) {
  return h('div', { class: 'learn-table', role: 'table' },
    h('div', { class: 'learn-table__head', role: 'row' },
      h('span', { class: 'caption', role: 'columnheader' }, copy.tableBottom), h('span', { 'aria-hidden': 'true' }), h('span', { class: 'caption', role: 'columnheader' }, copy.tableTop)),
    ...table.map((e) => h('div', { class: 'learn-table__row', role: 'row', 'data-table-row': e.bottom.join('') },
      strip({ lit: e.bottom }), h('span', { class: 'learn-table__arrow', 'aria-hidden': 'true' }, '→'), strip({ ring: e.top, row: 'top', kind: 'top', letters: copy.letters }))));
}

/** the seven rows under their five rules (a presentation over the solver's table) */
export function rulesView(copy: LearnCopy, table: readonly TableEntry[]) {
  const known = (bottom: readonly number[]) => table.find((e) => e.bottom.join() === bottom.join());
  const list = h('div', { class: 'learn-rules' },
    ...RULES.map((r) => h('div', { class: 'learn-rule', 'data-rule': r.key },
      h('p', { class: 'learn-rule__text' }, copy.rules[r.key as keyof LearnCopy['rules']]),
      ...r.rows.filter((x) => known(x.bottom)).map((x) => h('div', { class: 'learn-rule__row', 'data-table-row': x.bottom.join('') },
        strip({ lit: x.bottom }), h('span', { class: 'learn-table__arrow', 'aria-hidden': 'true' }, '→'), strip({ ring: x.top, row: 'top', kind: 'top', letters: copy.letters }))))),
    h('p', { class: 'learn-caption' }, copy.rules.mirror));
  return list;
}

/** how an echo forms: the chase's taps row by row, from the row rule; pick the starting light */
export function deriveView(copy: LearnCopy, start = 1) {
  const rowsEl = h('div', { class: 'learn-derive__rows' });
  const paint = (col: number) => {
    const { rows, echo } = echoRows(col);
    rowsEl.replaceChildren(
      ...rows.map((cols, k) => h('div', { class: 'learn-derive__row', style: `--i:${k}` }, h('span', { class: 'caption' }, fmt(copy.derive.row, { n: k + 1 })), strip({ ring: cols, row: 'top', kind: 'top', letters: copy.letters }))),
      h('div', { class: 'learn-derive__row learn-derive__echo', style: `--i:${rows.length}`, 'data-derive-echo': echo.join(',') }, h('span', { class: 'caption' }, copy.derive.echo), strip({ lit: echo })),
    );
  };
  paint(start);
  return h('div', { class: 'learn-derive' },
    picker(copy, start, paint),
    rowsEl);
}

/** "Whose echo is this?": tap top-row lights, Check; any set that clears the row counts */
export function createDrill(d: { copy: LearnCopy; rules: LearnRules; solver: Pick<SolverService, 'press'>; rng: Pick<Rng, 'next'>; table: readonly TableEntry[]; store: DrillStore }) {
  const { copy, solver, table } = d;
  const keys = table.map((e) => e.bottom.join(','));
  const byKey = new Map(table.map((e) => [e.bottom.join(','), e]));
  let save = d.store.load() ?? emptySave();
  let round: Round | null = null;
  let chosen: number[] = [];

  const root = h('div', { class: 'learn-drill', 'data-drill': 'idle' });
  const count = h('span', { class: 'learn-moves num', 'data-drill-count': '' });
  const line = h('p', { class: 'tutorial-line', 'data-learn-line': 'drill', 'aria-live': 'polite' });
  const action = h('button', { class: 'btn btn--primary learn-small', type: 'button', 'data-action': 'learn-drill', onclick: () => onAction() }, copy.drill.check);
  const tops = [...Array(SIZE).keys()].map((c) => h('button', {
    class: 'cell', type: 'button', 'data-mini-cell': '', 'data-index': c, 'data-lit': 'false', 'data-col': c,
    'aria-label': copy.letters[c], 'aria-pressed': 'false', onclick: () => toggle(c),
  }));
  const topRow = h('span', { class: 'learn-row learn-row--pick' }, ...tops);
  const bottomRow = strip({});
  const bottoms = [...bottomRow.children] as HTMLElement[];
  const card = h('div', { class: 'learn-drill__card' }, topRow, h('span', { class: 'learn-drill__gap', 'aria-hidden': 'true' }, '⋮'), bottomRow);
  root.append(card);

  const current = () => (round && !finished(round) ? byKey.get(round.queue[round.pos]!)! : null);

  function paint() {
    const e = current();
    const state = !round ? 'idle' : finished(round) ? 'done' : round.answered === null ? 'asking' : round.answered ? 'right' : 'wrong';
    setAttr(root, 'data-drill', state);
    card.hidden = !e;
    bottoms.forEach((el, c) => setAttr(el, 'data-lit', String(!!e?.bottom.includes(c))));
    // a chosen light is pressed; after a miss, the pointer and letter show the right one
    const reveal = state === 'wrong' ? e!.top : [];
    tops.forEach((el, c) => {
      setAttr(el, 'aria-pressed', String(chosen.includes(c)));
      setAttr(el, 'data-suggest', reveal.includes(c) ? 'true' : null);
      setAttr(el, 'data-letter', reveal.includes(c) ? copy.letters[c]! : null);
      (el as HTMLButtonElement).disabled = state !== 'asking';
    });
    setText(count, round && !finished(round) ? fmt(copy.drill.card, { n: round.pos + 1, total: round.queue.length }) : '');
    if (state === 'idle' || state === 'asking') setText(line, '');
    else if (state === 'right') setText(line, copy.drill.right);
    else if (state === 'wrong') setText(line, fmt(copy.drill.wrong, { taps: names(copy, e!.top) }));
    else setText(line, `${fmt(copy.drill.score, { n: round!.right, total: round!.queue.length })}. ${copy.drill.scoreLine}`);
    setAttr(line, 'data-tone', state === 'wrong' ? 'warn' : state === 'right' ? 'hint' : 'coach');
    setText(action, state === 'asking' ? copy.drill.check : state === 'done' ? copy.drill.again : copy.drill.next);
    action.disabled = state === 'asking' && chosen.length === 0;
    action.className = 'btn btn--ghost learn-small';
  }

  function judge(right: boolean) {
    const r = answer(round!, save, right, d.rules.drill);
    round = r.round;
    save = r.save;
    d.store.save(save);
  }

  function toggle(c: number) {
    const e = current();
    if (!e || round!.answered !== null) return;
    chosen = chosen.includes(c) ? chosen.filter((x) => x !== c) : [...chosen, c].sort();
    if (clearsBottom(solver, e.bottom, chosen)) judge(true); // auto-check once the taps cancel the row
    paint();
  }

  function onAction() {
    if (!round || finished(round)) {
      save = { ...save, rounds: save.rounds + 1 };
      round = { queue: planRound(keys, save, d.rules.drill, d.rng), pos: 0, right: 0, answered: null };
    } else if (round.answered === null) {
      judge(clearsBottom(solver, current()!.bottom, chosen));
    } else {
      round = nextCard(round);
    }
    if (round.answered === null) chosen = [];
    paint();
  }

  onAction(); // the first card shows at once
  return { root, line, controls: h('div', { class: 'learn-controls' }, count, action), state: () => ({ round, save, chosen }) };
}
