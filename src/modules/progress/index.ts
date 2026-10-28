// progress: stars, best moves, unlocks and pending hint costs, saved on every change.
// Works in memory when no storage service exists. Never deletes data it can't read: it keeps a backup.
import * as v from 'valibot';
import { CUSTOM_LEVEL_ID, type ModuleDef, type Pack, type ProgressSave, type ProgressState, type Scoring } from '../../contracts';
import { freshSave, mergeSaves, packProgress, readSave, starsFor, unlockedFrom } from './save';

const int = v.pipe(v.number(), v.integer());

const RulesSchema = v.pipe(
  v.object({
    threeStarsWithin: v.pipe(int, v.minValue(0)),
    twoStarsWithin: v.pipe(int, v.minValue(0)),
    hintCost: v.pipe(int, v.minValue(0)),
    minStars: v.pipe(int, v.minValue(1), v.maxValue(3)),
    saveKey: v.pipe(v.string(), v.minLength(1)),
    /** the Variety menu opens once this classic level is solved */
    varietyAfter: v.pipe(int, v.minValue(1)),
  }),
  v.check((r) => r.twoStarsWithin >= r.threeStarsWithin, 'twoStarsWithin must be at least threeStarsWithin'),
);
const CopySchema = v.object({
  recovered: v.string(),
  newerSave: v.string(),
  partlyRecovered: v.string(),
  saveFailed: v.string(),
});

const progress: ModuleDef = {
  manifest: {
    name: 'progress',
    emits: ['progress:loaded', 'progress:level_completed', 'progress:cleared', 'progress:save_failed', 'progress:clear'],
    listens: ['progress:clear', 'levels:started', 'levels:generated', 'hints:shown', 'board:solved', 'custom:started'],
    owns: ['progress'],
    uses: ['clock'],
    optional: ['storage', 'view'],
    data: { rules: RulesSchema, copy: CopySchema },
  },
  init(ctx) {
    const rules: v.InferOutput<typeof RulesSchema> = ctx.data.rules;
    const copy: v.InferOutput<typeof CopySchema> = ctx.data.copy;
    const { saveKey } = rules;
    const scoring: Scoring = {
      threeStarsWithin: rules.threeStarsWithin,
      twoStarsWithin: rules.twoStarsWithin,
      hintCost: rules.hintCost,
      minStars: rules.minStars,
    };
    const storage = ctx.service('storage');
    const view = ctx.service('view');
    const clock = ctx.need('clock');
    const now = () => clock.now();
    let warnedSaveFailed = false;
    /** true when a damaged save couldn't be backed up: then it is never overwritten this visit */
    let holdWrites = false;
    /** hints taken on the custom puzzle on screen: custom puzzles are never saved, so the count lives only in the slice */
    let customHints = 0;

    /** levels on the classic path (ids 1..count); Variety room levels are not counted */
    const levelCount = (): number | undefined => {
      const lv = ctx.read('levels');
      if (lv?.status !== 'ready') return undefined;
      const n = lv.packs?.find((p) => p.kind === 'classic')?.count ?? lv.list.filter((l) => (l.pack ?? 'classic') === 'classic').length;
      return n > 0 ? n : undefined;
    };
    const roomPacks = (): Pack[] => {
      const lv = ctx.read('levels');
      return lv?.status === 'ready' ? (lv.packs ?? []).filter((p) => p.kind !== 'classic') : [];
    };
    const current = (): ProgressSave => ctx.read('progress')?.save ?? freshSave();
    const solvedCount = (save: ProgressSave) => Object.keys(save.results).length;

    const derive = (save: ProgressSave): ProgressState => ({
      status: 'ready',
      save,
      unlockedUpTo: unlockedFrom(save, levelCount()),
      scoring,
      packs: packProgress(save, roomPacks()),
      varietyOpen: save.results[String(rules.varietyAfter)] !== undefined,
      ...(customHints ? { customHints } : {}),
    });
    const writeSlice = (save: ProgressSave) => {
      const next = derive(save);
      ctx.write('progress', next);
      return next;
    };

    /** keep data we couldn't read under a key nothing else writes; true when it is stored durably */
    function backup(raw: unknown): boolean {
      if (!storage) return false;
      const key = storage.get(`${saveKey}.backup`) === undefined ? `${saveKey}.backup` : `${saveKey}.backup-${now()}`;
      const ok = storage.set(key, raw);
      if (ok) ctx.log.warn(`Kept the unreadable save under "${key}"`);
      else ctx.log.error(`Couldn't back up the unreadable save to "${key}"; leaving the original untouched`);
      return ok;
    }

    function fail(reason: string) {
      ctx.log.warn(`Progress not saved: ${reason}`);
      ctx.emit('progress:save_failed', { reason });
      // in memory mode the storage module already told the player; say it once otherwise
      if (warnedSaveFailed || storage?.mode() === 'memory') return;
      warnedSaveFailed = true;
      view?.notice('progress-save', copy.saveFailed, 'warn');
    }

    /** every change lands here: merge with what another tab may have saved, then slice, then storage */
    function commit(mine: ProgressSave, opts: { replace?: boolean } = {}): ProgressState {
      let save = mine;
      if (!opts.replace && storage && loaded.source !== 'newer' && !holdWrites) {
        const stored = readSave(storage.get(saveKey));
        if (stored.source === 'saved') save = mergeSaves(mine, stored.save);
      }
      const state = writeSlice(save);
      if (!storage) fail('nothing is providing storage, so progress lasts only until the page closes');
      else if (loaded.source === 'newer') { /* never overwrite a newer build's save; the notice explains */ }
      else if (holdWrites) fail("the old save couldn't be backed up, so it is left untouched");
      else if (!storage.set(saveKey, save)) fail(storage.mode() === 'memory' ? 'this browser is not saving data' : 'the browser refused to save');
      else if (warnedSaveFailed) {
        // saving works again: take the warning down, and warn again if it breaks later
        warnedSaveFailed = false;
        view?.clearNotice('progress-save');
      }
      return state;
    }

    // ---- load: back up anything unreadable before any write can touch it ----
    let raw: unknown = storage?.get(saveKey);
    let corruptText = false;
    if (raw === undefined && storage) {
      // the storage service copies text it can't parse to "<key>.corrupt" and returns undefined
      const text = storage.get(`${saveKey}.corrupt`);
      if (text !== undefined) { raw = text; corruptText = true; }
    }
    const loaded = readSave(raw);
    writeSlice(loaded.save);
    if (!storage) ctx.log.warn('No storage service: progress will last only until the page closes');
    if (loaded.source === 'recovered' || (loaded.source === 'saved' && loaded.migrated)) {
      const kept = backup(raw);
      // only a live write could overwrite the original; in memory mode nothing reaches the browser
      holdWrites = !kept && storage?.mode() === 'live';
      if (corruptText && kept) storage?.remove(`${saveKey}.corrupt`);
    }
    if (loaded.source === 'newer') {
      ctx.log.warn(`Progress was saved by a newer version (v${loaded.version}); this page won't overwrite it`);
      view?.notice('progress', copy.newerSave, 'info');
    }
    if (loaded.source === 'recovered') {
      ctx.log.warn(`The saved progress was unreadable; ${loaded.kept ? `kept ${loaded.kept} level results` : 'started fresh'}`);
      view?.notice('progress', loaded.kept ? copy.partlyRecovered : copy.recovered, 'info');
    }

    ctx.on('levels:generated', () => {
      const cur = ctx.read('progress');
      if (cur && JSON.stringify(cur) !== JSON.stringify(derive(cur.save))) writeSlice(cur.save);
    });

    ctx.on('levels:started', ({ levelId }) => {
      // lastLevel is what Continue follows: the board last played, rooms included (decision 42)
      const save = current();
      if (save.lastLevel !== levelId) commit({ ...save, lastLevel: levelId });
    });

    ctx.on('custom:started', () => {
      customHints = 0;
      writeSlice(current());
    });

    ctx.on('hints:shown', ({ levelId }) => {
      if (levelId === CUSTOM_LEVEL_ID) { customHints++; writeSlice(current()); return; }
      const save = current();
      const k = String(levelId);
      commit({ ...save, pendingHints: { ...save.pendingHints, [k]: (save.pendingHints[k] ?? 0) + 1 } });
    });

    ctx.on('board:solved', ({ levelId, moves, par }) => {
      if (levelId === CUSTOM_LEVEL_ID) {
        // a custom puzzle earns its stars on the sheet, but nothing is saved and nothing unlocks
        const stars = starsFor(moves, par, customHints, scoring);
        ctx.emit('progress:level_completed', { levelId, stars, moves, par, hintsUsed: customHints, improved: false, unlocked: null, allSolved: false, pack: 'custom', firstSolve: false });
        return;
      }
      const save = current();
      const k = String(levelId);
      const hintsUsed = save.pendingHints[k] ?? 0;
      const stars = starsFor(moves, par, hintsUsed, scoring);
      const prev = save.results[k];
      const improved = !prev || stars > prev.stars || moves < prev.bestMoves;
      const result = prev
        ? { stars: prev.stars > stars ? prev.stars : stars, bestMoves: Math.min(prev.bestMoves, moves), solvedAt: prev.solvedAt }
        : { stars, bestMoves: moves, solvedAt: now() };
      const { [k]: _spent, ...pendingHints } = save.pendingHints;
      const before = derive(save);
      const after = commit({ ...save, results: { ...save.results, [k]: result }, pendingHints });
      const count = levelCount();
      const room = roomPacks().find((p) => levelId >= p.first && levelId < p.first + p.count);
      if (room) {
        const was = before.packs?.[room.id]?.unlockedUpTo ?? 1, now = after.packs?.[room.id]?.unlockedUpTo ?? 1;
        // the newly startable level, never the one just solved (the last level of a room unlocks nothing)
        const unlocked = now > was && room.first + now - 1 > levelId ? room.first + now - 1 : null;
        ctx.emit('progress:level_completed', { levelId, stars, moves, par, hintsUsed, improved, unlocked, allSolved: false, pack: room.id, firstSolve: !prev });
        return;
      }
      const raised = after.unlockedUpTo > before.unlockedUpTo;
      const unlocked = raised && (count === undefined || levelId + 1 <= count) ? levelId + 1 : null;
      let allSolved = false;
      if (count !== undefined) {
        allSolved = true;
        for (let id = 1; id <= count; id++) if (!after.save.results[String(id)]) { allSolved = false; break; }
      }
      ctx.emit('progress:level_completed', { levelId, stars, moves, par, hintsUsed, improved, unlocked, allSolved, pack: 'classic', firstSolve: !prev });
    });

    ctx.on('progress:clear', () => {
      // the player confirmed; still keep one copy of what was there, under a key nothing else writes
      if (storage && solvedCount(current()) > 0) storage.set(`${saveKey}.before-reset`, current());
      commit(freshSave(), { replace: true });
      view?.clearNotice('progress');
      ctx.emit('progress:cleared', {});
    });

    return {
      start() {
        // persist a recovered or migrated save, then announce, once every module is listening
        if (loaded.source === 'recovered' || (loaded.source === 'saved' && loaded.migrated)) commit(current());
        const st = writeSlice(current()); // the levels slice may have arrived after our init
        ctx.emit('progress:loaded', { source: loaded.source, solved: solvedCount(st.save), unlockedUpTo: st.unlockedUpTo });
      },
      debug: () => ({ source: loaded.source, holdWrites, storage: storage?.mode() ?? 'none' }),
      commands: {
        stars() {
          const st = ctx.read('progress')!;
          const count = levelCount();
          const results = Object.entries(st.save.results).filter(([k]) => !count || Number(k) <= count).map(([, r]) => r);
          const total = results.reduce((n, r) => n + r.stars, 0);
          const pending = Object.entries(st.save.pendingHints).map(([id, n]) => `${id}×${n}`).join(', ') || 'none';
          const rooms = Object.entries(st.packs ?? {}).map(([id, p]) => `${id} ${p.solved} solved ${p.stars}★ up to ${p.unlockedUpTo}`).join(', ');
          return `${results.length}${count ? ` of ${count}` : ''} solved · ${total}★${count ? ` of ${count * 3}` : ''} · unlocked up to ${st.unlockedUpTo} · last level ${st.save.lastLevel || '—'} · pending hints: ${pending}`
            + ` · Variety ${st.varietyOpen ? `open${rooms ? `: ${rooms}` : ''}` : `opens after level ${rules.varietyAfter}`}`;
        },
        unlock(args) {
          const count = levelCount();
          const asked = args[0] === undefined ? count : Number(args[0]);
          if (asked === undefined || !Number.isInteger(asked) || asked < 1) return 'Usage: progress.unlock <highest level to mark solved>';
          const n = count ? Math.min(asked, count) : asked;
          const list = ctx.read('levels')?.list ?? [];
          const save = current();
          const results = { ...save.results };
          for (let id = 1; id <= n; id++) {
            const prev = results[String(id)];
            const par = list[id - 1]?.par ?? prev?.bestMoves ?? 1;
            results[String(id)] = { stars: 3, bestMoves: Math.min(prev?.bestMoves ?? par, par), solvedAt: prev?.solvedAt ?? now() };
          }
          const st = commit({ ...save, results });
          return `Marked levels 1–${n} solved with 3★; unlocked up to ${st.unlockedUpTo}`;
        },
        clear() {
          ctx.emit('progress:clear', {});
          return 'Progress cleared';
        },
      },
    };
  },
};
export default progress;
