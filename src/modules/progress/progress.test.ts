import { describe, expect, test } from 'vitest';
import { CLASSIC_SHAPE, type LevelsState, type Pack, type ProgressSave, type StorageService, type Tone, type ViewService } from '../../contracts';
import { bootModule, createMemoryStorage } from '../../../test/fake-ctx';
import progress from './index';
import { migrate, readSave, starsFor } from './save';

const SCORING = { threeStarsWithin: 0, twoStarsWithin: 3, hintCost: 1, minStars: 1 };
const RECOVERED = "Your saved progress couldn't be read, so the game started fresh.";
const SAVE_FAILED = "Your latest progress couldn't be saved.";

function levelsSlice(count: number): LevelsState {
  const cells = Array.from({ length: 25 }, (_, i) => i === 12);
  return { status: 'ready', list: Array.from({ length: count }, (_, i) => ({ id: i + 1, cells, par: 3 })), chapters: [] };
}

/** the classic 50 plus two Variety rooms: 4x4 (ids 1001–1012) and ring (ids 5001–5004) */
function levelsWithRooms(): LevelsState {
  const base = levelsSlice(50);
  const four = { cols: 4, rows: 4, mask: null };
  const packs: Pack[] = [
    { id: 'classic', name: 'Classic', kind: 'classic', shape: CLASSIC_SHAPE, first: 1, count: 50 },
    { id: '4x4', name: 'Small room', kind: 'size', shape: four, first: 1001, count: 12 },
    { id: 'ring', name: 'Ring', kind: 'shape', shape: four, first: 5001, count: 4 },
  ];
  const cells = Array.from({ length: 16 }, (_, i) => i === 5);
  const rooms = packs.slice(1).flatMap((p) => Array.from({ length: p.count }, (_, i) => ({ id: p.first + i, cells, par: 3, pack: p.id, index: i + 1, shape: four })));
  return { ...base, list: [...base.list, ...rooms], packs };
}

function stubView() {
  const notices = new Map<string, { text: string; tone?: Tone }>();
  const view: ViewService = {
    region: () => { throw new Error('progress renders nothing'); },
    notice: (id, text, tone) => { notices.set(id, { text, tone }); },
    clearNotice: (id) => { notices.delete(id); },
    reducedMotion: () => true,
  };
  return { view, notices };
}

function boot(opts: { storage?: StorageService; levels?: number | null | LevelsState } = {}) {
  const storage = opts.storage ?? createMemoryStorage();
  const { view, notices } = stubView();
  const levels = opts.levels === null ? undefined : typeof opts.levels === 'object' ? opts.levels : levelsSlice(opts.levels ?? 50);
  const t = bootModule(progress, { services: { storage, view }, state: levels ? { levels } : {} });
  const solve = (levelId: number, moves: number, par = 3) => {
    t.emit('board:solved', { levelId, moves, par });
    return t.seen('progress:level_completed', { levelId })!;
  };
  return { t, storage, notices, solve };
}

describe('star rule', () => {
  test.each([
    // moves, par, hints, stars
    [5, 5, 0, 3], // at par
    [8, 5, 0, 2], // par + 3
    [9, 5, 0, 1], // par + 4
    [4, 5, 0, 3], // under par still 3
    [5, 5, 1, 2],
    [5, 5, 2, 1],
    [5, 5, 3, 1], // never below 1
    [8, 5, 1, 1],
    [30, 5, 3, 1],
  ])('%i moves at par %i with %i hints → %i★', (moves, par, hints, stars) => {
    expect(starsFor(moves, par, hints, SCORING)).toBe(stars);
  });
});

describe('progress', () => {
  test('a fresh start: new save, level 1 unlocked, scoring in the slice', () => {
    const { t } = boot();
    expect(t.state('progress')).toMatchObject({ status: 'ready', unlockedUpTo: 1, scoring: SCORING });
    expect(t.state('progress').save).toEqual({ version: 1, results: {}, pendingHints: {}, lastLevel: 0 });
    expect(t.seen('progress:loaded')).toEqual({ source: 'new', solved: 0, unlockedUpTo: 1 });
  });

  test('solving the frontier unlocks the next level once; replays never unlock again', () => {
    const { t, solve } = boot();
    expect(solve(1, 3)).toEqual({ levelId: 1, stars: 3, moves: 3, par: 3, hintsUsed: 0, improved: true, unlocked: 2, allSolved: false, pack: 'classic', firstSolve: true });
    expect(t.state('progress').unlockedUpTo).toBe(2);
    const again = solve(1, 3);
    expect(again.unlocked).toBeNull();
    expect(again.firstSolve).toBe(false);
    expect(solve(2, 5)).toMatchObject({ stars: 2, unlocked: 3 });
    expect(solve(1, 3).unlocked).toBeNull();
    expect(t.state('progress').unlockedUpTo).toBe(3);
  });

  test('a worse replay keeps the best stars and fewest moves; a better one improves', () => {
    const { t, solve } = boot();
    solve(1, 5); // 2★ in 5
    expect(solve(1, 9)).toMatchObject({ stars: 1, improved: false });
    expect(t.state('progress').save.results['1']).toMatchObject({ stars: 2, bestMoves: 5 });
    expect(solve(1, 4)).toMatchObject({ stars: 2, improved: true }); // fewer moves, same stars
    expect(solve(1, 3)).toMatchObject({ stars: 3, improved: true });
    expect(t.state('progress').save.results['1']).toMatchObject({ stars: 3, bestMoves: 3 });
  });

  test('hints are charged on solve, survive a reboot, then are cleared', () => {
    const storage = createMemoryStorage();
    const a = boot({ storage });
    a.t.emit('levels:started', { levelId: 1, par: 3, count: 50 });
    a.t.emit('hints:shown', { levelId: 1, index: 12 });
    a.t.emit('hints:shown', { levelId: 1, index: 7 });
    expect(a.t.state('progress').save.pendingHints).toEqual({ '1': 2 });

    const b = boot({ storage }); // reload
    expect(b.t.state('progress').save.pendingHints).toEqual({ '1': 2 });
    expect(b.t.state('progress').save.lastLevel).toBe(1);
    expect(b.solve(1, 3)).toMatchObject({ stars: 1, hintsUsed: 2 });
    expect(b.t.state('progress').save.pendingHints).toEqual({});
    expect(b.solve(1, 3)).toMatchObject({ stars: 3, hintsUsed: 0, improved: true });
  });

  test('persistence round-trip: boot → solve → boot again gives the same progress', () => {
    const storage = createMemoryStorage();
    const a = boot({ storage });
    a.solve(1, 3);
    a.solve(2, 6);
    a.t.emit('levels:started', { levelId: 3, par: 3, count: 50 });
    const saved = a.t.state('progress');

    const b = boot({ storage });
    expect(b.t.state('progress')).toEqual(saved);
    expect(b.t.seen('progress:loaded')).toEqual({ source: 'saved', solved: 2, unlockedUpTo: 3 });
    expect(storage.dump().progress).toEqual(saved.save);
  });

  test('a corrupt save: recovered, the bad value kept under a backup key, an info notice', () => {
    const bad = { version: 1, results: 'oops', lastLevel: 'x' };
    const storage = createMemoryStorage({ progress: bad });
    const { t, notices } = boot({ storage });
    expect(t.seen('progress:loaded')).toEqual({ source: 'recovered', solved: 0, unlockedUpTo: 1 });
    expect(storage.dump()['progress.backup']).toEqual(bad);
    expect(storage.dump().progress).toEqual({ version: 1, results: {}, pendingHints: {}, lastLevel: 0 });
    expect(notices.get('progress')).toEqual({ text: RECOVERED, tone: 'info' });

    // a second bad save never overwrites the first backup
    const again = createMemoryStorage({ progress: 'junk', 'progress.backup': bad });
    boot({ storage: again });
    expect(again.dump()['progress.backup']).toEqual(bad);
    expect(Object.entries(again.dump()).some(([k, v]) => k.startsWith('progress.backup-') && v === 'junk')).toBe(true);
  });

  test('unparseable text (handed over as "<key>.corrupt" by storage) is backed up and recovered', () => {
    // the storage service returns undefined for text it can't parse and copies the raw text beside it
    const storage = createMemoryStorage({ 'progress.corrupt': '{"version":1,"res' });
    const { t } = boot({ storage });
    expect(t.seen('progress:loaded')).toMatchObject({ source: 'recovered' });
    expect(storage.dump()['progress.backup']).toBe('{"version":1,"res');
    expect(storage.dump()['progress.corrupt']).toBeUndefined();
    expect(storage.dump().progress).toMatchObject({ version: 1 });
  });

  test('a corrupt save that cannot be backed up is never overwritten', () => {
    const inner = createMemoryStorage({ progress: 'junk' });
    const storage: StorageService = { ...inner, set: (k, val) => (k === 'progress' ? inner.set(k, val) : false), mode: () => 'live' };
    const { t, solve } = boot({ storage });
    solve(1, 3);
    expect(inner.dump().progress).toBe('junk');
    expect(t.seen('progress:save_failed')!.reason).toMatch(/left untouched/);
    expect(t.state('progress').unlockedUpTo).toBe(2); // still playable this visit
  });

  test('a partly damaged save keeps the level results that still read correctly', () => {
    const good = { stars: 3, bestMoves: 3, solvedAt: 1 };
    const storage = createMemoryStorage({ progress: { version: 1, results: { '1': good, '2': { stars: 9 } }, pendingHints: {}, lastLevel: 2 } });
    const { t, notices } = boot({ storage });
    expect(t.state('progress').save.results).toEqual({ '1': good });
    expect(t.state('progress').unlockedUpTo).toBe(2);
    expect(notices.get('progress')!.text).toMatch(/Part of your saved progress/);
  });

  test('migrations are wired: an old version is upgraded, not discarded', () => {
    const v0 = { version: 0, solved: [1, 2] };
    const steps = {
      0: (old: Record<string, unknown>) => ({
        version: 1, pendingHints: {}, lastLevel: 0,
        results: Object.fromEntries((old.solved as number[]).map((id) => [String(id), { stars: 1, bestMoves: 99, solvedAt: 0 }])),
      }),
    };
    expect(migrate(v0, steps)?.results['2']).toEqual({ stars: 1, bestMoves: 99, solvedAt: 0 });
    expect(readSave(v0, steps)).toMatchObject({ source: 'saved', migrated: true });
    expect(readSave(v0)).toMatchObject({ source: 'recovered' }); // no step registered yet
  });

  test('a failed save emits save_failed and warns once; progress still counts in memory', () => {
    let ok = true;
    const inner = createMemoryStorage();
    const storage: StorageService = { ...inner, set: (k, val) => (ok ? inner.set(k, val) : false), mode: () => 'live' };
    const { t, notices, solve } = boot({ storage });
    ok = false;
    solve(1, 3);
    expect(t.seen('progress:save_failed')).toEqual({ reason: 'the browser refused to save' });
    expect(notices.get('progress-save')).toEqual({ text: SAVE_FAILED, tone: 'warn' });
    notices.delete('progress-save');
    solve(2, 3);
    expect(t.all('progress:save_failed')).toHaveLength(2);
    expect(notices.has('progress-save')).toBe(false); // only once
    expect(t.state('progress').unlockedUpTo).toBe(3);
    ok = true;
    solve(3, 3);
    expect((inner.dump().progress as ProgressSave).results['3']).toBeDefined();
  });

  test('without a storage service it still works in memory', () => {
    const t = bootModule(progress, { bare: true, state: { levels: levelsSlice(3) } });
    t.emit('board:solved', { levelId: 1, moves: 3, par: 3 });
    expect(t.state('progress').unlockedUpTo).toBe(2);
    expect(t.seen('progress:save_failed')).toBeDefined();
  });

  test('unlock is capped by the level count; allSolved when every level has a result', () => {
    const { t, solve } = boot({ levels: 3 });
    solve(1, 3);
    solve(2, 3);
    expect(solve(3, 3)).toMatchObject({ unlocked: null, allSolved: true });
    expect(t.state('progress').unlockedUpTo).toBe(3);
  });

  test('without a levels slice: no cap and allSolved stays false', () => {
    const { solve } = boot({ levels: null });
    expect(solve(1, 3)).toMatchObject({ unlocked: 2, allSolved: false });
  });

  test('clear wipes progress and persists it; console commands work', () => {
    const storage = createMemoryStorage();
    const { t } = boot({ storage });
    const cmd = t.instance!.commands!;
    expect(cmd.unlock!(['5'])).toMatch(/1–5/);
    expect(t.state('progress').unlockedUpTo).toBe(6);
    expect(cmd.stars!([])).toMatch(/^5 of 50 solved · 15★ of 150/);
    cmd.clear!([]);
    expect(t.seen('progress:cleared')).toEqual({});
    expect(t.state('progress').unlockedUpTo).toBe(1);
    expect(storage.dump().progress).toEqual({ version: 1, results: {}, pendingHints: {}, lastLevel: 0 });
  });
});

describe('a save from a newer version', () => {
  test('is shown where readable, explained, and never overwritten', () => {
    const newer = { version: 2, results: { '1': { stars: 3, bestMoves: 1, solvedAt: 5 } }, pendingHints: {}, lastLevel: 1, extra: 'v2-only' };
    const storage = createMemoryStorage({ progress: newer });
    const { t, notices, solve } = boot({ storage });
    expect(t.seen('progress:loaded')).toMatchObject({ source: 'newer', solved: 1 });
    expect(notices.get('progress')?.text).toMatch(/newer version/);
    solve(2, 3);
    t.emit('levels:started', { levelId: 3, par: 3, count: 50 });
    expect(storage.get('progress')).toEqual(newer);
    expect(t.state('progress').save.results['2']).toBeTruthy();
  });
});

describe('two tabs', () => {
  test("a second tab's progress is merged, never overwritten, and stars never go down", () => {
    const storage = createMemoryStorage();
    const a = boot({ storage });
    const b = boot({ storage });
    a.solve(4, 3); // tab A: 3 stars on level 4
    b.solve(4, 9); // tab B (loaded before A's solve): 1 star on level 4
    b.solve(1, 3);
    const saved = storage.get('progress') as { results: Record<string, { stars: number; bestMoves: number }> };
    expect(saved.results['4']).toMatchObject({ stars: 3, bestMoves: 3 });
    expect(saved.results['1']).toBeTruthy();
    expect(b.t.state('progress').save.results['4']!.stars).toBe(3);
  });

  test('reset replaces the save (no merge) and keeps one copy of the old one', () => {
    const storage = createMemoryStorage();
    const { t, solve } = boot({ storage });
    solve(1, 3);
    t.emit('progress:clear', {});
    expect((storage.get('progress') as { results: object }).results).toEqual({});
    expect((storage.get('progress.before-reset') as { results: object }).results).toHaveProperty('1');
  });
});

describe('Variety rooms', () => {
  const rooms = () => boot({ levels: levelsWithRooms() });

  test('room results never move the classic path, its count or allSolved', () => {
    const { t, solve } = rooms();
    expect(solve(1001, 3)).toMatchObject({ levelId: 1001, pack: '4x4', unlocked: 1002, allSolved: false, firstSolve: true });
    expect(solve(5004, 3)).toMatchObject({ pack: 'ring', unlocked: null });
    expect(t.state('progress').unlockedUpTo).toBe(1); // not 5005
    expect(solve(1, 3)).toMatchObject({ pack: 'classic', unlocked: 2 });
    expect(t.state('progress').unlockedUpTo).toBe(2);
    t.instance!.commands!.unlock!(['49']);
    expect(solve(50, 3)).toMatchObject({ allSolved: true, firstSolve: true, unlocked: null });
    expect(t.state('progress').unlockedUpTo).toBe(50);
    expect(t.instance!.commands!.stars!([])).toMatch(/^50 of 50 solved · 150★ of 150/);
  });

  test('per room: unlockedUpTo is the highest solved index + 1 (capped), with solved and stars', () => {
    const { t, solve } = rooms();
    expect(t.state('progress').packs).toEqual({ '4x4': { unlockedUpTo: 1, solved: 0, stars: 0 }, ring: { unlockedUpTo: 1, solved: 0, stars: 0 } });
    solve(1001, 3);
    solve(1002, 9);
    expect(t.state('progress').packs!['4x4']).toEqual({ unlockedUpTo: 3, solved: 2, stars: 4 });
    for (const id of [5001, 5002, 5003, 5004]) solve(id, 3);
    expect(t.state('progress').packs!.ring).toEqual({ unlockedUpTo: 4, solved: 4, stars: 12 });
  });

  test('Variety opens when classic level varietyAfter (20) is solved', () => {
    const { t, solve } = rooms();
    expect(t.state('progress').varietyOpen).toBe(false);
    t.instance!.commands!.unlock!(['19']);
    expect(t.state('progress').varietyOpen).toBe(false);
    solve(20, 3);
    expect(t.state('progress').varietyOpen).toBe(true);
  });

  test('the last level follows any board, so Continue can return to a room', () => {
    const { t } = rooms();
    t.emit('levels:started', { levelId: 7, par: 3, count: 50, pack: 'classic', index: 7, next: 8 });
    expect(t.state('progress').save.lastLevel).toBe(7);
    t.emit('levels:started', { levelId: 1003, par: 3, count: 12, pack: '4x4', index: 3, next: 1004 });
    expect(t.state('progress').save.lastLevel).toBe(1003);
  });

  test('an existing v1 save loads unchanged and gains room results in the same shape', () => {
    const v1: ProgressSave = {
      version: 1,
      results: { '1': { stars: 3, bestMoves: 1, solvedAt: 10 }, '2': { stars: 2, bestMoves: 5, solvedAt: 20 }, '20': { stars: 1, bestMoves: 12, solvedAt: 30 } },
      pendingHints: { '3': 1 },
      lastLevel: 3,
    };
    const storage = createMemoryStorage({ progress: v1 });
    const { t, solve } = boot({ storage, levels: levelsWithRooms() });
    expect(t.seen('progress:loaded')).toEqual({ source: 'saved', solved: 3, unlockedUpTo: 21 });
    expect(t.state('progress').save).toEqual(v1);
    expect(t.state('progress').varietyOpen).toBe(true);
    expect(storage.get('progress.backup')).toBeUndefined(); // nothing was migrated or recovered
    solve(1001, 3);
    const saved = storage.get('progress') as ProgressSave;
    expect(saved).toEqual({ ...v1, results: { ...v1.results, '1001': { stars: 3, bestMoves: 3, solvedAt: expect.any(Number) } } });
    // and an older build (no rooms) reading this save still sees the classic path where it was
    const old = boot({ storage });
    expect(old.t.state('progress').unlockedUpTo).toBe(21);
  });
});
