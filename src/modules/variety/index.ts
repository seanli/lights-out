// variety: the Variety menu. Owns the `variety` slice (which room is showing) and renders view.region('screen:variety'):
// the room list, then one room's levels. Reads levels (packs) and progress (packs, varietyOpen); emits commands only.
import * as v from 'valibot';
import type { LevelsState, ModuleDef, Pack, ProgressState } from '../../contracts';
import { cellIndexes, gridSize } from '../../lib/shape';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import './variety.css';

const Text = v.pipe(v.string(), v.minLength(1));
const Copy = v.object({
  title: Text,
  subtitle: Text,
  back: Text,
  backToRooms: Text,
  roomSolved: Text,
  roomStars: Text,
  roomLabel: Text,
  roomCount: Text,
  play: Text,
  tileSolved: Text,
  tileOpen: Text,
  tileLocked: Text,
  empty: Text,
});
type CopyT = v.InferOutput<typeof Copy>;

const MAX_STARS = 3;
const CHEVRON_LEFT = 'M15 18l-6-6 6-6';

type PackProgress = NonNullable<ProgressState['packs']>[string];
const roomsOf = (levels: LevelsState | undefined): Pack[] =>
  levels?.status === 'ready' ? (levels.packs ?? []).filter((p) => p.kind !== 'classic') : [];

/**
 * A room's shape as dots (gaps stay empty). The room lights up as it is solved: solved/count of its cells,
 * nearest the centre first, so a finished room glows and an untouched one is a dark outline.
 */
export function roomGlyph(pack: Pack, solved: number): HTMLElement {
  const { cols, rows } = pack.shape;
  const g = h('span', { class: 'room-glyph', 'aria-hidden': 'true', style: `--cols:${cols}` });
  const real = cellIndexes(pack.shape);
  const cx = (cols - 1) / 2, cy = (rows - 1) / 2;
  const order = [...real].sort((a, b) =>
    Math.hypot((a % cols) - cx, Math.floor(a / cols) - cy) - Math.hypot((b % cols) - cx, Math.floor(b / cols) - cy) || a - b);
  const lit = new Set(order.slice(0, Math.round((real.length * Math.min(solved, pack.count)) / Math.max(1, pack.count))));
  const isReal = new Set(real);
  for (let i = 0; i < gridSize(pack.shape); i++) {
    g.append(h('i', isReal.has(i) ? { 'data-lit': lit.has(i) ? 'true' : 'false' } : { 'data-gap': '' }));
  }
  return g;
}

function starsEl(on: number): HTMLElement {
  const wrap = h('span', { class: 'stars', 'aria-hidden': 'true' });
  for (let i = 0; i < on; i++) wrap.append(h('span', { class: 'star', 'data-state': 'on' }));
  return wrap;
}

function chevron(): Element {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${CHEVRON_LEFT}"/></svg>`;
  return span.firstElementChild!;
}

const variety: ModuleDef = {
  manifest: {
    name: 'variety',
    emits: ['variety:opened', 'variety:refused', 'nav:go', 'nav:back', 'levels:start'],
    listens: ['variety:open'],
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
      const progress = ctx.read('progress');
      if (progress && !progress.varietyOpen) { ctx.emit('variety:refused', { reason: 'locked' }); return; }
      if (room !== undefined && !roomsOf(ctx.read('levels')).some((p) => p.id === room)) {
        ctx.log.warn('No such Variety room', { room });
        ctx.emit('variety:refused', { reason: 'unknown_room' });
        return;
      }
      ctx.write('variety', { room: room ?? null });
      ctx.emit('variety:opened', { room: room ?? null });
      ctx.emit('nav:go', { screen: 'variety' });
    });

    // ---- rendering: the screen is rebuilt when the room or the packs change; progress repaints in place ----
    let builtKey = '';
    let paintFns: (() => void)[] = [];
    /** the room we just left, so focus can return to its card */
    let cameFrom: string | null = null;

    const header = (title: string, eyebrow: string, label: string) =>
      h('header', { class: 'screen-header' },
        h('button', { class: 'btn btn--icon', type: 'button', 'data-action': 'variety-back', 'aria-label': label }, chevron()),
        h('div', { class: 'screen-header__title' }, h('span', { class: 'eyebrow' }, eyebrow), h('strong', {}, title)),
        h('div', { class: 'screen-header__end' }));

    const packOf = (id: string) => ctx.read('progress')?.packs?.[id];
    const tally = (p: Pack): PackProgress => packOf(p.id) ?? { unlockedUpTo: ctx.read('progress') ? 1 : p.count, solved: 0, stars: 0 };

    function buildList(rooms: Pack[]): HTMLElement[] {
      const grid = h('div', { class: 'room-grid' });
      for (const p of rooms) {
        const glyphHost = h('span', { class: 'room-tile__glyph' });
        const solved = h('span', { class: 'num' });
        const stars = h('span', { class: 'room-tile__stars num' });
        const tile = h('button', { type: 'button', class: 'room-tile', 'data-room-tile': '', 'data-room': p.id },
          glyphHost,
          h('span', { class: 'room-tile__name' }, p.name),
          h('span', { class: 'room-tile__meta' }, solved, stars));
        let glyphKey = -1;
        paintFns.push(() => {
          const t = tally(p);
          setAttr(tile, 'data-solved', String(t.solved));
          setAttr(tile, 'data-stars', String(t.stars));
          setAttr(tile, 'aria-label', fmt(copy.roomLabel, { name: p.name, solved: t.solved, count: p.count, stars: t.stars, max: p.count * MAX_STARS }));
          setText(solved, fmt(copy.roomSolved, { solved: t.solved, count: p.count }));
          stars.replaceChildren(h('span', { class: 'star', 'data-state': 'on', 'aria-hidden': 'true' }), fmt(copy.roomStars, { stars: t.stars, max: p.count * MAX_STARS }));
          if (glyphKey !== t.solved) { glyphKey = t.solved; glyphHost.replaceChildren(roomGlyph(p, t.solved)); }
        });
        grid.append(tile);
      }
      const body = rooms.length ? grid : h('p', { class: 'muted variety__empty' }, copy.empty);
      return [header(copy.title, copy.subtitle, copy.back), body];
    }

    function buildRoom(p: Pack, levels: LevelsState): HTMLElement[] {
      const grid = h('div', { class: 'level-grid variety__levels' });
      const summary = h('p', { class: 'muted variety__summary' });
      const tiles: { el: HTMLButtonElement; id: number; index: number; key: string }[] = [];
      for (let index = 1; index <= p.count; index++) {
        const id = p.first + index - 1;
        if (!levels.list.some((l) => l.id === id)) continue;
        const el = h('button', { type: 'button', class: 'level-tile', 'data-level-tile': '', 'data-level': id }, String(index));
        tiles.push({ el, id, index, key: '' });
        grid.append(el);
      }
      paintFns.push(() => {
        const t = tally(p);
        const results = ctx.read('progress')?.save.results ?? {};
        setText(summary, fmt(copy.roomCount, { solved: t.solved, count: p.count, stars: t.stars, max: p.count * MAX_STARS }));
        // the current tile: the lowest open unsolved level (none once the room is finished)
        const current = tiles.find((x) => x.index <= t.unlockedUpTo && !results[String(x.id)])?.index ?? 0;
        for (const x of tiles) {
          const stars = results[String(x.id)]?.stars ?? 0;
          const locked = x.index > t.unlockedUpTo;
          const isCurrent = x.index === current;
          setAttr(x.el, 'data-stars', String(stars));
          setAttr(x.el, 'data-locked', String(locked));
          setAttr(x.el, 'data-current', String(isCurrent));
          setAttr(x.el, 'aria-disabled', locked ? 'true' : null);
          setAttr(x.el, 'aria-current', isCurrent ? 'step' : null);
          setAttr(x.el, 'aria-label', locked ? fmt(copy.tileLocked, { level: x.index })
            : stars ? fmt(copy.tileSolved, { level: x.index, stars }) : fmt(copy.tileOpen, { level: x.index }));
          const key = locked ? 'locked' : isCurrent ? 'play' : `stars${stars}`;
          if (key === x.key) continue;
          x.key = key;
          while (x.el.childNodes.length > 1) x.el.lastChild!.remove();
          if (key === 'play') x.el.append(h('span', { class: 'level-tile__tag', 'aria-hidden': 'true' }, copy.play));
          else if (stars) x.el.append(starsEl(stars));
        }
      });
      const view = h('section', { class: 'variety__room', 'data-room-view': p.id },
        h('div', { class: 'variety__room-top' }, roomGlyph(p, tally(p).solved), summary), grid);
      return [header(p.name, copy.title, copy.backToRooms), view];
    }

    function render() {
      const levels = ctx.read('levels');
      const rooms = roomsOf(levels);
      const roomId = ctx.read('variety')?.room ?? null;
      const room = roomId ? rooms.find((p) => p.id === roomId) : undefined;
      const key = `${room?.id ?? ''}|${rooms.map((p) => p.id).join(',')}|${levels?.list.length ?? 0}`;
      if (key !== builtKey) {
        builtKey = key;
        paintFns = [];
        const hadFocus = region.contains(document.activeElement) || document.activeElement === document.body;
        region.replaceChildren(...(room && levels ? buildRoom(room, levels) : buildList(rooms)));
        region.scrollTop = 0;
        for (const f of paintFns) f();
        if (hadFocus && !region.hidden) {
          const target = room
            ? region.querySelector<HTMLElement>('[data-current="true"]') ?? region.querySelector<HTMLElement>('[data-level-tile]')
            : (cameFrom && region.querySelector<HTMLElement>(`[data-room="${CSS.escape(cameFrom)}"]`)) || null;
          target?.focus({ preventScroll: true });
        }
        cameFrom = room?.id ?? null;
        return;
      }
      for (const f of paintFns) f();
    }

    // every tap goes through an event (variety:open / nav / levels:start) so replay reproduces it
    region.addEventListener('click', (e) => {
      const target = e.target as Element;
      if (target.closest('[data-action="variety-back"]')) {
        if (ctx.read('variety')?.room) { ctx.emit('variety:open', {}); return; }
        // the list's parent is home: arriving from a solved sheet, nav:back would return to that board
        const prev = ctx.read('nav')?.previous ?? null;
        if (prev === null || prev === 'home') ctx.emit('nav:back', {});
        else ctx.emit('nav:go', { screen: 'home' });
        return;
      }
      const roomTile = target.closest<HTMLElement>('[data-room-tile]');
      if (roomTile) { ctx.emit('variety:open', { room: roomTile.dataset.room! }); return; }
      const tile = target.closest<HTMLElement>('[data-level-tile]');
      if (tile && tile.dataset.locked !== 'true') ctx.emit('levels:start', { levelId: Number(tile.dataset.level) });
    });

    for (const slice of ['levels', 'progress', 'variety'] as const) ctx.watch(slice, render);
    render();

    return {
      start: render,
      debug: () => ({ room: ctx.read('variety')?.room ?? null, rooms: roomsOf(ctx.read('levels')).map((p) => p.id) }),
      commands: {
        open: (args) => { ctx.emit('variety:open', args[0] ? { room: args[0] } : {}); return 'ok'; },
      },
    };
  },
};
export default variety;
