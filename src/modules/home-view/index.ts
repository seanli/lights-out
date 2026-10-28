// home-view: the menu (The Good Sudoku pattern). Continue on top, then every board as its own row in three quiet
// sections (Boards, Shapes, Extreme), then Learn, Reset and the release version at the very bottom.
// Renders view.region('screen:home') and the reset confirmation sheet. Reads levels, progress, storage, sound,
// learn, variety and nav, and the env service when present; emits commands only. A board's levels live on the board
// screen (the variety module).
import * as v from 'valibot';
import type { Env, LevelsState, ModuleDef, Pack, ProgressState } from '../../contracts';
import { roomGlyph } from '../../lib/glyph';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import './home-view.css';

const Text = v.pipe(v.string(), v.minLength(1));
const Copy = v.object({
  title: Text,
  continue: Text,
  start: Text,
  level: Text,
  roomLevel: Text,
  solvedCount: Text,
  savedNote: Text,
  allSolved: Text,
  levelsError: Text,
  starTotal: Text,
  /** the menu's section eyebrows, by Pack.group */
  groups: v.object({ boards: Text, shapes: Text, extreme: Text }),
  boardSize: Text,
  /** a rectangle with a note after its size, e.g. "5×16 · scrolls · 30 levels" */
  boardSizeNote: Text,
  boardShape: Text,
  /** a short note on a board's meta line, by pack id (the Tower scrolls) */
  boardNotes: v.record(v.string(), Text),
  boardSolved: Text,
  boardLocked: Text,
  boardLabel: Text,
  learn: Text,
  learnSub: Text,
  learnNew: Text,
  soundOn: Text,
  soundOff: Text,
  sound: Text,
  reset: Text,
  resetTitle: Text,
  resetBody: Text,
  resetConfirm: Text,
  resetCancel: Text,
  /** the caption at the very bottom: env.version and the build date (from env.buildId, UTC yyyymmddhhmm) */
  version: Text,
  versionOnly: Text,
  date: Text,
  months: v.pipe(v.array(Text), v.length(12)),
});
type CopyT = v.InferOutput<typeof Copy>;

/** the first-visit "New here? Learn the patterns" link shows until this classic level is solved */
const LEARN_LINK_UNTIL = 3;

type Results = ProgressState['save']['results'];
/** a board's standing: open (rooms wait for progress.varietyOpen), highest startable index, levels solved, stars */
export interface Tally { open: boolean; unlocked: number; solved: number; stars: number }

/** the menu's sections, top to bottom */
export const GROUPS = ['boards', 'shapes', 'extreme'] as const;
export type Group = (typeof GROUPS)[number];
/** a pack's section (Pack.group; packs from before groups: shapes by kind, everything else under Boards) */
export const groupOf = (p: Pack): Group => p.group ?? (p.kind === 'shape' ? 'shapes' : 'boards');

/** "Version 0.7.0 · 28 Oct 2026" from the env service; just the version when the build id isn't a date; '' without one */
export function versionLine(env: Pick<Env, 'version' | 'buildId'> | undefined, copy: CopyT): string {
  if (!env?.version) return '';
  const m = /^(\d{4})(\d{2})(\d{2})\d{4}$/.exec(env.buildId ?? '');
  const month = m ? copy.months[Number(m[2]) - 1] : undefined;
  if (!m || !month || Number(m[3]) < 1 || Number(m[3]) > 31) return fmt(copy.versionOnly, { version: env.version });
  return fmt(copy.version, { version: env.version, date: fmt(copy.date, { day: Number(m[3]), month, year: m[1]! }) });
}

/** the boards in menu order (classic first); none until the levels are ready */
export const boardsOf = (levels: LevelsState | undefined): Pack[] => (levels?.status === 'ready' ? levels.packs ?? [] : []);

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

/** the lowest startable unsolved level of a board (global id), or null */
function nextIn(pack: Pack, t: Tally, results: Results): number | null {
  if (!t.open) return null;
  for (let id = pack.first; id < pack.first + t.unlocked; id++) if (!results[String(id)]) return id;
  return null;
}

/**
 * The level Continue starts. The board last played (classic when unknown or locked): its lowest startable unsolved
 * level; else classic's; else the first board with one; when everything open is solved, the last played level.
 */
export function suggest(boards: Pack[], progress: ProgressState | undefined): { levelId: number; pack: Pack | null; fresh: boolean } {
  const classic = boards.find((p) => p.kind === 'classic') ?? boards[0];
  if (!classic) return { levelId: progress?.save.lastLevel || 1, pack: null, fresh: !progress };
  const tallies = new Map(boards.map((p) => [p, tally(p, progress)]));
  if (!progress || ![...tallies.values()].some((t) => t.solved > 0)) return { levelId: classic.first, pack: classic, fresh: true };
  const results = progress.save.results;
  const last = progress.save.lastLevel;
  const lastPack = boards.find((p) => last >= p.first && last < p.first + p.count && tallies.get(p)!.open);
  for (const p of [lastPack ?? classic, classic, ...boards]) {
    const id = nextIn(p, tallies.get(p)!, results);
    if (id !== null) return { levelId: id, pack: p, fresh: false };
  }
  if (lastPack) return { levelId: last, pack: lastPack, fresh: false };
  return { levelId: classic.first + tallies.get(classic)!.unlocked - 1, pack: classic, fresh: false };
}

const svg = (paths: string) => {
  const span = document.createElement('span');
  span.innerHTML = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
  return span.firstElementChild!;
};
const ICON_SOUND_ON = '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 010 7"/><path d="M19 6a8.5 8.5 0 010 12"/>';
const ICON_SOUND_OFF = '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l5 6M22 9l-5 6"/>';
/** the logo: a lit plus on a 3×3 grid */
const GLYPH_LIT = [1, 3, 4, 5, 7];
/** Learn's picture: one tap's plus, lit on a dark 5×5 board (drawn like a board's room glyph) */
const LEARN_LIT = [7, 11, 12, 13, 17];

interface Row { pack: Pack; el: HTMLButtonElement; glyph: HTMLElement; meta: HTMLElement; score: HTMLElement; solved: HTMLElement; stars: HTMLElement; key: string }

const homeView: ModuleDef = {
  manifest: {
    name: 'home-view',
    emits: ['levels:start', 'sound:set', 'learn:open', 'variety:open', 'nav:open_sheet', 'nav:close_sheet', 'progress:clear'],
    listens: [],
    owns: [],
    uses: ['view'],
    optional: ['env'],
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
    const total = h('span', { class: 'chip chip--lg', 'data-star-total': '', role: 'img' },
      h('span', { class: 'stars', 'aria-hidden': 'true' }, h('span', { class: 'star', 'data-state': 'on' })), totalNum);

    const contLabel = h('span');
    const contLevel = h('span');
    const cont = h('button', { type: 'button', class: 'btn btn--primary btn--block', 'data-action': 'continue' },
      contLabel, h('span', { class: 'btn__meta', 'aria-hidden': 'true' }, '·'), contLevel);
    const caption = h('p', { class: 'muted home__caption', 'data-home-caption': '' });
    const learnLink = h('button', { type: 'button', class: 'btn btn--link home__link', 'data-action': 'learn', hidden: true }, copy.learnNew);
    const levelsError = h('p', { class: 'home__error', role: 'alert', hidden: true }, copy.levelsError);

    // one quiet section per group; a section with no boards stays hidden
    const sections = GROUPS.map((group) => {
      const list = h('div', { class: 'menu-list' });
      const el = h('section', { class: 'section', 'data-group': group, 'aria-labelledby': `home-group-${group}`, hidden: true },
        h('h2', { class: 'eyebrow', id: `home-group-${group}` }, copy.groups[group]), list);
      return { group, el, list };
    });
    const boards = h('div', { class: 'home__boards', hidden: true }, ...sections.map((x) => x.el));
    const learnGlyph = h('span', { class: 'room-glyph', 'aria-hidden': 'true', style: '--cols:5;--n:5' });
    for (let i = 0; i < 25; i++) learnGlyph.append(h('i', { 'data-lit': String(LEARN_LIT.includes(i)) }));
    const learn = h('button', { type: 'button', class: 'menu-row', 'data-action': 'learn' },
      h('span', { class: 'menu-row__glyph' }, learnGlyph),
      h('span', { class: 'menu-row__body' }, h('span', { class: 'menu-row__title' }, copy.learn), h('span', { class: 'menu-row__sub' }, copy.learnSub)));
    const learnList = h('div', { class: 'menu-list home__learn', hidden: true }, learn);

    const soundIcon = h('span', { class: 'home__icon' });
    const sound = h('button', { type: 'button', class: 'btn btn--icon', 'data-action': 'sound', 'aria-label': copy.sound, hidden: true }, soundIcon);
    const reset = h('button', { type: 'button', class: 'btn btn--link home__reset', 'data-action': 'reset', hidden: true }, copy.reset);
    // the release, so the owner can tell which build is the latest (DECISIONS #47); built once, the env never changes
    const versionText = versionLine(ctx.service('env'), copy);
    const version = h('p', { class: 'home__version', 'data-home-version': '', hidden: !versionText }, versionText);

    region.replaceChildren(
      h('header', { class: 'home__top' },
        h('div', { class: 'home__logo' }, glyph, h('h1', { class: 'display' }, copy.title)),
        h('div', { class: 'home__tools' }, sound, total)),
      h('section', { class: 'home__hero' }, cont, caption, learnLink),
      levelsError,
      boards,
      learnList,
      h('footer', { class: 'home__footer' }, reset, version),
    );

    // ---- reset confirmation sheet (the viewer can't show confirm(), so this sheet is the confirmation) ----
    const sheet = view.region('sheet:confirm_reset');
    sheet.setAttribute('aria-labelledby', 'home-reset-title');
    sheet.replaceChildren(
      h('div', { class: 'sheet__handle', 'aria-hidden': 'true' }),
      h('h2', { class: 'sheet__title', id: 'home-reset-title' }, copy.resetTitle),
      h('p', { class: 'sheet__note' }, copy.resetBody),
      h('div', { class: 'sheet__actions' },
        h('button', { type: 'button', class: 'btn btn--block btn--danger', 'data-action': 'reset-confirm' }, copy.resetConfirm),
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

    // ---- board rows: rebuilt only when the packs change; painted in place ----
    let rows: Row[] = [];
    let builtFor: Pack[] | null = null;
    let suggested = 1;

    function buildRows(packs: Pack[]) {
      builtFor = packs;
      rows = packs.map((pack) => {
        const glyphHost = h('span', { class: 'menu-row__glyph' });
        const meta = h('span', { class: 'menu-row__sub' });
        const solved = h('span', { class: 'home__solved num' });
        const stars = h('span', { class: 'num' });
        const score = h('span', { class: 'menu-row__end home__score' }, solved,
          h('span', { class: 'home__starline' }, h('span', { class: 'star', 'data-state': 'on', 'aria-hidden': 'true' }), stars));
        const el = h('button', { type: 'button', class: 'menu-row', 'data-room-tile': '', 'data-room': pack.id },
          glyphHost, h('span', { class: 'menu-row__body' }, h('span', { class: 'menu-row__title' }, pack.name), meta), score);
        return { pack, el, glyph: glyphHost, meta, score, solved, stars, key: '' };
      });
      for (const x of sections) {
        const mine = rows.filter((r) => groupOf(r.pack) === x.group);
        x.list.replaceChildren(...mine.map((r) => r.el));
        x.el.hidden = mine.length === 0;
      }
    }

    const metaOf = (pack: Pack) => {
      const vars = { cols: pack.shape.cols, rows: pack.shape.rows, count: pack.count };
      if (pack.kind === 'shape') return fmt(copy.boardShape, vars);
      const note = copy.boardNotes[pack.id];
      return note ? fmt(copy.boardSizeNote, { ...vars, note }) : fmt(copy.boardSize, vars);
    };

    function paintRow(r: Row, t: Tally) {
      const { pack, el } = r;
      const locked = !t.open;
      setAttr(el, 'data-solved', String(t.solved));
      setAttr(el, 'data-stars', String(t.stars));
      setAttr(el, 'data-locked', String(locked));
      setAttr(el, 'aria-disabled', locked ? 'true' : null);
      // a locked row reads well as it is ("Small room, Opens after level 20"); an open one needs its numbers spoken
      setAttr(el, 'aria-label', locked ? null : fmt(copy.boardLabel, { name: pack.name, solved: t.solved, count: pack.count, stars: t.stars }));
      setText(r.meta, locked ? copy.boardLocked : metaOf(pack));
      r.score.hidden = locked;
      setText(r.solved, locked ? '' : fmt(copy.boardSolved, { solved: t.solved, count: pack.count }));
      setText(r.stars, locked ? '' : String(t.stars));
      const key = `${locked}|${t.solved}`;
      if (key !== r.key) { r.key = key; r.glyph.replaceChildren(roomGlyph(pack, t.solved)); }
    }

    function update() {
      const levels = ctx.read('levels');
      const progress = ctx.read('progress');
      const storage = ctx.read('storage');
      const snd = ctx.read('sound');
      const ready = levels?.status === 'ready';
      const packs = boardsOf(levels);

      levelsError.hidden = levels?.status !== 'error';
      cont.hidden = levels?.status === 'error';
      cont.disabled = !ready;

      if (ready && builtFor !== levels.packs) buildRows(packs);
      if (!ready && builtFor) {
        for (const x of sections) { x.list.replaceChildren(); x.el.hidden = true; }
        rows = []; builtFor = null;
      }
      // the rows open the board screen, so they show only while the variety module runs (it owns the variety slice)
      boards.hidden = ctx.read('variety') === undefined || rows.length === 0;

      // every board's standing, once
      let solved = 0, count = 0, stars = 0;
      for (const r of rows) {
        const t = tally(r.pack, progress);
        paintRow(r, t);
        stars += t.stars;
        if (t.open) { solved += t.solved; count += r.pack.count; }
      }

      // header: every board's stars
      total.hidden = !progress || !ready;
      setText(totalNum, String(stars));
      setAttr(total, 'aria-label', fmt(copy.starTotal, { stars }));

      // hero
      const pick = suggest(packs, progress);
      suggested = pick.levelId;
      setText(contLabel, pick.fresh ? copy.start : copy.continue);
      setText(contLevel, pick.pack && pick.pack.kind !== 'classic'
        ? fmt(copy.roomLevel, { room: pick.pack.name, level: pick.levelId - pick.pack.first + 1 })
        : fmt(copy.level, { level: suggested }));
      const parts: string[] = [];
      if (progress && ready && count > 0) parts.push(solved === count ? copy.allSolved : fmt(copy.solvedCount, { solved, total: count }));
      // reassurance for a first visit only
      if (progress && storage?.status === 'ok' && solved === 0) parts.push(copy.savedNote);
      setText(caption, parts.join(' · '));
      caption.hidden = parts.length === 0;

      // Learn: the row while a learn module runs (it owns the learn slice), plus a first-visit link under Continue
      const hasLearn = ctx.read('learn') !== undefined;
      learnList.hidden = !hasLearn;
      learnLink.hidden = !hasLearn || !!progress?.save.results[String(LEARN_LINK_UNTIL)];

      sound.hidden = !snd;
      if (snd) {
        setAttr(sound, 'aria-pressed', String(snd.enabled));
        setAttr(sound, 'title', snd.enabled ? copy.soundOn : copy.soundOff);
        const want = snd.enabled ? 'on' : 'off';
        if (soundIcon.dataset.state !== want) {
          soundIcon.dataset.state = want;
          soundIcon.replaceChildren(svg(snd.enabled ? ICON_SOUND_ON : ICON_SOUND_OFF));
        }
      }
      reset.hidden = !progress;
    }

    region.addEventListener('click', (e) => {
      const target = e.target as Element;
      const row = target.closest<HTMLElement>('[data-room-tile]');
      if (row) {
        if (row.getAttribute('aria-disabled') !== 'true') ctx.emit('variety:open', { room: row.dataset.room! });
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

    for (const slice of ['levels', 'progress', 'storage', 'sound', 'variety'] as const) ctx.watch(slice, update);
    // the learn slice changes on every practice tap; home only cares whether a learn module runs
    let hadLearn = ctx.read('learn') !== undefined;
    ctx.watch('learn', (l) => { if ((l !== undefined) !== hadLearn) { hadLearn = l !== undefined; update(); } });
    let lastSheet: string | null = null;
    ctx.watch('nav', (nav) => {
      const sheetNow = nav?.sheet ?? null;
      if (sheetNow === lastSheet) return;
      lastSheet = sheetNow;
      // the shell focuses the first button (the destructive one); move focus to the safe choice
      if (sheetNow === 'confirm_reset') {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => cancelBtn.focus({ preventScroll: true }));
        else cancelBtn.focus({ preventScroll: true });
      }
    });
    update();

    return {
      start: update,
      debug: () => ({ suggested, boards: rows.map((r) => r.pack.id) }),
    };
  },
};
export default homeView;
