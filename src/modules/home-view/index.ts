// home-view: the level path. Renders view.region('screen:home') and the reset confirmation sheet.
// Reads levels, progress, storage, sound, learn and nav; emits commands only. Never imports a module.
import * as v from 'valibot';
import type { LevelsState, ModuleDef, ProgressState } from '../../contracts';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import './home-view.css';

const Text = v.pipe(v.string(), v.minLength(1));
const Copy = v.object({
  title: Text,
  continue: Text,
  start: Text,
  level: Text,
  solvedCount: Text,
  savedNote: Text,
  allSolved: Text,
  levelsError: Text,
  starTotal: Text,
  chapter: Text,
  chapterRange: Text,
  chapterLocked: Text,
  play: Text,
  tileSolved: Text,
  tileOpen: Text,
  tileLocked: Text,
  starLegend: v.object({ three: Text, two: Text, one: Text, hint: Text }),
  learn: Text,
  soundOn: Text,
  soundOff: Text,
  reset: Text,
  resetTitle: Text,
  resetBody: Text,
  resetConfirm: Text,
  resetCancel: Text,
});
type CopyT = v.InferOutput<typeof Copy>;

const MAX_STARS = 3;

/** the level Continue starts: lowest unlocked unsolved; if every unlocked level is solved, the last played */
export function suggestLevel(count: number, progress: ProgressState | undefined): { levelId: number; fresh: boolean } {
  if (!progress || count < 1) return { levelId: 1, fresh: true };
  const results = progress.save.results;
  let solved = 0;
  for (let id = 1; id <= count; id++) if (results[String(id)]) solved++;
  if (solved === 0) return { levelId: 1, fresh: true };
  const top = Math.min(Math.max(1, progress.unlockedUpTo), count);
  for (let id = 1; id <= top; id++) if (!results[String(id)]) return { levelId: id, fresh: false };
  const last = progress.save.lastLevel;
  return { levelId: Number.isInteger(last) && last >= 1 && last <= count ? last : top, fresh: false };
}

function starsEl(on: number, cls = 'stars'): HTMLElement {
  const wrap = h('span', { class: cls, 'aria-hidden': 'true' });
  for (let i = 0; i < MAX_STARS; i++) wrap.append(h('span', { class: 'star', 'data-state': i < on ? 'on' : 'off' }));
  return wrap;
}

const svg = (paths: string) => {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  return span.firstElementChild!;
};
const ICON_SOUND_ON = '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7"/><path d="M19 6a8.5 8.5 0 010 12"/>';
const ICON_SOUND_OFF = '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>';
const ICON_LEARN = '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M17.5 14v7M14 17.5h7"/>';
/** the logo: a lit plus on a 3×3 grid */
const GLYPH_LIT = [1, 3, 4, 5, 7];

interface Tile { el: HTMLButtonElement; key: string }
interface ChapterView { from: number; to: number; open: HTMLElement; locked: HTMLElement }

const homeView: ModuleDef = {
  manifest: {
    name: 'home-view',
    emits: ['levels:start', 'sound:set', 'learn:open', 'nav:open_sheet', 'nav:close_sheet', 'progress:clear'],
    listens: [],
    owns: [],
    uses: ['view'],
    data: { copy: Copy },
  },
  init(ctx) {
    const copy = ctx.data.copy as CopyT;
    const view = ctx.need('view');
    const region = view.region('screen:home');
    region.classList.add('screen--scroll', 'home');

    // ---- static frame: built once ----
    const glyph = h('div', { class: 'glyph', 'aria-hidden': 'true' });
    for (let i = 0; i < 9; i++) glyph.append(h('i', { 'data-lit': GLYPH_LIT.includes(i) ? 'true' : null }));
    const totalNum = h('span', { class: 'num' });
    const totalOf = h('span', { class: 'chip__of num' });
    const total = h('span', { class: 'chip chip--lg', 'data-star-total': '', role: 'img' },
      h('span', { class: 'stars', 'aria-hidden': 'true' }, h('span', { class: 'star', 'data-state': 'on' })), totalNum, totalOf);

    const contLabel = h('span');
    const contLevel = h('span');
    const cont = h('button', { type: 'button', class: 'btn btn--primary btn--block', 'data-action': 'continue' },
      contLabel, h('span', { class: 'btn__meta', 'aria-hidden': 'true' }, '·'), contLevel);
    const caption = h('p', { class: 'muted home__caption', 'data-home-caption': '' });
    const levelsError = h('p', { class: 'home__error', role: 'alert', hidden: true }, copy.levelsError);
    const chaptersHost = h('div', { class: 'home__chapters' });

    const learn = h('button', { type: 'button', class: 'btn btn--secondary btn--block', 'data-action': 'learn', hidden: true },
      svg(ICON_LEARN), copy.learn);
    const legend = h('div', { class: 'home__legend', 'data-star-legend': '' });
    const soundIcon = h('span', { class: 'home__icon' });
    const soundLabel = h('span');
    const sound = h('button', { type: 'button', class: 'btn btn--ghost', 'data-action': 'sound', hidden: true }, soundIcon, soundLabel);
    const reset = h('button', { type: 'button', class: 'btn btn--ghost', 'data-action': 'reset', hidden: true }, copy.reset);

    region.replaceChildren(
      h('header', { class: 'home__top' },
        h('div', { class: 'home__logo' }, glyph, h('h1', { class: 'display' }, copy.title)),
        total),
      h('section', { class: 'home__hero' }, cont, caption),
      levelsError,
      chaptersHost,
      h('footer', { class: 'home__footer' }, learn, legend, h('div', { class: 'home__settings' }, sound, reset)),
    );

    // ---- reset confirmation sheet (the viewer can't show confirm(), so this sheet is the confirmation) ----
    const sheet = view.region('sheet:confirm_reset');
    sheet.setAttribute('aria-labelledby', 'home-reset-title');
    sheet.replaceChildren(
      h('div', { class: 'sheet__handle', 'aria-hidden': 'true' }),
      h('h2', { class: 'sheet__title', id: 'home-reset-title' }, copy.resetTitle),
      h('p', { class: 'sheet__note' }, copy.resetBody),
      h('div', { class: 'sheet__actions' },
        h('button', { type: 'button', class: 'btn btn--block home__danger', 'data-action': 'reset-confirm' }, copy.resetConfirm),
        h('button', { type: 'button', class: 'btn btn--ghost btn--block', 'data-action': 'reset-cancel', 'data-autofocus': '' }, copy.resetCancel)),
    );
    const cancelBtn = sheet.querySelector<HTMLElement>('[data-action="reset-cancel"]')!;
    sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') ctx.emit('nav:close_sheet', {}); });
    sheet.addEventListener('click', (e) => {
      const action = (e.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'reset-confirm') {
        ctx.emit('progress:clear', {});
        ctx.emit('nav:close_sheet', {});
      } else if (action === 'reset-cancel') ctx.emit('nav:close_sheet', {});
    });

    // ---- level path: rebuilt only when the levels list or chapters change ----
    let tiles: Tile[] = [];
    let chapters: ChapterView[] = [];
    let builtFor: { list: LevelsState['list']; chapters: LevelsState['chapters'] } | null = null;
    let suggested = 1;
    let lastCurrent: number | null = null;

    function buildPath(levels: LevelsState) {
      builtFor = { list: levels.list, chapters: levels.chapters };
      tiles = [];
      chapters = [];
      const count = levels.list.length;
      const groups = levels.chapters.length ? levels.chapters : [{ id: 'all', name: '', from: 1, to: count }];
      const out: HTMLElement[] = [];
      groups.forEach((ch, i) => {
        const eyebrow = ch.name ? fmt(copy.chapter, { n: i + 1, name: ch.name }) : '';
        const range = fmt(copy.chapterRange, { from: ch.from, to: ch.to });
        const grid = h('div', { class: 'level-grid' });
        for (let id = ch.from; id <= Math.min(ch.to, count); id++) {
          const el = h('button', { type: 'button', class: 'level-tile', 'data-level-tile': '', 'data-level': id }, String(id));
          tiles[id] = { el, key: '' };
          grid.append(el);
        }
        const open = h('section', { class: 'home__chapter', 'data-chapter': ch.id },
          h('div', { class: 'chapter' }, h('span', { class: 'eyebrow' }, eyebrow), h('span', { class: 'chapter__meta' }, range)),
          grid);
        const dim = h('div', { class: 'glyph glyph--dim', 'aria-hidden': 'true' });
        for (let k = 0; k < 9; k++) dim.append(h('i'));
        const locked = h('div', { class: 'chapter', 'data-locked': 'true', 'data-chapter': ch.id, hidden: true },
          dim,
          h('div', { class: 'chapter__body' },
            h('span', { class: 'eyebrow' }, eyebrow),
            h('span', { class: 'chapter__meta' }, fmt(copy.chapterLocked, { level: ch.from }))));
        chapters.push({ from: ch.from, to: ch.to, open, locked });
        out.push(open, locked);
      });
      chaptersHost.replaceChildren(...out);
    }

    function paintTile(t: Tile, id: number, locked: boolean, current: boolean, stars: number) {
      const el = t.el;
      setAttr(el, 'data-stars', String(stars));
      setAttr(el, 'data-locked', String(locked));
      setAttr(el, 'data-current', String(current));
      setAttr(el, 'aria-disabled', locked ? 'true' : null);
      setAttr(el, 'aria-current', current ? 'step' : null);
      setAttr(el, 'aria-label', locked
        ? fmt(copy.tileLocked, { level: id })
        : stars ? fmt(copy.tileSolved, { level: id, stars }) : fmt(copy.tileOpen, { level: id }));
      const key = locked ? 'locked' : current && !stars ? 'play' : `stars${stars}`;
      if (key === t.key) return;
      t.key = key;
      while (el.childNodes.length > 1) el.lastChild!.remove();
      if (key === 'play') el.append(h('span', { class: 'level-tile__tag', 'aria-hidden': 'true' }, copy.play));
      else if (stars) el.append(starsEl(stars));
    }

    function update() {
      const levels = ctx.read('levels');
      const progress = ctx.read('progress');
      const storage = ctx.read('storage');
      const snd = ctx.read('sound');
      const ready = levels?.status === 'ready';
      const count = ready ? levels.list.length : 0;

      levelsError.hidden = levels?.status !== 'error';
      cont.hidden = levels?.status === 'error';
      cont.disabled = !ready;

      if (ready && (builtFor?.list !== levels.list || builtFor?.chapters !== levels.chapters)) buildPath(levels);
      if (!ready && builtFor) { chaptersHost.replaceChildren(); tiles = []; chapters = []; builtFor = null; }

      const results = progress?.save.results ?? {};
      const unlockedUpTo = progress ? Math.max(1, progress.unlockedUpTo) : count;
      const pick = suggestLevel(count, progress);
      suggested = pick.levelId;

      // header: star total
      let earned = 0;
      let solved = 0;
      for (let id = 1; id <= count; id++) {
        const r = results[String(id)];
        if (r) { earned += r.stars; solved++; }
      }
      total.hidden = !progress || !ready;
      setText(totalNum, String(earned));
      setText(totalOf, `/ ${count * MAX_STARS}`);
      setAttr(total, 'aria-label', fmt(copy.starTotal, { stars: earned, max: count * MAX_STARS }));

      // hero
      setText(contLabel, pick.fresh ? copy.start : copy.continue);
      setText(contLevel, fmt(copy.level, { level: suggested }));
      const saved = storage?.status === 'ok';
      const parts: string[] = [];
      if (progress && ready) parts.push(solved === count ? copy.allSolved : fmt(copy.solvedCount, { solved, total: count }));
      if (progress && saved && solved !== count) parts.push(copy.savedNote);
      setText(caption, parts.join(' · '));
      caption.hidden = parts.length === 0;

      // tiles and chapters
      for (let id = 1; id < tiles.length; id++) {
        const t = tiles[id];
        if (!t) continue;
        paintTile(t, id, id > unlockedUpTo, id === suggested, results[String(id)]?.stars ?? 0);
      }
      for (const ch of chapters) {
        const locked = ch.from > unlockedUpTo;
        ch.open.hidden = locked;
        ch.locked.hidden = !locked;
      }

      // footer
      const scoring = progress?.scoring;
      legend.hidden = !scoring;
      if (scoring) paintLegend(scoring);
      sound.hidden = !snd;
      if (snd) {
        setAttr(sound, 'aria-pressed', String(snd.enabled));
        setText(soundLabel, snd.enabled ? copy.soundOn : copy.soundOff);
        const want = snd.enabled ? 'on' : 'off';
        if (soundIcon.dataset.state !== want) {
          soundIcon.dataset.state = want;
          soundIcon.replaceChildren(svg(snd.enabled ? ICON_SOUND_ON : ICON_SOUND_OFF));
        }
      }
      reset.hidden = !progress;

      if (ready && lastCurrent !== suggested) {
        lastCurrent = suggested;
        revealCurrent();
      }
    }

    let legendKey = '';
    function paintLegend(s: NonNullable<ProgressState['scoring']>) {
      const key = JSON.stringify(s);
      if (key === legendKey) return;
      legendKey = key;
      const L = copy.starLegend;
      const item = (stars: number, text: string) => h('span', { class: 'home__legend-item' }, stars ? starsEl(stars, 'stars stars--xs') : null, text);
      const three = s.threeStarsWithin > 0 ? fmt(L.two, { within: s.threeStarsWithin }) : L.three; // "par +N" when par itself has slack
      const items = [item(3, three), item(2, fmt(L.two, { within: s.twoStarsWithin })), item(1, L.one), item(0, fmt(L.hint, { cost: s.hintCost }))];
      for (const it of items) it.querySelectorAll('.star[data-state="off"]').forEach((x) => x.remove());
      legend.replaceChildren(...items.flatMap((it, i) => (i ? [h('span', { class: 'home__sep', 'aria-hidden': 'true' }), it] : [it])));
    }

    /** keep the current tile on screen when home appears; no smooth scroll, no move if it is already visible */
    let pendingReveal = false;
    function revealCurrent() {
      if (pendingReveal || typeof requestAnimationFrame !== 'function') return;
      pendingReveal = true;
      requestAnimationFrame(() => {
        pendingReveal = false;
        if (region.hidden) return;
        const tile = tiles[suggested]?.el;
        if (!tile || typeof tile.scrollIntoView !== 'function') return;
        const box = region.getBoundingClientRect();
        const r = tile.getBoundingClientRect();
        if (r.height === 0) return;
        const top = Math.max(box.top, 0);
        const bottom = Math.min(box.bottom, window.innerHeight);
        if (r.top < top || r.bottom > bottom) tile.scrollIntoView({ block: 'center' });
      });
    }

    region.addEventListener('click', (e) => {
      const target = e.target as Element;
      const tile = target.closest<HTMLElement>('[data-level-tile]');
      if (tile) {
        if (tile.dataset.locked === 'true') return;
        ctx.emit('levels:start', { levelId: Number(tile.dataset.level) });
        return;
      }
      const action = target.closest<HTMLElement>('[data-action]');
      if (!action || (action as HTMLButtonElement).disabled) return;
      switch (action.dataset.action) {
        case 'continue': ctx.emit('levels:start', { levelId: suggested }); break;
        case 'learn': ctx.emit('learn:open', {}); break;
        case 'sound': {
          const snd = ctx.read('sound');
          if (snd) ctx.emit('sound:set', { enabled: !snd.enabled });
          break;
        }
        case 'reset': ctx.emit('nav:open_sheet', { sheet: 'confirm_reset' }); break;
      }
    });

    for (const slice of ['levels', 'progress', 'storage', 'sound'] as const) ctx.watch(slice, update);
    // the Learn entry shows only when a learn module is running (it owns the learn slice)
    const showLearn = () => { learn.hidden = ctx.read('learn') === undefined; };
    ctx.watch('learn', showLearn);
    let lastNav: string | null = null;
    ctx.watch('nav', (nav) => {
      const key = `${nav?.screen}/${nav?.sheet}`;
      if (key === lastNav) return;
      lastNav = key;
      if (nav?.screen === 'home' && !nav.sheet) revealCurrent();
      // the shell focuses the first button (the destructive one); move focus to the safe choice
      if (nav?.sheet === 'confirm_reset') {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => cancelBtn.focus({ preventScroll: true }));
        else cancelBtn.focus({ preventScroll: true });
      }
    });
    showLearn();
    update();

    return {
      start: update,
      debug: () => ({ suggested, tiles: tiles.length - 1 }),
    };
  },
};
export default homeView;
