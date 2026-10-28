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
  chapters: [],
  packs: [classic, small, ring],
};

function progress(open: boolean, smallStars: number[] = []): ProgressState {
  const results: ProgressState['save']['results'] = {};
  smallStars.forEach((s, i) => { results[String(1001 + i)] = { stars: s as 1 | 2 | 3, bestMoves: 3, solvedAt: 1 }; });
  return {
    status: 'ready', save: { version: 1, results, pendingHints: {}, lastLevel: 20 }, unlockedUpTo: 21, varietyOpen: open,
    packs: {
      '4x4': { unlockedUpTo: Math.min(12, smallStars.length + 1), solved: smallStars.length, stars: smallStars.reduce((a, b) => a + b, 0) },
      ring: { unlockedUpTo: 1, solved: 0, stars: 0 },
    },
  };
}

function boot(state: Partial<State> = {}) {
  return bootModule(variety, { state: { levels, progress: progress(true), nav: { screen: 'home', sheet: null, previous: null }, ...state } });
}
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const $$ = (sel: string) => [...document.querySelectorAll<HTMLElement>(sel)];

beforeEach(() => document.body.replaceChildren());

describe('variety', () => {
  test('variety:open shows the room list and goes to the variety screen', () => {
    const t = boot();
    t.emit('variety:open', {});
    expect(t.state('variety')).toEqual({ room: null });
    expect(t.seen('variety:opened')).toEqual({ room: null });
    expect(t.seen('nav:go')).toEqual({ screen: 'variety' });
    expect($$('[data-room-tile]').map((el) => el.dataset.room)).toEqual(['4x4', 'ring']);
  });

  test('refuses while locked and for an unknown room; no progress slice means open', () => {
    const t = boot({ progress: progress(false) });
    t.emit('variety:open', {});
    expect(t.seen('variety:refused')).toEqual({ reason: 'locked' });
    expect(t.all('nav:go')).toEqual([]);

    document.body.replaceChildren();
    const u = boot();
    u.emit('variety:open', { room: 'nope' });
    expect(u.seen('variety:refused')).toEqual({ reason: 'unknown_room' });
    expect(u.all('nav:go')).toEqual([]);

    document.body.replaceChildren();
    const w = boot({ progress: undefined });
    w.emit('variety:open', { room: 'ring' });
    expect(w.state('variety')).toEqual({ room: 'ring' });
    expect(w.seen('nav:go')).toEqual({ screen: 'variety' });
  });

  test('room tiles reflect progress.packs and draw the room shape with its gaps', () => {
    boot({ progress: progress(true, [3, 2, 3]) });
    const tile = $('[data-room-tile][data-room="4x4"]');
    expect(tile.dataset).toMatchObject({ solved: '3', stars: '8' });
    expect(tile.textContent).toContain('Small room');
    expect(tile.textContent).toContain('3/12');
    expect(tile.textContent).toContain('8/36');
    expect(tile.querySelectorAll('.room-glyph > i').length).toBe(16);
    expect(tile.querySelectorAll('.room-glyph > i[data-lit="true"]').length).toBe(4); // 3 of 12 solved → a quarter lit
    const r = $('[data-room-tile][data-room="ring"]');
    expect(r.dataset).toMatchObject({ solved: '0', stars: '0' });
    expect(r.querySelectorAll('.room-glyph > i').length).toBe(49);
    expect(r.querySelectorAll('.room-glyph > i[data-gap]').length).toBe(9);
  });

  test('a room tile opens the room; its levels use global ids, locked ones are inert', () => {
    const t = boot({ progress: progress(true, [3, 2]) });
    $<HTMLButtonElement>('[data-room-tile][data-room="4x4"]').click();
    expect(t.seen('variety:open')).toEqual({ room: '4x4' });
    expect(t.state('variety')).toEqual({ room: '4x4' });
    expect($('[data-room-view]').dataset.roomView).toBe('4x4');
    const tiles = $$('[data-level-tile]');
    expect(tiles.map((el) => Number(el.dataset.level))).toEqual(Array.from({ length: 12 }, (_, i) => 1001 + i));
    expect($(SEL.levelTile(1001)).dataset).toMatchObject({ stars: '3', locked: 'false', current: 'false' });
    expect($(SEL.levelTile(1003)).dataset).toMatchObject({ stars: '0', locked: 'false', current: 'true' });
    expect($(SEL.levelTile(1004)).dataset).toMatchObject({ locked: 'true', current: 'false' });
    expect($(SEL.levelTile(1004)).getAttribute('aria-label')).toBe('Level 4, locked');
    $<HTMLButtonElement>(SEL.levelTile(1004)).click();
    expect(t.all('levels:start')).toEqual([]);
    $<HTMLButtonElement>(SEL.levelTile(1003)).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 1003 });
    $<HTMLButtonElement>(SEL.levelTile(1001)).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 1001 });
  });

  test('back: room → list, list → nav:back (or home when we came from a level)', () => {
    const t = boot();
    t.emit('variety:open', { room: 'ring' });
    $<HTMLButtonElement>(SEL.action('variety-back')).click();
    expect(t.state('variety')).toEqual({ room: null });
    expect($$('[data-room-tile]').length).toBe(2);
    expect(t.all('nav:back')).toEqual([]);
    $<HTMLButtonElement>(SEL.action('variety-back')).click();
    expect(t.all('nav:back')).toEqual([{}]);

    document.body.replaceChildren();
    const u = boot({ nav: { screen: 'variety', sheet: null, previous: 'play' } });
    u.emit('variety:open', {});
    $<HTMLButtonElement>(SEL.action('variety-back')).click();
    expect(u.seen('nav:go')).toEqual({ screen: 'home' });
    expect(u.all('nav:back')).toEqual([]);
  });

  test('tiles repaint in place when progress changes', () => {
    const t = boot({ progress: progress(true, [3]) });
    t.emit('variety:open', { room: '4x4' });
    const before = $(SEL.levelTile(1002));
    t.kernel.seed('progress', progress(true, [3, 1]));
    expect($(SEL.levelTile(1002))).toBe(before);
    expect(before.dataset).toMatchObject({ stars: '1', current: 'false' });
    expect($(SEL.levelTile(1003)).dataset).toMatchObject({ locked: 'false', current: 'true' });
  });

  test('without rooms the list says so and nothing breaks', () => {
    boot({ levels: { status: 'ready', list: levels.list.slice(0, 50), chapters: [], packs: [classic] } });
    expect($$('[data-room-tile]').length).toBe(0);
    expect($('.variety__empty').textContent).toBe('No rooms yet.');
  });
});
