// variety: one board's level screen, classic included. Owns the `variety` slice (which board is showing) and renders
// view.region('screen:variety'): the board's levels in five columns, in bands that each close on a boss (every 10th
// level, drawn with a skull), classic's bands inside its chapters. The menu on home opens it.
// Reads levels, progress, learn and nav; emits commands only.
import * as v from 'valibot';
import type { Chapter, LevelDef, LevelsState, ModuleDef, Pack, ProgressState } from '../../contracts';
import { roomGlyph } from '../../lib/glyph';
import { skull } from '../../lib/icons';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import './variety.css';

const Text = v.pipe(v.string(), v.minLength(1));
const Copy = v.object({
  back: Text,
  /** the header's eyebrow: "5×5 · 50 levels" (one line at 320 wide, so no notes here), "30 levels" for a shape */
  boardSize: Text,
  boardShape: Text,
  summary: Text,
  guide: Text,
  guideClassic: Text,
  chapter: Text,
  chapterRange: Text,
  chapterLocked: Text,
  play: Text,
  tileSolved: Text,
  tileOpen: Text,
  tileLocked: Text,
  /** a boss tile's label wraps the tile's own: "Boss. Level 10, locked" */
  tileBoss: Text,
  starLegend: v.object({ three: Text, two: Text, one: Text, hint: Text }),
});
type CopyT = v.InferOutput<typeof Copy>;

const MAX_STARS = 3;
const CHEVRON_LEFT = 'M15 18l-6-6 6-6';

/** a board's standing: open (rooms wait for progress.varietyOpen), highest startable index, levels solved, stars */
export interface Tally { open: boolean; unlocked: number; solved: number; stars: number }

export function tally(pack: Pack, progress: ProgressState | undefined): Tally {
  const results = progress?.save.results ?? {};
  let solved = 0, stars = 0;
  for (let id = pack.first; id < pack.first + pack.count; id++) {
    const r = results[String(id)];
    if (r) { solved++; stars += r.stars; }
  }
  if (!progress) return { open: true, unlocked: pack.count, solved, stars };
  const clamp = (n: number) => Math.min(pack.count, Math.max(1, n));
  if (pack.kind === 'classic') return { open: true, unlocked: clamp(progress.unlockedUpTo - pack.first + 1), solved, stars };
  const open = progress.varietyOpen === true;
  return { open, unlocked: open ? clamp(progress.packs?.[pack.id]?.unlockedUpTo ?? 1) : 0, solved, stars };
}

const packsOf = (levels: LevelsState | undefined): Pack[] => (levels?.status === 'ready' ? levels.packs ?? [] : []);

function starsEl(on: number, cls = 'stars'): HTMLElement {
  const wrap = h('span', { class: cls, 'aria-hidden': 'true' });
  for (let i = 0; i < on; i++) wrap.append(h('span', { class: 'star', 'data-state': 'on' }));
  return wrap;
}

function chevron(): Element {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${CHEVRON_LEFT}"/></svg>`;
  return span.firstElementChild!;
}

/** a level button: its number, a skull on a boss, and `deco` (Play on the current tile, else its stars) */
interface Tile { el: HTMLButtonElement; deco: HTMLElement; id: number; index: number; boss: boolean; key: string }
/** a run of tiles (a classic chapter, or a whole room); `locked` is the quiet row shown instead while it is ahead */
interface Group { from: number; open: HTMLElement; locked: HTMLElement | null }
interface Board { pack: Pack; tiles: Tile[]; groups: Group[]; summary: HTMLElement; glyph: HTMLElement; guide: HTMLButtonElement; glyphKey: number }

const variety: ModuleDef = {
  manifest: {
    name: 'variety',
    emits: ['variety:opened', 'variety:refused', 'nav:go', 'nav:back', 'levels:start', 'learn:open'],
    listens: ['variety:open', 'progress:level_completed'],
    owns: ['variety'],
    uses: ['view'],
    data: { copy: Copy },
  },
  init(ctx) {
    const copy = ctx.data.copy as CopyT;
    const view = ctx.need('view');
    const region = view.region('screen:variety');
    region.classList.add('screen--scroll', 'variety');
    ctx.write('variety', { room: null });

    ctx.on('variety:open', ({ room }) => {
      const pack = packsOf(ctx.read('levels')).find((p) => p.id === room);
      if (!pack) {
        ctx.log.warn('No such board', { room });
        ctx.emit('variety:refused', { reason: 'unknown_room' });
        return;
      }
      if (!tally(pack, ctx.read('progress')).open) { ctx.emit('variety:refused', { reason: 'locked' }); return; }
      ctx.write('variety', { room });
      ctx.emit('variety:opened', { room });
      ctx.emit('nav:go', { screen: 'variety' });
    });

    const metaOf = (p: Pack) =>
      fmt(p.kind === 'shape' ? copy.boardShape : copy.boardSize, { cols: p.shape.cols, rows: p.shape.rows, count: p.count });

    const header = (title: string, eyebrow: string) =>
      h('header', { class: 'screen-header' },
        h('button', { class: 'btn btn--icon', type: 'button', 'data-action': 'variety-back', 'aria-label': copy.back }, chevron()),
        h('div', { class: 'screen-header__title' }, h('span', { class: 'eyebrow' }, eyebrow), h('strong', {}, title)),
        h('div', { class: 'screen-header__end' }));

    // ---- the screen is rebuilt when the board or the levels change; progress repaints in place ----
    let board: Board | null = null;
    let builtFor: { room: string | null; packs: LevelsState['packs']; list: LevelsState['list'] | undefined } | null = null;
    const legend = h('p', { class: 'variety__legend', 'data-star-legend': '' });

    function build(p: Pack, levels: LevelsState): Board {
      const defs = new Map<number, LevelDef>(levels.list.map((l) => [l.id, l]));
      // classic groups its tiles into chapters (by id, which is its index); a room is one grid
      const chapters: Chapter[] = p.kind === 'classic' && levels.chapters.length
        ? levels.chapters
        : [{ id: p.id, name: '', from: p.first, to: p.first + p.count - 1 }];
      const tiles: Tile[] = [];
      const groups: Group[] = [];
      chapters.forEach((ch, n) => {
        // five columns everywhere; a boss closes its band (every second row) and the next band starts a little apart
        const bands = h('div', { class: 'variety__bands' });
        let grid: HTMLElement | null = null;
        for (let id = Math.max(ch.from, p.first); id <= Math.min(ch.to, p.first + p.count - 1); id++) {
          const def = defs.get(id);
          if (!def) continue;
          const index = id - p.first + 1;
          const boss = def.boss === true;
          const deco = h('span', { class: 'level-tile__deco' });
          const el = h('button', { type: 'button', class: 'level-tile', 'data-level-tile': '', 'data-level': id, 'data-boss': boss ? 'true' : null },
            h('span', { class: 'level-tile__num' }, String(index)), boss ? skull() : null, deco);
          tiles.push({ el, deco, id, index, boss, key: '' });
          if (!grid) bands.append(grid = h('div', { class: 'level-grid variety__band' }));
          grid.append(el);
          if (boss) grid = null;
        }
        const eyebrow = ch.name ? fmt(copy.chapter, { n: n + 1, name: ch.name }) : '';
        const head = ch.name
          ? h('div', { class: 'chapter' }, h('span', { class: 'eyebrow' }, eyebrow), h('span', { class: 'chapter__meta' }, fmt(copy.chapterRange, { from: ch.from, to: ch.to })))
          : null;
        const open = h('section', { class: 'section variety__chapter', 'data-chapter': ch.id }, head, bands, n === 0 ? legend : null);
        // a chapter ahead is one quiet row, not a card (a room is never ahead: it can't be opened while locked)
        const locked = ch.name
          ? h('div', { class: 'chapter variety__ahead', 'data-locked': 'true', 'data-chapter': ch.id, hidden: true },
            h('span', { class: 'eyebrow' }, eyebrow), h('span', { class: 'chapter__meta' }, fmt(copy.chapterLocked, { level: ch.from })))
          : null;
        groups.push({ from: ch.from - p.first + 1, open, locked });
      });
      const glyph = h('span', { class: 'variety__glyph' });
      const summary = h('p', { class: 'variety__summary', 'data-board-summary': '' });
      const guide = h('button', { type: 'button', class: 'btn btn--link variety__guide', 'data-action': 'guide', hidden: true },
        p.kind === 'classic' ? copy.guideClassic : fmt(copy.guide, { name: p.name }));
      region.replaceChildren(
        header(p.name, metaOf(p)),
        h('section', { class: 'variety__board', 'data-room-view': p.id },
          h('div', { class: 'variety__top' }, glyph, h('div', { class: 'variety__top-body' }, summary, guide)),
          ...groups.flatMap((g) => (g.locked ? [g.open, g.locked] : [g.open]))),
      );
      region.scrollTop = 0;
      return { pack: p, tiles, groups, summary, glyph, guide, glyphKey: -1 };
    }

    /** the tile to light: the lowest startable unsolved level; when all are solved, the last played one if it is here */
    function currentIndex(b: Board, unlocked: number, results: ProgressState['save']['results'], last: number): number {
      const open = b.tiles.find((x) => x.index <= unlocked && !results[String(x.id)]);
      if (open) return open.index;
      const here = b.tiles.find((x) => x.id === last && x.index <= unlocked);
      return here ? here.index : 0;
    }

    function paint(b: Board) {
      const progress = ctx.read('progress');
      const t = tally(b.pack, progress);
      const results = progress?.save.results ?? {};
      setText(b.summary, fmt(copy.summary, { solved: t.solved, count: b.pack.count, stars: t.stars, max: b.pack.count * MAX_STARS }));
      if (b.glyphKey !== t.solved) { b.glyphKey = t.solved; b.glyph.replaceChildren(roomGlyph(b.pack, t.solved)); }
      b.guide.hidden = ctx.read('learn') === undefined;
      const current = currentIndex(b, t.unlocked, results, progress?.save.lastLevel ?? 0);
      for (const x of b.tiles) {
        const stars = results[String(x.id)]?.stars ?? 0;
        const locked = x.index > t.unlocked;
        const isCurrent = x.index === current;
        setAttr(x.el, 'data-stars', String(stars));
        setAttr(x.el, 'data-locked', String(locked));
        setAttr(x.el, 'data-current', String(isCurrent));
        setAttr(x.el, 'aria-disabled', locked ? 'true' : null);
        setAttr(x.el, 'aria-current', isCurrent ? 'step' : null);
        const label = locked ? fmt(copy.tileLocked, { level: x.index })
          : stars ? fmt(copy.tileSolved, { level: x.index, stars }) : fmt(copy.tileOpen, { level: x.index });
        setAttr(x.el, 'aria-label', x.boss ? fmt(copy.tileBoss, { label }) : label);
        const key = locked ? 'locked' : isCurrent && !stars ? 'play' : `stars${stars}`;
        if (key === x.key) continue;
        x.key = key;
        if (key === 'play') x.deco.replaceChildren(h('span', { class: 'level-tile__tag', 'aria-hidden': 'true' }, copy.play));
        else if (stars) x.deco.replaceChildren(starsEl(stars));
        else x.deco.replaceChildren();
      }
      for (const g of b.groups) {
        if (!g.locked) continue;
        const ahead = g.from > t.unlocked;
        g.open.hidden = ahead;
        g.locked.hidden = !ahead;
      }
      const scoring = progress?.scoring;
      legend.hidden = !scoring;
      if (scoring) paintLegend(scoring);
    }

    let legendKey = '';
    function paintLegend(s: NonNullable<ProgressState['scoring']>) {
      const key = JSON.stringify(s);
      if (key === legendKey) return;
      legendKey = key;
      const L = copy.starLegend;
      const item = (stars: number, text: string) => h('span', { class: 'variety__legend-item' }, stars ? starsEl(stars, 'stars stars--xs') : null, text);
      const three = s.threeStarsWithin > 0 ? fmt(L.two, { within: s.threeStarsWithin }) : L.three; // "par +N" when par itself has slack
      const items = [item(3, three), item(2, fmt(L.two, { within: s.twoStarsWithin })), item(1, L.one), item(0, fmt(L.hint, { cost: s.hintCost }))];
      legend.replaceChildren(...items.flatMap((it, i) => (i ? [h('span', { class: 'variety__sep', 'aria-hidden': 'true' }, '·'), it] : [it])));
    }

    function render() {
      const levels = ctx.read('levels');
      const room = ctx.read('variety')?.room ?? null;
      const pack = packsOf(levels).find((p) => p.id === room);
      if (!builtFor || builtFor.room !== room || builtFor.packs !== levels?.packs || builtFor.list !== levels?.list) {
        builtFor = { room, packs: levels?.packs, list: levels?.list };
        if (pack && levels) board = build(pack, levels);
        else {
          // nothing to show (no board chosen, or the levels aren't ready): still a way back
          board = null;
          region.replaceChildren(header('', ''));
        }
        if (board) reveal();
      }
      if (board) paint(board);
      powerOn();
    }

    const showing = () => {
      const nav = ctx.read('nav');
      return !nav || (nav.screen === 'variety' && !nav.sheet);
    };

    /** a level unlocked by a solve lights up once when its board next shows */
    let unlockedId: number | null = null;
    function powerOn() {
      // the nav slice decides, not region.hidden: the shell may un-hide this screen after this watcher; the animation starts on display
      if (unlockedId === null || !board || !showing()) return;
      const tile = board.tiles.find((x) => x.id === unlockedId);
      if (!tile) return; // another board: wait until this one shows
      unlockedId = null;
      const el = tile.el;
      if (el.dataset.locked === 'true' || el.dataset.stars !== '0') return;
      el.removeAttribute('data-power-on');
      void el.offsetWidth; // restart the animation if it ran before
      el.setAttribute('data-power-on', '');
    }
    region.addEventListener('animationend', (e) => {
      const el = e.target as HTMLElement;
      if (el.hasAttribute?.('data-power-on')) el.removeAttribute('data-power-on');
    });
    ctx.on('progress:level_completed', ({ unlocked }) => { if (unlocked !== null) unlockedId = unlocked; });

    /** keep the current tile on screen when the board appears; no smooth scroll, no move if it is already visible */
    let pendingReveal = false;
    function reveal() {
      if (pendingReveal || typeof requestAnimationFrame !== 'function') return;
      pendingReveal = true;
      requestAnimationFrame(() => {
        pendingReveal = false;
        if (region.hidden || !board) return;
        const tile = board.tiles.find((x) => x.el.dataset.current === 'true')?.el;
        if (!tile || typeof tile.scrollIntoView !== 'function') return;
        const box = region.getBoundingClientRect();
        const r = tile.getBoundingClientRect();
        if (r.height === 0) return;
        const top = Math.max(box.top, 0);
        const bottom = Math.min(box.bottom, window.innerHeight);
        if (r.top < top || r.bottom > bottom) tile.scrollIntoView({ block: 'center' });
      });
    }

    // every tap goes through an event (nav / levels:start / learn:open) so replay reproduces it
    region.addEventListener('click', (e) => {
      const target = e.target as Element;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'variety-back') {
        // the menu is this screen's parent: arriving from a solved sheet, nav:back would return to that level
        const prev = ctx.read('nav')?.previous ?? null;
        if (prev === null || prev === 'home') ctx.emit('nav:back', {});
        else ctx.emit('nav:go', { screen: 'home' });
        return;
      }
      if (action === 'guide' && board) {
        ctx.emit('learn:open', board.pack.kind === 'classic' ? {} : { lessonId: `guide-${board.pack.id}` });
        return;
      }
      const tile = target.closest<HTMLElement>('[data-level-tile]');
      if (tile && tile.dataset.locked !== 'true') ctx.emit('levels:start', { levelId: Number(tile.dataset.level) });
    });

    for (const slice of ['levels', 'progress', 'variety'] as const) ctx.watch(slice, render);
    // the learn slice changes on every practice tap; the guide link only cares whether a learn module runs
    let hadLearn = ctx.read('learn') !== undefined;
    ctx.watch('learn', (l) => { if ((l !== undefined) !== hadLearn) { hadLearn = l !== undefined; render(); } });
    let lastShown = false;
    ctx.watch('nav', () => {
      const now = showing();
      if (now && !lastShown) { reveal(); powerOn(); }
      lastShown = now;
    });
    render();

    return {
      start: render,
      debug: () => ({ room: ctx.read('variety')?.room ?? null, boards: packsOf(ctx.read('levels')).map((p) => p.id) }),
      commands: {
        open: (args) => { ctx.emit('variety:open', { room: args[0] ?? 'classic' }); return 'ok'; },
      },
    };
  },
};
export default variety;
