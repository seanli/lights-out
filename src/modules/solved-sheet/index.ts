// solved-sheet: the end-of-level moment. After the board's sweep, opens view.region('sheet:solved') with the
// stars from progress (when present), moves vs par, and next / replay / levels.
import * as v from 'valibot';
import type { Events, LevelId, ModuleDef, Scoring } from '../../contracts';
import { fmt, h, setAttr, setText } from '../../lib/dom';
import './solved-sheet.css';

const Text = v.pipe(v.string(), v.minLength(1));
const Rules = v.object({ delayMs: v.pipe(v.number(), v.minValue(0)) });
const Copy = v.object({
  eyebrow: Text, title: Text, moves: Text, move: Text, par: Text, stars: Text,
  atPar: Text, overPar: Text, hinted: Text,
  next: Text, replay: Text, levels: Text,
  allDoneTitle: Text, allDoneBody: Text, allDonePerfect: Text, allDoneAction: Text, lastLevel: Text,
});
type CopyT = v.InferOutput<typeof Copy>;
type Solved = Events['board:solved'];
type Completed = Events['progress:level_completed'];

const MAX_STARS = 3;

/** stars the moves alone would have earned, so hint-lost stars can show as outlines */
function baseStars(moves: number, par: number, s: Scoring): number {
  const over = moves - par;
  return over <= s.threeStarsWithin ? 3 : over <= s.twoStarsWithin ? 2 : 1;
}

const solvedSheet: ModuleDef = {
  manifest: {
    name: 'solved-sheet',
    emits: ['nav:open_sheet', 'nav:close_sheet', 'nav:go', 'levels:start'],
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
    let cancelTimer: (() => void) | null = null;

    // ---- DOM, built once ----
    const sheet = view.region('sheet:solved');
    sheet.setAttribute('aria-labelledby', 'solved-title');
    const eyebrow = h('span', { class: 'eyebrow' });
    const title = h('h2', { class: 'sheet__title', id: 'solved-title' });
    const stars = h('div', { class: 'stars stars--lg stars--reveal solved__stars', role: 'img' });
    const movesText = h('span');
    const parText = h('span', { class: 'dim' });
    const result = h('p', { class: 'sheet__result', 'data-result': '' }, movesText, parText);
    const note = h('p', { class: 'sheet__note' });
    const extra = h('p', { class: 'sheet__note', hidden: true });
    const nextLevel = h('span', { class: 'num' });
    const next = h('button', { type: 'button', class: 'btn btn--primary btn--block', 'data-action': 'next' },
      copy.next, h('span', { class: 'btn__meta', 'aria-hidden': 'true' }, '·'), nextLevel);
    const replay = h('button', { type: 'button', class: 'btn btn--ghost', 'data-action': 'replay' }, copy.replay);
    const levels = h('button', { type: 'button', class: 'btn btn--ghost', 'data-action': 'levels' }, copy.levels);
    const row = h('div', { class: 'solved__row' }, replay, levels);
    const actions = h('div', { class: 'sheet__actions' }, next, row);
    sheet.replaceChildren(h('div', { class: 'sheet__handle', 'aria-hidden': 'true' }), eyebrow, title, stars, result, note, extra, actions);

    sheet.addEventListener('click', (e) => {
      const action = (e.target as Element).closest<HTMLElement>('[data-action]')?.dataset.action;
      if (!action || !solved) return;
      const id: LevelId = solved.levelId;
      if (action === 'next') ctx.emit('levels:start', { levelId: id + 1 });
      else if (action === 'replay') ctx.emit('levels:start', { levelId: id });
      else if (action === 'levels') ctx.emit('nav:go', { screen: 'home' });
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
      const count = ctx.read('levels')?.list.length;
      const last = count !== undefined && levelId >= count;
      // only the solve that finished the set celebrates it; later replays get the normal note
      const allDone = !!done && done.allSolved && done.firstSolve;
      const results = Object.values(ctx.read('progress')?.save.results ?? {});
      const perfect = count !== undefined && results.length >= count && results.every((r) => r.stars === MAX_STARS);

      setText(eyebrow, fmt(copy.eyebrow, { level: levelId }));
      setText(title, allDone ? fmt(copy.allDoneTitle, { total: count ?? levelId }) : copy.title);

      stars.hidden = !done;
      if (done) {
        const scoring = ctx.read('progress')?.scoring;
        const lost = scoring && done.hintsUsed > 0 ? Math.max(0, Math.min(MAX_STARS, baseStars(moves, par, scoring)) - done.stars) : 0;
        setAttr(stars, 'data-stars-earned', String(done.stars));
        setAttr(stars, 'aria-label', fmt(copy.stars, { stars: done.stars }));
        paintStars(done.stars, lost);
      } else {
        setAttr(stars, 'data-stars-earned', null);
      }

      setText(movesText, fmt(moves === 1 ? copy.move : copy.moves, { moves }));
      setText(parText, fmt(copy.par, { par }));
      const line = done && done.hintsUsed > 0 ? copy.hinted
        : moves <= par ? copy.atPar
        : fmt(copy.overPar, { over: moves - par, par });
      setText(note, allDone ? (perfect ? copy.allDonePerfect : copy.allDoneBody) : line);
      extra.hidden = !last || allDone;
      setText(extra, copy.lastLevel);

      // the last level has no next: the primary action goes back to the levels
      next.hidden = last;
      setText(nextLevel, String(levelId + 1));
      levels.className = last ? 'btn btn--primary btn--block' : 'btn btn--ghost';
      setText(levels, last ? copy.allDoneAction : copy.levels);
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
    ctx.on('levels:started', reset);
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
      debug: () => ({ solved, completed, pending: !!cancelTimer }),
    };
  },
};
export default solvedSheet;
