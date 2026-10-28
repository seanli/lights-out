// solved-sheet: the end-of-level moment. After the board's sweep, opens view.region('sheet:solved') with the
// stars from progress (when present), moves vs par, and next / replay / levels. Works for the classic path and
// for Variety rooms (levels:started says which pack, the index inside it, the next level and whether it is a boss).
import * as v from 'valibot';
import { CUSTOM_LEVEL_ID, type Events, type LevelId, type ModuleDef, type Scoring } from '../../contracts';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import { skull } from '../../lib/icons';
import './solved-sheet.css';

const Text = v.pipe(v.string(), v.minLength(1));
const Rules = v.object({ delayMs: v.pipe(v.number(), v.minValue(0)) });
const Copy = v.object({
  eyebrow: Text, title: Text, bossTitle: Text, moves: Text, move: Text, par: Text, stars: Text,
  atPar: Text, overPar: Text, hinted: Text,
  next: Text, replay: Text, levels: Text,
  allDoneTitle: Text, allDoneBody: Text, allDonePerfect: Text, backToLevels: Text, lastLevel: Text,
  roomEyebrow: Text, roomDone: Text, roomLast: Text, nextMeta: Text,
  /** a custom puzzle: another one with the same settings, or back to the settings */
  customNext: Text, customSettings: Text,
});
type CopyT = v.InferOutput<typeof Copy>;
type Solved = Events['board:solved'];
type Completed = Events['progress:level_completed'];
type Started = Events['levels:started'];
/** where a level sits: its pack, its 1-based place in it, the level after it in the same pack (null after the last), boss or not */
interface Place { pack: string; index: number; next: LevelId | null; boss: boolean }

const MAX_STARS = 3;

/** stars the moves alone would have earned, so hint-lost stars can show as outlines */
function baseStars(moves: number, par: number, s: Scoring): number {
  const over = moves - par;
  return over <= s.threeStarsWithin ? 3 : over <= s.twoStarsWithin ? 2 : 1;
}

const solvedSheet: ModuleDef = {
  manifest: {
    name: 'solved-sheet',
    emits: ['nav:open_sheet', 'nav:close_sheet', 'nav:go', 'levels:start', 'variety:open', 'custom:play', 'custom:open', 'board:restart'],
    listens: ['board:solved', 'progress:level_completed', 'levels:started', 'board:loaded', 'board:restarted', 'kernel:state_loaded'],
    owns: [],
    uses: ['view', 'clock'],
    data: { rules: Rules, copy: Copy },
  },
  init(ctx) {
    const { delayMs } = ctx.data.rules as v.InferOutput<typeof Rules>;
    const copy = ctx.data.copy as CopyT;
    const view = ctx.need('view');
    const clock = ctx.need('clock');

    /** the solve on show (or about to be), and progress's verdict for it, whichever arrives first */
    let solved: Solved | null = null;
    let completed: Completed | null = null;
    /** the latest levels:started, kept so the sheet knows the pack, index and next level of the solve */
    let started: Started | null = null;
    let cancelTimer: (() => void) | null = null;

    // ---- DOM, built once ----
    const sheet = view.region('sheet:solved');
    sheet.setAttribute('aria-labelledby', 'solved-title');
    const eyebrow = h('span', { class: 'eyebrow' });
    // after a boss: a skull over the title, which says "Boss beaten." (stars follow the same rules)
    const mark = h('span', { class: 'solved__boss', hidden: true }, skull());
    const title = h('h2', { class: 'sheet__title', id: 'solved-title' });
    const stars = h('div', { class: 'stars stars--lg stars--reveal solved__stars', role: 'img' });
    const movesText = h('span');
    const parText = h('span', { class: 'dim' });
    const result = h('p', { class: 'sheet__result', 'data-result': '' }, movesText, parText);
    const note = h('p', { class: 'sheet__note' });
    const extra = h('p', { class: 'sheet__note', hidden: true });
    const nextLevel = h('span');
    const nextText = h('span', {}, copy.next);
    const nextDot = h('span', { class: 'btn__meta', 'aria-hidden': 'true' }, '·');
    const next = h('button', { type: 'button', class: 'btn btn--primary btn--block', 'data-action': 'next' }, nextText, nextDot, nextLevel);
    const replay = h('button', { type: 'button', class: 'btn btn--ghost', 'data-action': 'replay' }, copy.replay);
    const levels = h('button', { type: 'button', class: 'btn btn--ghost', 'data-action': 'levels' }, copy.levels);
    const row = h('div', { class: 'solved__row' }, replay, levels);
    const actions = h('div', { class: 'sheet__actions' }, next, row);
    sheet.classList.add('solved');
    sheet.replaceChildren(mark, eyebrow, title, stars, result, note, extra, actions);

    /** classic levels on the path (the list also holds the Variety rooms' levels) */
    const classicCount = (): number | undefined => {
      const lv = ctx.read('levels');
      if (lv?.status !== 'ready') return undefined;
      return lv.packs?.find((p) => p.kind === 'classic')?.count ?? lv.list.filter((l) => (l.pack ?? 'classic') === 'classic').length;
    };
    /** from levels:started when it was about this level; otherwise worked out from the levels slice (e.g. after a hot reload) */
    function placeOf(levelId: LevelId): Place {
      if (levelId === CUSTOM_LEVEL_ID) return { pack: 'custom', index: ctx.read('custom')?.played ?? 1, next: null, boss: false };
      if (started && started.levelId === levelId && started.pack !== undefined && started.index !== undefined && started.next !== undefined) {
        return { pack: started.pack, index: started.index, next: started.next, boss: !!started.boss };
      }
      const lv = ctx.read('levels');
      const def = lv?.list.find((l) => l.id === levelId);
      const pack = def?.pack ?? 'classic';
      const boss = !!def?.boss;
      if (pack === 'classic') {
        const count = classicCount();
        return { pack, index: levelId, next: count === undefined || levelId < count ? levelId + 1 : null, boss };
      }
      const p = lv?.packs?.find((x) => x.id === pack);
      const index = def?.index ?? (p ? levelId - p.first + 1 : 1);
      return { pack, index, next: p && index < p.count ? p.first + index : null, boss };
    }

    sheet.addEventListener('click', (e) => {
      const action = (e.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (!action || !solved) return;
      const id: LevelId = solved.levelId;
      const place = placeOf(id);
      if (place.pack === 'custom') {
        // a custom puzzle: New puzzle (same settings), Replay this one, or back to the settings
        if (action === 'next') ctx.emit('custom:play', {});
        else if (action === 'replay') { ctx.emit('nav:close_sheet', {}); ctx.emit('board:restart', {}); }
        else if (action === 'levels') ctx.emit('custom:open', {});
        return;
      }
      if (action === 'next' && place.next !== null) ctx.emit('levels:start', { levelId: place.next });
      else if (action === 'replay') ctx.emit('levels:start', { levelId: id });
      else if (action === 'levels') {
        // back to this board's levels (the board screen); without the variety module, the menu
        if (ctx.read('variety') !== undefined) ctx.emit('variety:open', { room: place.pack });
        else ctx.emit('nav:go', { screen: 'home' });
      }
    });

    function paintStars(earned: number, lost: number) {
      const key = `${earned}/${lost}`;
      if (stars.dataset.key === key) return;
      stars.dataset.key = key;
      // new nodes so the fill-in animation runs again for each solve
      const list: HTMLElement[] = [];
      for (let i = 0; i < MAX_STARS; i++) {
        list.push(h('span', { class: 'star', 'data-state': i < earned ? 'on' : i < earned + lost ? 'lost' : 'off', 'aria-hidden': 'true' }));
      }
      stars.replaceChildren(...list);
    }

    function render() {
      if (!solved) return;
      const { levelId, moves, par } = solved;
      const done = completed && completed.levelId === levelId ? completed : null;
      const place = placeOf(levelId);
      const custom = place.pack === 'custom';
      const lv = ctx.read('levels');
      const room = place.pack === 'classic' || custom ? null : (lv?.packs?.find((p) => p.id === place.pack) ?? { id: place.pack, name: place.pack, count: place.index });
      const progress = ctx.read('progress');
      const count = classicCount();
      const last = place.next === null;
      // only the solve that finished the classic set celebrates it; later replays get the normal note
      const allDone = !room && !custom && !!done && done.allSolved && done.firstSolve;
      const classicResults = Object.entries(progress?.save.results ?? {}).filter(([k]) => count === undefined || Number(k) <= count).map(([, r]) => r);
      const perfect = count !== undefined && classicResults.length >= count && classicResults.every((r) => r.stars === MAX_STARS);
      const roomDone = !!room && (progress?.packs?.[room.id]?.solved ?? 0) >= room.count;

      setText(eyebrow, custom ? (ctx.read('custom')?.label ?? '') : room ? fmt(copy.roomEyebrow, { room: room.name, level: place.index }) : fmt(copy.eyebrow, { level: levelId }));
      setText(title, allDone ? fmt(copy.allDoneTitle, { total: count ?? levelId }) : place.boss ? copy.bossTitle : copy.title);
      mark.hidden = !place.boss;
      setAttr(sheet, 'data-boss', place.boss ? 'true' : null);

      stars.hidden = !done;
      if (done) {
        const scoring = progress?.scoring;
        const lost = scoring && done.hintsUsed > 0 ? Math.max(0, Math.min(MAX_STARS, baseStars(moves, par, scoring)) - done.stars) : 0;
        setAttr(stars, 'data-stars-earned', String(done.stars));
        setAttr(stars, 'aria-label', fmt(copy.stars, { stars: done.stars }));
        paintStars(done.stars, lost);
      } else {
        setAttr(stars, 'data-stars-earned', null);
      }

      setText(movesText, fmt(moves === 1 ? copy.move : copy.moves, { moves }));
      setText(parText, fmt(copy.par, { par }));
      // the note speaks only when it tells the player something to do (over par, or hinted)
      const line = done && done.hintsUsed > 0 ? copy.hinted
        : moves > par ? fmt(copy.overPar, { over: moves - par, par })
        : '';
      const text = allDone ? (perfect ? copy.allDonePerfect : copy.allDoneBody) : line;
      setText(note, text);
      note.hidden = !text;
      extra.hidden = !last || allDone || custom;
      setText(extra, room ? (roomDone ? copy.roomDone : copy.roomLast) : copy.lastLevel);

      if (custom) {
        // a custom puzzle never runs out: New puzzle first, then Replay and Change board
        next.hidden = false;
        setText(nextText, copy.customNext);
        setText(nextDot, '');
        setText(nextLevel, '');
        levels.className = 'btn btn--ghost';
        setText(levels, copy.customSettings);
        row.append(levels);
        setAttr(next, 'data-autofocus', '');
        setAttr(levels, 'data-autofocus', null);
        return;
      }
      setText(nextText, copy.next);
      setText(nextDot, '·');
      // the last level has no next: the primary action goes back to the board's levels
      next.hidden = last;
      setText(nextLevel, place.next === null ? '' : fmt(copy.nextMeta, { level: room ? place.index + 1 : place.next }));
      levels.className = last ? 'btn btn--primary btn--block' : 'btn btn--ghost';
      setText(levels, last ? copy.backToLevels : copy.levels);
      if (last) actions.prepend(levels); else row.append(levels);
      setAttr(next, 'data-autofocus', last ? null : '');
      setAttr(levels, 'data-autofocus', last ? '' : null);
    }

    function cancel() {
      cancelTimer?.();
      cancelTimer = null;
    }
    const playing = () => {
      const nav = ctx.read('nav');
      return !nav || nav.screen === 'play';
    };

    ctx.on('board:solved', (p) => {
      cancel();
      solved = p;
      // keep a verdict that already arrived for this level in this same drain
      if (completed && completed.levelId !== p.levelId) completed = null;
      // nothing is drawn during the winning tap itself; the sheet renders when it opens
      // with reduced motion there is no sweep to wait for
      const wait = ctx.service('view')?.reducedMotion() ? Math.min(delayMs, 150) : delayMs;
      cancelTimer = clock.setTimeout(() => {
        cancelTimer = null;
        if (!solved || solved !== p || !playing()) return;
        delete stars.dataset.key; // fresh star nodes so the fill-in plays on every open
        render();
        ctx.emit('nav:open_sheet', { sheet: 'solved' });
      }, wait);
    });
    ctx.on('progress:level_completed', (p) => {
      completed = p;
      if (solved?.levelId === p.levelId && ctx.read('nav')?.sheet === 'solved') render();
    });
    // a new board (next, replay, restart, another level) cancels a sheet that hasn't opened yet
    const reset = () => { cancel(); solved = null; completed = null; };
    ctx.on('levels:started', (p) => { reset(); started = p; });
    ctx.on('board:loaded', reset);
    ctx.on('board:restarted', reset);
    ctx.watch('nav', (nav) => { if (nav && nav.screen !== 'play') cancel(); });

    // After a hot reload restores a snapshot with the sheet open, rebuild it from the slices
    // (this instance's memory of the solve is gone); with no solved board, close it.
    ctx.on('kernel:state_loaded', ({ restored }) => {
      if (!restored || ctx.read('nav')?.sheet !== 'solved' || solved) return;
      const b = ctx.read('board');
      if (!b || b.status !== 'solved' || b.levelId === null) { ctx.emit('nav:close_sheet', {}); return; }
      solved = { levelId: b.levelId, moves: b.moves, par: b.par };
      const best = ctx.read('progress')?.save.results[String(b.levelId)];
      completed = best
        ? { levelId: b.levelId, stars: best.stars, moves: b.moves, par: b.par, hintsUsed: 0, improved: false, unlocked: null, allSolved: false, firstSolve: false }
        : null;
      delete stars.dataset.key;
      render();
    });

    return {
      stop: cancel,
      debug: () => ({ solved, completed, started, pending: !!cancelTimer }),
    };
  },
};
export default solvedSheet;
