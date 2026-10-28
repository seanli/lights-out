// In-game pattern reference: fills view.region('slot:reference') (play-view places it).
// Built once; every board change only patches attributes and a few lines of text (well under 1 ms).
// Never marks the main board: the panel teaches the method, the paid Hint stays the only on-board help.
// One structure for every board: line 1 the status (with the guide link at its right), line 2 the rule (whole or hidden),
// then the live strips: only what is relevant now, on every board (the full 7-row table lives in lesson 4).
// Classic 5×5: your bottom row over the matched row's top taps, the matched row's echo as the rule. Other full rectangles: the size's rule (from the maths) and the same pair of strips,
// the top one empty until bottom-row time. Shaped rooms: chase advice by row, then a small picture of the board with the
// top-edge fix ringed. Honeycombs, cubes, wired and stuck switches: no bottom row to read, so the room's one-line tip.
// Rooms link to their board guide; classic links to all lessons.
import { BOTTOM, blank, chaseShapeSuggest, rectRule, rectTopSets, type Fixer, type RectRule, type TableEntry } from './method';
import { CELL_COUNT, SIZE, type BoardState, type Ctx, type Shape, type SolverService } from '../../contracts';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import { gridOf, gridSize, isCell, shapeKey } from '../../lib/shape';
import type { TwistKind } from './guides';

export interface ReferenceCopy {
  yourRow: string;
  bottom: string;
  top: string;
  echo: string;
  lessons: string;
  /** the link to a room's board guide */
  guide: string;
  status: {
    start: string; chase: string; match: string; progress: string; clear: string; nomatch: string; rectBottom: string; rectMatch: string;
    /** shaped rooms once only end lights are left: {n} ringed top-edge lights; part-way through them; no fix */
    shapedFix: string; shapedProgress: string; shapedNomatch: string;
  };
  /** the strategy line for full rectangles: chase alone clears it / a rule the maths follows / each light its own taps */
  rect: { chaseClears: string; ownTaps: string; oneRow: string; fewRows: string } & Record<RectRule, string>;
  /** the one-line tip on a board with no bottom row to read */
  tips: Record<TwistKind, string>;
}

export type ReferenceStatus = 'chase' | 'match' | 'nomatch' | 'clear' | 'tip';
export type BoardKind = 'classic' | 'rect' | 'shaped' | TwistKind;
export interface Advice {
  status: ReferenceStatus; text: string; match: number;
  /** full rectangles at bottom-row time: the player's bottom row and the top-row taps that clear it */
  rect?: { bottom: number[]; taps: number[] };
  /** shaped rooms once only end lights are left: the start cells still to tap */
  shaped?: { ring: number[] };
}

const ABOVE_BOTTOM = (1 << BOTTOM) - 1;
const toMask = (cells: readonly boolean[]) => { let m = 0; for (let i = 0; i < CELL_COUNT; i++) if (cells[i]) m |= 1 << i; return m; };
const rowMask = (cols: readonly number[]) => cols.reduce((m, c) => m | (1 << c), 0);

/** a board a chase can't read: a honeycomb or a cube (their grid), else wired or stuck switches; null for a plain square grid */
export function twistOf(shape: Shape | undefined): TwistKind | null {
  if (!shape) return null;
  const grid = gridOf(shape);
  if (grid === 'hex' || grid === 'cube') return grid;
  if (shape.wires) return 'wired';
  return shape.stuck?.length ? 'stuck' : null;
}

/** classic = no shape (or 5×5 without gaps); rect = any other full rectangle; shaped = a mask with gaps; else the twist */
export function kindOf(shape: Shape | undefined): BoardKind {
  if (!shape) return 'classic';
  const twist = twistOf(shape);
  if (twist) return twist;
  if (shape.mask && shape.mask.some((m) => !m)) return 'shaped';
  return shape.cols === SIZE && shape.rows === SIZE ? 'classic' : 'rect';
}

type Board = Pick<BoardState, 'status' | 'cells'> & { shape?: Shape };

/** What to do next, from the board alone. Pure, so tests can check it without a DOM. `fixerFor` serves shaped rooms, `tips` the twists. */
export function createAdvisor(solver: Pick<SolverService, 'press'>, table: readonly TableEntry[], copy: ReferenceCopy['status'], fixerFor?: (shape: Shape) => Fixer | null, tips?: ReferenceCopy['tips']) {
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
        const taps = setsFor(shape).tapsFor(bottom);
        const want = taps ? taps.reduce((m, c) => m | (1 << c), 0) : 0;
        if (taps && (tapped & ~want) === 0 && tapped !== want) return { status: 'match', text: copy.progress, match: -1, rect: { bottom, taps } };
      }
    }
    const first = cells.indexOf(true);
    const row = Math.floor(first / cols);
    if (row < rows - 1) return { status: 'chase', text: fmt(copy.chase, { row: row + 1 }), match: -1 };
    const bottom = bottomOf();
    const taps = setsFor(shape).tapsFor(bottom);
    if (!taps) return { status: 'nomatch', text: copy.rectBottom, match: -1 };
    return { status: 'match', text: copy.rectMatch, match: -1, rect: { bottom, taps } };
  };

  /** the strategy line for a full rectangle, read from its per-light sets; `letters` names columns ("A C E") */
  const rectLine = (shape: Shape, lines: ReferenceCopy['rect'], letters?: (cols: readonly number[]) => string): string => {
    const sets = setsFor(shape);
    if (sets.chaseClears) return fmt(lines.chaseClears, { cols: shape.cols, rows: shape.rows });
    if (sets.perLight.every((set) => set !== null)) {
      const rule = rectRule(sets.perLight);
      return rule ? lines[rule] : lines.ownTaps;
    }
    // a lone bottom light can't always be fixed from the top (9×9): name the one row a chase can leave, or say there are few
    const only = sets.possibleRows(1)?.[0];
    if (only && letters) return fmt(lines.oneRow, { pattern: letters(only), taps: letters(sets.tapsFor(only) ?? []) });
    return lines.fewRows;
  };

  /** any shape: part-way through a fix → finish it; lights above an end cell → chase that row; else the fix, ringed */
  const shaped = (cells: readonly boolean[], shape: Shape): Advice => {
    const fx = fixerFor?.(shape) ?? null;
    const part = fx?.progress(cells);
    if (part) {
      const ring = part.fix.filter((c) => !part.done.includes(c));
      return { status: 'match', text: fmt(copy.shapedProgress, { n: ring.length }), match: -1, shaped: { ring } };
    }
    const next = chaseShapeSuggest(cells, shape);
    if (next !== null) return { status: 'chase', text: fmt(copy.chase, { row: Math.floor(next / shape.cols) }), match: -1 };
    const fix = fx?.fixFor(cells);
    if (!fix) return { status: 'nomatch', text: copy.shapedNomatch, match: -1 };
    return { status: 'match', text: fmt(copy.shapedFix, { n: fix.length }), match: -1, shaped: { ring: fix } };
  };

  const advise = (board: Board | undefined): Advice => {
    if (!board || board.status === 'empty') return { status: 'chase', text: copy.start, match: -1 };
    if (board.status === 'solved' || !board.cells.includes(true)) return { status: 'clear', text: copy.clear, match: -1 };
    const kind = kindOf(board.shape);
    const twist = twistOf(board.shape);
    if (twist) return { status: 'tip', text: tips?.[twist] ?? copy.start, match: -1 };
    if (kind === 'shaped') return shaped(board.cells, board.shape!);
    if (kind === 'rect') return rect(board.cells, board.shape!);
    return classic(toMask(board.cells));
  };
  return Object.assign(advise, { rectLine });
}

/** teal stays the paid Hint's colour: the panel speaks in the coach tone, warm when a row matches */
const TONE: Record<ReferenceStatus, string> = { chase: 'coach', match: 'match', clear: 'coach', nomatch: 'warn', tip: 'coach' };

export interface ReferenceLabels {
  /** "B" / "A + D" for a table row's top taps */
  echo: (top: readonly number[]) => string;
  /** column letters, A first */
  letters: string;
}

export interface ReferenceRooms {
  /** the start-cell fix for a shape (null when it can't be worked out) */
  fixer(shape: Shape): Fixer | null;
  /** the guide id for a room, or null when it has none */
  guideFor(pack: string): string | null;
  /** the guide of the room of this kind (a custom board with a twist has no room of its own), or null */
  guideForKind(kind: TwistKind): string | null;
}

export function createReference(ctx: Ctx, solver: SolverService, table: readonly TableEntry[], copy: ReferenceCopy, labels: ReferenceLabels, rooms: ReferenceRooms) {
  const slot = ctx.need('view').region('slot:reference');
  const advise = createAdvisor(solver, table, copy.status, rooms.fixer, copy.tips);

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
  /** retarget a top strip's cells: pointer + letter on the columns to tap */
  const paintTaps = (el: HTMLElement, cols: readonly number[]) => {
    [...el.children].forEach((cell, c) => {
      setAttr(cell, 'data-suggest', cols.includes(c) ? 'true' : null);
      setAttr(cell, 'data-letter', cols.includes(c) ? labels.letters[c]! : null);
    });
  };

  // one structure for every board: the status sentence with the guide link on its first line, the rule (never cut:
  // whole or hidden), then the live strips in a body that scrolls on its own under a fade
  const status = h('p', { class: 'reference__status', 'data-reference-status': 'chase', role: 'status', 'aria-live': 'polite' });
  const rule = h('p', { class: 'reference__rule', 'data-reference-rule': '', hidden: true });
  const caption = (text: string) => h('span', { class: 'caption' }, text);
  // classic 5×5: your bottom row and, once it matches a table row, that row's top taps under it
  const live = strip('live', []);
  live.setAttribute('data-reference-bottom', '');
  const classicTop = strip('top', []);
  classicTop.setAttribute('data-empty', 'true');
  // the one row that matters now: [data-pattern] names the table row your bottom row matches ([data-match])
  const classicBox = h('div', { class: 'reference__pair', 'data-pattern-row': '', 'data-match': 'false' }, caption(copy.yourRow), live, caption(copy.top), classicTop);
  // the matching row's one line: "Echo of B"
  const ruleOf = table.map((e) => fmt(copy.echo, { name: labels.echo(e.top) }));
  // full rectangles: the same pair, as wide as the board (rebuilt per shape); the top strip waits empty until bottom-row time
  let rectRow = strip('live', [], 1);
  let rectTop = strip('top', [], 1);
  const rectBox = h('div', { class: 'reference__pair reference__rect', hidden: true }, caption(copy.yourRow), rectRow, caption(copy.top), rectTop);
  let rectKey = '';
  let rectLive: HTMLElement[] = [];
  let tapsShown = false;
  // shaped rooms: a small picture of the board, the end lights lit and the fix ringed (rebuilt when the shape changes)
  const shapeBox = h('div', { class: 'reference__shape', 'data-reference-shape': '', hidden: true });
  let shapeKeyNow = '';
  let shapeCells: HTMLElement[] = [];
  const buildShape = (shape: Shape) => {
    const grid = h('span', { class: 'learn-row learn-row--shape', 'aria-hidden': 'true', style: `--strip-n:${shape.cols}` });
    shapeCells = [];
    for (let i = 0; i < gridSize(shape); i++) {
      if (!isCell(shape, i)) { grid.append(h('span', { class: 'learn-row__gap', 'data-gap': '' })); continue; }
      const cell = h('span', { class: 'cell', 'data-mini-cell': '', 'data-index': i, 'data-lit': 'false' });
      shapeCells.push(cell);
      grid.append(cell);
    }
    shapeBox.replaceChildren(grid);
  };
  // the guide link on room boards (classic links to all the lessons)
  const lessonsBtn = h('button', { class: 'btn btn--link reference__link', type: 'button', 'data-action': 'learn', onclick: () => ctx.emit('learn:open', {}) }, copy.lessons);
  let guideId: string | null = null;
  const guideBtn = h('button', { class: 'btn btn--link reference__link', type: 'button', 'data-action': 'guide', hidden: true, onclick: () => { if (guideId) ctx.emit('learn:open', { lessonId: guideId }); } }, copy.guide);
  /** level id → its pack ('classic' when absent), read from the levels slice */
  const packOf = (levelId: number | null | undefined): string => {
    if (levelId == null) return 'classic';
    return ctx.read('levels')?.list.find((l) => l.id === levelId)?.pack ?? 'classic';
  };
  // only what's relevant now (your row and what to tap), as on every other board; the full table lives in lesson 4
  const body = h('div', { class: 'reference__body' }, classicBox, rectBox, shapeBox);
  const ruleBox = h('div', { class: 'reference__fit', hidden: true }, rule);
  const root = h('div', { class: 'reference', 'data-reference': '', 'data-reference-kind': 'classic' },
    h('div', { class: 'reference__line' }, status, lessonsBtn, guideBtn),
    ruleBox,
    body,
  );
  slot.replaceChildren(root);
  const liveCells = [...live.children] as HTMLElement[];

  // ---- scrolling: fade the body's bottom edge while more is below (a short phone's panel can be shorter than its strips) ----
  const fade = () => setAttr(body, 'data-overflow', String(body.scrollHeight - body.scrollTop - body.clientHeight > 2));
  body.addEventListener('scroll', fade, { passive: true });
  // fires when the panel opens (display: none → a size) and on every resize
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fade()) : null;
  observer?.observe(body);

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
    setAttr(classicBox, 'data-match', String(match >= 0));
    setAttr(classicBox, 'data-pattern', match >= 0 ? table[match]!.bottom.join(',') : null);
    setAttr(root, 'data-matched', String(match >= 0 || !!a.rect || !!a.shaped));
    // classic: the matched row's top taps under your row
    paintTaps(classicTop, match >= 0 ? table[match]!.top : []);
    setAttr(classicTop, 'data-empty', match >= 0 ? null : 'true');
    classicBox.hidden = !classic;
    // rooms: their board guide instead of all lessons (a custom board with a twist: that twist's guide)
    const pack = kind === 'classic' ? 'classic' : packOf(board?.levelId);
    const twist = twistOf(board?.shape);
    guideId = pack !== 'classic' ? rooms.guideFor(pack) : twist ? rooms.guideForKind(twist) : null;
    lessonsBtn.hidden = !!guideId;
    guideBtn.hidden = !guideId;
    // shaped rooms: the picture with the fix ringed
    shapeBox.hidden = !a.shaped;
    if (a.shaped && board?.shape) {
      const key = shapeKey(board.shape);
      if (key !== shapeKeyNow) { shapeKeyNow = key; buildShape(board.shape); }
      for (const cell of shapeCells) {
        const i = Number(cell.dataset.index);
        setAttr(cell, 'data-lit', String(!!board.cells[i]));
        setAttr(cell, 'data-suggest', a.shaped.ring.includes(i) ? 'true' : null);
      }
    }
    // full rectangles: the live bottom row (the one [data-reference-bottom]), the top taps under it at bottom-row time
    const rectShape = kind === 'rect' ? board?.shape : undefined;
    rectBox.hidden = !rectShape;
    setAttr(live, 'data-reference-bottom', classic ? '' : null);
    setAttr(rectRow, 'data-reference-bottom', rectShape ? '' : null);
    if (rectShape) {
      const { cols, rows: height } = rectShape;
      if (shapeKey(rectShape) !== rectKey) {
        rectKey = shapeKey(rectShape);
        const nextRow = strip('live', [], cols);
        nextRow.setAttribute('data-reference-bottom', '');
        rectLive = [...nextRow.children] as HTMLElement[];
        rectLive.forEach((cell, c) => setAttr(cell, 'data-index', String((height - 1) * cols + c)));
        const nextTop = strip('top', [], cols);
        rectRow.replaceWith(nextRow);
        rectTop.replaceWith(nextTop);
        rectRow = nextRow;
        rectTop = nextTop;
        tapsShown = false;
        setAttr(rectBox, 'style', `--strip-n:${cols}`);
        setAttr(rectBox, 'data-wide', cols > 8 ? '' : null);
      }
      rectLive.forEach((cell, c) => setAttr(cell, 'data-lit', String(!!board!.cells[(height - 1) * cols + c])));
      const appear = !tapsShown && !!a.rect;
      tapsShown = !!a.rect;
      paintTaps(rectTop, a.rect?.taps ?? []);
      setAttr(rectTop, 'data-empty', a.rect ? null : 'true');
      // a short panel scrolls: the taps to make are the line that must show
      if (appear) rectTop.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    const line = match >= 0 ? ruleOf[match]! : kind === 'rect' && board?.shape ? advise.rectLine(board.shape, copy.rect, (cols) => cols.map((c) => labels.letters[c]).join(' ')) : '';
    rule.hidden = !line;
    ruleBox.hidden = !line;
    setText(rule, line);
    // nothing to show below line 1 (a tip, a shaped room while chasing): no empty body taking room
    body.hidden = classicBox.hidden && rectBox.hidden && shapeBox.hidden;
  };
  ctx.watch('board', update);
  update(ctx.read('board'));
  return { advise, stop: () => observer?.disconnect() };
}

