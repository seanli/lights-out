// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest';
import type { LevelDef, LevelsState, Pack, ProgressState, State } from '../../contracts';
import { CLASSIC_SHAPE, SEL } from '../../contracts';
import { parseShape } from '../../lib/shape';
import { bootModule } from '../../../test/fake-ctx';
import variety from './index';

const small: Pack = { id: '4x4', name: 'Small room', kind: 'size', shape: { cols: 4, rows: 4, mask: null }, first: 1001, count: 12 };
const ring: Pack = {
  id: 'ring', name: 'Ring', kind: 'shape', first: 5001, count: 12,
  shape: parseShape(['XXXXXXX', 'XXXXXXX', 'XX...XX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXXXXX']),
};
const classic: Pack = { id: 'classic', name: 'Classic', kind: 'classic', shape: CLASSIC_SHAPE, first: 1, count: 50 };
const levelsOf = (p: Pack): LevelDef[] => Array.from({ length: p.count }, (_, i) => ({
  id: p.first + i, cells: Array(p.shape.cols * p.shape.rows).fill(false), par: i + 1, pack: p.id, index: i + 1, shape: p.shape,
}));
const levels: LevelsState = {
  status: 'ready',
  list: [...Array.from({ length: 50 }, (_, i) => ({ id: i + 1, cells: Array(25).fill(false), par: 3 })), ...levelsOf(small), ...levelsOf(ring)],
  chapters: [
    { id: 'first-light', name: 'First light', from: 1, to: 20 },
    { id: 'crossfade', name: 'Crossfade', from: 21, to: 40 },
    { id: 'blackout', name: 'Blackout', from: 41, to: 50 },
  ],
  packs: [classic, small, ring],
};
const scoring = { threeStarsWithin: 0, twoStarsWithin: 3, hintCost: 1, minStars: 1 };
const learnSlice = { status: 'ready' as const, lessonId: null, step: 0, completed: [], practice: null, assist: false };

/** classic stars from level 1 (20+ solved opens the rooms), and the small room's stars from its first level */
function progress(classicStars: number[], smallStars: number[] = [], lastLevel = 0): ProgressState {
  const results: ProgressState['save']['results'] = {};
  classicStars.forEach((s, i) => { results[String(1 + i)] = { stars: s as 1 | 2 | 3, bestMoves: 3, solvedAt: 1 }; });
  smallStars.forEach((s, i) => { results[String(1001 + i)] = { stars: s as 1 | 2 | 3, bestMoves: 3, solvedAt: 1 }; });
  return {
    status: 'ready', save: { version: 1, results, pendingHints: {}, lastLevel }, unlockedUpTo: Math.min(50, classicStars.length + 1),
    varietyOpen: classicStars.length >= 20, scoring,
    packs: {
      '4x4': { unlockedUpTo: Math.min(12, smallStars.length + 1), solved: smallStars.length, stars: smallStars.reduce((a, b) => a + b, 0) },
      ring: { unlockedUpTo: 1, solved: 0, stars: 0 },
    },
  };
}
const open = progress(Array(20).fill(3));

function boot(state: Partial<State> = {}) {
  return bootModule(variety, { state: { levels, progress: open, nav: { screen: 'home', sheet: null, previous: null }, ...state } });
}
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];
const tile = (id: number) => $<HTMLButtonElement>(SEL.levelTile(id));

beforeEach(() => document.body.replaceChildren());

describe('variety: one board screen for every board', () => {
  test('variety:open {room} accepts any pack, classic included, and goes to the board screen', () => {
    const t = boot();
    t.emit('variety:open', { room: 'classic' });
    expect(t.state('variety')).toEqual({ room: 'classic' });
    expect(t.seen('variety:opened')).toEqual({ room: 'classic' });
    expect(t.seen('nav:go')).toEqual({ screen: 'variety' });
    expect($('[data-room-view]').dataset.roomView).toBe('classic');
    t.emit('variety:open', { room: 'ring' });
    expect($('[data-room-view]').dataset.roomView).toBe('ring');
  });

  test('refusals: unknown id; a locked room; classic is never locked; no progress slice means open', () => {
    const t = boot();
    t.emit('variety:open', { room: 'nope' });
    expect(t.seen('variety:refused')).toEqual({ reason: 'unknown_room' });
    expect(t.all('nav:go')).toEqual([]);

    document.body.replaceChildren();
    const u = boot({ progress: progress([3, 3]) });
    u.emit('variety:open', { room: '4x4' });
    expect(u.seen('variety:refused')).toEqual({ reason: 'locked' });
    expect(u.all('nav:go')).toEqual([]);
    u.emit('variety:open', { room: 'classic' });
    expect(u.seen('nav:go')).toEqual({ screen: 'variety' });
    expect(u.all('variety:refused').length).toBe(1);

    document.body.replaceChildren();
    const w = boot({ progress: undefined });
    w.emit('variety:open', { room: 'ring' });
    expect(w.state('variety')).toEqual({ room: 'ring' });
    expect(w.seen('nav:go')).toEqual({ screen: 'variety' });
  });

  test('header: back, the board name and its meta line; the summary counts solved and stars', () => {
    const t = boot({ progress: progress([3, 3, 2, 3, 1, 2]) });
    t.emit('variety:open', { room: 'classic' });
    expect($('.screen-header__title strong').textContent).toBe('Classic');
    expect($('.screen-header__title .eyebrow').textContent).toBe('5×5 · 50 levels');
    expect($('[data-board-summary]').textContent).toBe('6 of 50 solved · 14 of 150 stars');
    expect($('.variety__top .room-glyph')).not.toBeNull();
    t.kernel.seed('progress', open);
    t.emit('variety:open', { room: 'ring' });
    expect($('.screen-header__title .eyebrow').textContent).toBe('12 levels'); // a shaped room has no size
    t.emit('variety:open', { room: '4x4' });
    expect($('.screen-header__title .eyebrow').textContent).toBe('4×4 · 12 levels');
  });

  test('classic: chapters with eyebrows and ranges, chapters ahead as one quiet row, the legend under the first grid', () => {
    const t = boot({ progress: progress([3, 3]) });
    t.emit('variety:open', { room: 'classic' });
    expect($$('[data-level-tile]').length).toBe(50);
    const first = $('.variety__chapter[data-chapter="first-light"]');
    expect(first.textContent).toContain('Chapter 1 · First light');
    expect(first.textContent).toContain('Levels 1–20');
    expect($('[data-star-legend]').closest('[data-chapter="first-light"]')).not.toBeNull();
    expect($('[data-star-legend]').textContent).toBe('par·par +3·solved·hint −1★');
    const ahead = $('.chapter[data-locked="true"][data-chapter="crossfade"]');
    expect(ahead.hidden).toBe(false);
    expect(ahead.textContent).toBe('Chapter 2 · CrossfadeUnlocks at level 21');
    expect(tile(21).closest('section')!.hidden).toBe(true);
    t.kernel.seed('progress', progress(Array(20).fill(3)));
    expect(ahead.hidden).toBe(true);
    expect(tile(21).closest('section')!.hidden).toBe(false);
  });

  test('classic tiles: stars, locked, current from progress.unlockedUpTo; only open tiles start a level', () => {
    const t = boot({ progress: progress([3, 3, 2, 3, 1, 2]) });
    t.emit('variety:open', { room: 'classic' });
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

  test('a room: one grid with global ids numbered by index; unlock from progress.packs', () => {
    const t = boot({ progress: progress(Array(20).fill(3), [3, 2]) });
    t.emit('variety:open', { room: '4x4' });
    expect($$('[data-chapter]').length).toBe(1);
    expect($$('.level-grid').length).toBe(1);
    const tiles = $$('[data-level-tile]');
    expect(tiles.map((el) => Number(el.dataset.level))).toEqual(Array.from({ length: 12 }, (_, i) => 1001 + i));
    expect(tiles.map((el) => el.firstChild!.textContent)).toEqual(Array.from({ length: 12 }, (_, i) => String(i + 1)));
    expect(tile(1001).dataset).toMatchObject({ stars: '3', locked: 'false', current: 'false' });
    expect(tile(1003).dataset).toMatchObject({ stars: '0', locked: 'false', current: 'true' });
    expect(tile(1004).dataset).toMatchObject({ locked: 'true', current: 'false' });
    expect(tile(1004).getAttribute('aria-label')).toBe('Level 4, locked');
    tile(1004).click();
    expect(t.all('levels:start')).toEqual([]);
    tile(1003).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 1003 });
  });

  test('every level solved: the last played level stays lit; a finished room has none lit', () => {
    const t = boot({ progress: progress(Array(50).fill(3), Array(12).fill(3), 17) });
    t.emit('variety:open', { room: 'classic' });
    expect($$('[data-current="true"]').map((el) => el.dataset.level)).toEqual(['17']);
    t.emit('variety:open', { room: '4x4' });
    expect($$('[data-current="true"]')).toEqual([]);
  });

  test('tiles repaint in place when progress changes', () => {
    const t = boot({ progress: progress(Array(20).fill(3), [3]) });
    t.emit('variety:open', { room: '4x4' });
    const before = tile(1002);
    t.kernel.seed('progress', progress(Array(20).fill(3), [3, 1]));
    expect(tile(1002)).toBe(before);
    expect(before.dataset).toMatchObject({ stars: '1', current: 'false' });
    expect(tile(1003).dataset).toMatchObject({ locked: 'false', current: 'true' });
    expect($('[data-board-summary]').textContent).toBe('2 of 12 solved · 4 of 36 stars');
  });

  test('the guide link: a room opens its guide, classic opens Learn; hidden without learn', () => {
    const t = boot({ learn: learnSlice });
    t.emit('variety:open', { room: 'ring' });
    const guide = $<HTMLButtonElement>(SEL.action('guide'));
    expect(guide.hidden).toBe(false);
    expect(guide.textContent).toBe('How to clear the Ring');
    guide.click();
    expect(t.seen('learn:open')).toEqual({ lessonId: 'guide-ring' });
    t.emit('variety:open', { room: 'classic' });
    expect($(SEL.action('guide')).textContent).toBe('Learn the patterns');
    $<HTMLButtonElement>(SEL.action('guide')).click();
    expect(t.seen('learn:open')).toEqual({});

    document.body.replaceChildren();
    const u = boot();
    u.emit('variety:open', { room: 'ring' });
    expect($(SEL.action('guide')).hidden).toBe(true);
  });

  test('back: nav:back to the menu, or nav:go home when we came from a level', () => {
    const t = boot();
    t.emit('variety:open', { room: 'ring' });
    $<HTMLButtonElement>(SEL.action('variety-back')).click();
    expect(t.all('nav:back')).toEqual([{}]);

    document.body.replaceChildren();
    const u = boot({ nav: { screen: 'variety', sheet: null, previous: 'play' } });
    u.emit('variety:open', { room: 'classic' });
    $<HTMLButtonElement>(SEL.action('variety-back')).click();
    expect(u.seen('nav:go')).toEqual({ screen: 'home' });
    expect(u.all('nav:back')).toEqual([]);
  });

  test('a level a solve unlocked powers on once when its board shows', () => {
    const t = boot({ progress: progress([3]), nav: { screen: 'play', sheet: 'solved', previous: 'variety' } });
    t.emit('variety:open', { room: 'classic' });
    t.kernel.seed('nav', { screen: 'play', sheet: 'solved', previous: 'variety' });
    t.emit('progress:level_completed', { levelId: 2, stars: 3, moves: 2, par: 2, hintsUsed: 0, improved: true, unlocked: 3, allSolved: false, pack: 'classic', firstSolve: true });
    t.kernel.seed('progress', progress([3, 3]));
    expect(tile(3).hasAttribute('data-power-on')).toBe(false);
    t.kernel.seed('nav', { screen: 'variety', sheet: null, previous: 'play' });
    expect(tile(3).hasAttribute('data-power-on')).toBe(true);
    tile(3).removeAttribute('data-power-on');
    t.kernel.seed('nav', { screen: 'play', sheet: null, previous: 'variety' });
    t.kernel.seed('nav', { screen: 'variety', sheet: null, previous: 'play' });
    expect($$('[data-power-on]').length).toBe(0); // once
  });

  test('without levels nothing breaks; the screen still offers a way back', () => {
    const t = boot({ levels: { status: 'generating', list: [], chapters: [] } });
    t.emit('variety:open', { room: 'classic' });
    expect(t.seen('variety:refused')).toEqual({ reason: 'unknown_room' });
    expect($(SEL.action('variety-back'))).not.toBeNull();
  });
});
