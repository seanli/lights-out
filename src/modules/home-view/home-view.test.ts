// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest';
import type { LevelDef, LevelsState, Pack, ProgressState, State } from '../../contracts';
import { CLASSIC_SHAPE, SEL } from '../../contracts';
import { parseShape } from '../../lib/shape';
import { bootModule } from '../../../test/fake-ctx';
import homeView, { suggestLevel } from './index';

const COUNT = 50;
const cells = Array.from({ length: 25 }, (_, i) => i === 12);
const levels: LevelsState = {
  status: 'ready',
  list: Array.from({ length: COUNT }, (_, i) => ({ id: i + 1, cells, par: 1 + (i % 15) })),
  chapters: [
    { id: 'first-light', name: 'First light', from: 1, to: 20 },
    { id: 'crossfade', name: 'Crossfade', from: 21, to: 40 },
    { id: 'blackout', name: 'Blackout', from: 41, to: 50 },
  ],
};
const scoring = { threeStarsWithin: 0, twoStarsWithin: 3, hintCost: 1, minStars: 1 };

/** stars per solved level, in order from level 1 */
function progress(stars: number[], lastLevel = 0): ProgressState {
  const results: ProgressState['save']['results'] = {};
  stars.forEach((s, i) => { results[String(i + 1)] = { stars: s as 1 | 2 | 3, bestMoves: 3, solvedAt: 1 }; });
  return { status: 'ready', save: { version: 1, results, pendingHints: {}, lastLevel }, unlockedUpTo: Math.min(COUNT, stars.length + 1), scoring };
}

function boot(state: Partial<State> = {}) {
  return bootModule(homeView, {
    state: { levels, progress: progress([]), storage: { status: 'ok' }, sound: { enabled: true, status: 'idle' }, nav: { screen: 'home', sheet: null }, ...state },
  });
}
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const tile = (n: number) => $<HTMLButtonElement>(SEL.levelTile(n));

beforeEach(() => document.body.replaceChildren());

describe('suggestLevel', () => {
  test('fresh progress starts level 1', () => {
    expect(suggestLevel(COUNT, progress([]))).toEqual({ levelId: 1, fresh: true });
    expect(suggestLevel(COUNT, undefined)).toEqual({ levelId: 1, fresh: true });
  });
  test('mid progress continues at the lowest unlocked unsolved level', () => {
    expect(suggestLevel(COUNT, progress([3, 3, 2, 3, 1, 2]))).toEqual({ levelId: 7, fresh: false });
    // a gap (solved out of order) wins over the frontier
    const p = progress([3, 3, 3]);
    const { ['2']: _gap, ...rest } = p.save.results;
    expect(suggestLevel(COUNT, { ...p, save: { ...p.save, results: rest } }).levelId).toBe(2);
  });
  test('all solved suggests the last played level', () => {
    expect(suggestLevel(COUNT, progress(Array(COUNT).fill(3), 17))).toEqual({ levelId: 17, fresh: false });
    expect(suggestLevel(COUNT, progress(Array(COUNT).fill(3), 0)).levelId).toBe(COUNT);
  });
});

describe('home-view', () => {
  test('header shows the star total; continue starts the suggested level', () => {
    const t = boot({ progress: progress([3, 3, 2, 3, 1, 2]) });
    expect($('[data-star-total]').textContent).toBe('14/ 150');
    const cont = $<HTMLButtonElement>(SEL.action('continue'));
    expect(cont.textContent).toBe('Continue·Level 7');
    expect($('[data-home-caption]').textContent).toBe('6 of 50 solved'); // the saved note is for a first visit only
    cont.click();
    expect(t.seen('levels:start')).toEqual({ levelId: 7 });
  });

  test('fresh progress says Start · Level 1; memory storage drops the saved note', () => {
    boot();
    expect($('[data-home-caption]').textContent).toBe('0 of 50 solved · Progress is saved on this device');
    document.body.replaceChildren();
    const t = boot({ storage: { status: 'memory', reason: 'blocked' } });
    expect($(SEL.action('continue')).textContent).toBe('Start·Level 1');
    expect($('[data-home-caption]').textContent).toBe('0 of 50 solved');
    $<HTMLButtonElement>(SEL.action('continue')).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 1 });
  });

  test('all solved: continue replays the last played level', () => {
    const t = boot({ progress: progress(Array(COUNT).fill(3), 23) });
    expect($(SEL.action('continue')).textContent).toBe('Continue·Level 23');
    $<HTMLButtonElement>(SEL.action('continue')).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 23 });
  });

  test('tiles reflect stars, locked and current; only open tiles start a level', () => {
    const t = boot({ progress: progress([3, 3, 2, 3, 1, 2]) });
    expect(tile(3).dataset).toMatchObject({ stars: '2', locked: 'false', current: 'false' });
    expect(tile(3).querySelectorAll('.star[data-state="on"]').length).toBe(2);
    expect(tile(7).dataset).toMatchObject({ stars: '0', locked: 'false', current: 'true' });
    expect(tile(7).textContent).toBe('7Play');
    expect(tile(8).dataset).toMatchObject({ locked: 'true', current: 'false' });
    expect(tile(8).getAttribute('aria-label')).toBe('Level 8, locked');
    expect(tile(8).disabled).toBe(false); // focusable, so a screen reader can hear why
    tile(8).click();
    expect(t.all('levels:start')).toEqual([]);
    tile(3).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 3 });
  });

  test('tiles update in place when progress changes', () => {
    const t = boot({ progress: progress([3]) });
    const before = tile(2);
    t.kernel.seed('progress', progress([3, 1]));
    expect(tile(2)).toBe(before);
    expect(tile(2).dataset).toMatchObject({ stars: '1', current: 'false' });
    expect(tile(3).dataset).toMatchObject({ locked: 'false', current: 'true' });
  });

  test('a chapter whose first level is locked shows a quiet row instead of its grid', () => {
    const t = boot({ progress: progress([3, 3]) });
    const locked = $('.chapter[data-locked="true"][data-chapter="crossfade"]');
    expect(locked.hidden).toBe(false);
    expect(locked.textContent).toContain('Chapter 2 · Crossfade');
    expect(locked.textContent).toContain('Unlocks at level 21');
    expect(tile(21).closest('section')!.hidden).toBe(true);
    expect($('.home__chapter[data-chapter="first-light"]').hidden).toBe(false);
    t.kernel.seed('progress', progress(Array(20).fill(3)));
    expect(locked.hidden).toBe(true);
    expect(tile(21).closest('section')!.hidden).toBe(false);
  });

  test('sound toggle reflects the sound slice and emits sound:set; hidden without sound', () => {
    const t = boot({ sound: { enabled: true, status: 'idle' } });
    const btn = $<HTMLButtonElement>(SEL.action('sound'));
    expect(btn.hidden).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    btn.click();
    expect(t.seen('sound:set')).toEqual({ enabled: false });
    expect(btn.closest('.home__top')).not.toBeNull(); // a quiet icon by the star total
    expect(btn.getAttribute('aria-label')).toBe('Sound');
    t.kernel.seed('sound', { enabled: false, status: 'idle' });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('title')).toBe('Sound off');

    document.body.replaceChildren();
    boot({ sound: undefined });
    expect($(SEL.action('sound')).hidden).toBe(true);
  });

  test('learn: the footer button, plus a first-visit link until level 3 is solved', () => {
    const learn = { status: 'ready' as const, lessonId: null, step: 0, completed: [], practice: null, assist: false };
    const t = boot({ learn });
    const [link, btn] = document.querySelectorAll<HTMLButtonElement>(SEL.action('learn'));
    expect(link!.hidden).toBe(false);
    expect(link!.textContent).toBe('New here? Learn the patterns');
    expect(btn!.hidden).toBe(false);
    expect(btn!.textContent).toBe('Learn the patterns');
    btn!.click();
    link!.click();
    expect(t.all('learn:open')).toEqual([{}, {}]);
    t.kernel.seed('progress', progress([3, 3, 2]));
    expect(link!.hidden).toBe(true);
    expect(btn!.hidden).toBe(false);
  });

  test('reset opens the confirmation sheet with focus on cancel; only confirm clears progress', async () => {
    const t = boot({ progress: progress([3]) });
    $<HTMLButtonElement>(SEL.action('reset')).click();
    expect(t.seen('nav:open_sheet')).toEqual({ sheet: 'confirm_reset' });
    const sheet = $(SEL.sheet('confirm_reset'));
    expect(sheet.textContent).toContain('Reset all progress?');
    t.kernel.seed('nav', { screen: 'home', sheet: 'confirm_reset' });
    await new Promise((r) => requestAnimationFrame(r));
    expect(document.activeElement?.getAttribute('data-action')).toBe('reset-cancel');
    sheet.querySelector<HTMLButtonElement>('[data-action="reset-cancel"]')!.click();
    expect(t.all('nav:close_sheet').length).toBe(1);
    expect(t.all('progress:clear')).toEqual([]);
    sheet.querySelector<HTMLButtonElement>('[data-action="reset-confirm"]')!.click();
    expect(t.all('progress:clear')).toEqual([{}]);
    expect(t.all('nav:close_sheet').length).toBe(2);
  });

  test('the star legend follows the scoring rule', () => {
    boot({ progress: progress([3]) });
    expect($('[data-star-legend]').textContent).toBe('par·par +3·solved·hint −1★');
    expect($('[data-star-legend]').closest('[data-chapter="first-light"]')).not.toBeNull(); // one line under chapter 1
  });

  test('without progress every level is open and nothing breaks', () => {
    const t = boot({ progress: undefined });
    expect(tile(50).dataset.locked).toBe('false');
    expect($('[data-star-total]').hidden).toBe(true);
    expect($(SEL.action('reset')).hidden).toBe(true);
    tile(50).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 50 });
  });

  test('levels error shows a plain message and no continue', () => {
    boot({ levels: { status: 'error', list: [], chapters: [], error: 'boom' } });
    expect($('.home__error').hidden).toBe(false);
    expect($(SEL.action('continue')).hidden).toBe(true);
    expect(document.querySelectorAll('[data-level-tile]').length).toBe(0);
  });

  test('counts and Continue are about the classic path even when the list holds the rooms', () => {
    const t = boot({ levels: withRooms, progress: { ...progress([3, 3]), varietyOpen: false } });
    // a room level solved must not count towards the classic path
    t.kernel.seed('progress', { ...progress([3, 3]), save: { ...progress([3, 3]).save, results: { ...progress([3, 3]).save.results, '1001': { stars: 3, bestMoves: 1, solvedAt: 1 } } } });
    expect($('[data-star-total]').textContent).toBe('6/ 150');
    expect($('[data-home-caption]').textContent).toBe('2 of 50 solved');
    expect($(SEL.action('continue')).textContent).toBe('Continue·Level 3');
    expect(document.querySelectorAll('[data-level-tile]').length).toBe(50);
  });

  test('Variety entry: a quiet locked row until it opens, then a card with the room shapes', () => {
    const t = boot({ levels: withRooms, progress: { ...progress([3]), varietyOpen: false }, variety: { room: null } });
    const entry = $<HTMLButtonElement>(SEL.action('variety'));
    expect(entry.hidden).toBe(false);
    expect(entry.getAttribute('aria-disabled')).toBe('true');
    expect(entry.textContent).toBe('Variety opens after chapter 1');
    entry.click();
    expect(t.all('variety:open')).toEqual([]);

    t.kernel.seed('progress', { ...progress(Array(20).fill(3)), varietyOpen: true, packs: { '4x4': { unlockedUpTo: 3, solved: 2, stars: 6 }, ring: { unlockedUpTo: 1, solved: 0, stars: 0 } } });
    expect(entry.hasAttribute('aria-disabled')).toBe(false);
    expect(entry.textContent).toBe('VarietySame rule, new rooms');
    const glyphs = entry.querySelectorAll('.room-glyph');
    expect(glyphs.length).toBe(2);
    expect(glyphs[1]!.querySelectorAll('i[data-gap]').length).toBe(9); // the ring's hole
    expect(glyphs[0]!.querySelectorAll('i[data-lit="true"]').length).toBe(3); // 2 of 12 solved → 3 of 16 dots
    entry.click();
    expect(t.seen('variety:open')).toEqual({});
  });

  test('Variety entry hides without the variety module or without rooms', () => {
    boot({ levels: withRooms });
    expect($(SEL.action('variety')).hidden).toBe(true);
    document.body.replaceChildren();
    boot({ variety: { room: null } });
    expect($(SEL.action('variety')).hidden).toBe(true);
  });

  test('the tile a solve unlocked powers on once when home shows', () => {
    const t = boot({ progress: progress([3]), nav: { screen: 'play', sheet: 'solved' } });
    t.emit('progress:level_completed', { levelId: 2, stars: 3, moves: 2, par: 2, hintsUsed: 0, improved: true, unlocked: 3, allSolved: false, pack: 'classic', firstSolve: true });
    t.kernel.seed('progress', progress([3, 3]));
    expect(tile(3).hasAttribute('data-power-on')).toBe(false);
    t.kernel.seed('nav', { screen: 'home', sheet: null });
    expect(tile(3).hasAttribute('data-power-on')).toBe(true);
    // a room unlock does nothing on the classic path
    t.emit('progress:level_completed', { levelId: 1001, stars: 3, moves: 1, par: 1, hintsUsed: 0, improved: true, unlocked: 1002, allSolved: false, pack: '4x4', firstSolve: true });
    tile(3).removeAttribute('data-power-on');
    t.kernel.seed('nav', { screen: 'play', sheet: null });
    t.kernel.seed('nav', { screen: 'home', sheet: null });
    expect(document.querySelectorAll('[data-power-on]').length).toBe(0);
  });
});

const small: Pack = { id: '4x4', name: 'Small room', kind: 'size', shape: { cols: 4, rows: 4, mask: null }, first: 1001, count: 12 };
const ring: Pack = {
  id: 'ring', name: 'Ring', kind: 'shape', first: 5001, count: 12,
  shape: parseShape(['XXXXXXX', 'XXXXXXX', 'XX...XX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXXXXX']),
};
const roomLevels = (p: Pack): LevelDef[] => Array.from({ length: p.count }, (_, i) => ({
  id: p.first + i, cells: Array(p.shape.cols * p.shape.rows).fill(false), par: i + 1, pack: p.id, index: i + 1, shape: p.shape,
}));
const withRooms: LevelsState = {
  ...levels,
  list: [...levels.list, ...roomLevels(small), ...roomLevels(ring)],
  packs: [{ id: 'classic', name: 'Classic', kind: 'classic', shape: CLASSIC_SHAPE, first: 1, count: COUNT }, small, ring],
};
