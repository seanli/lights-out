// @vitest-environment happy-dom
import { beforeEach, describe, expect, test } from 'vitest';
import type { LevelDef, LevelsState, Pack, ProgressState, State } from '../../contracts';
import { CLASSIC_SHAPE, SEL } from '../../contracts';
import { parseShape } from '../../lib/shape';
import { bootModule } from '../../../test/fake-ctx';
import homeView, { suggest } from './index';

const COUNT = 50;
const cells = Array.from({ length: 25 }, (_, i) => i === 12);
const classic: Pack = { id: 'classic', name: 'Classic', kind: 'classic', shape: CLASSIC_SHAPE, first: 1, count: COUNT };
const small: Pack = { id: '4x4', name: 'Small room', kind: 'size', shape: { cols: 4, rows: 4, mask: null }, first: 1001, count: 12 };
const ring: Pack = {
  id: 'ring', name: 'Ring', kind: 'shape', first: 5001, count: 12,
  shape: parseShape(['XXXXXXX', 'XXXXXXX', 'XX...XX', 'XX...XX', 'XX...XX', 'XXXXXXX', 'XXXXXXX']),
};
const roomLevels = (p: Pack): LevelDef[] => Array.from({ length: p.count }, (_, i) => ({
  id: p.first + i, cells: Array(p.shape.cols * p.shape.rows).fill(false), par: i + 1, pack: p.id, index: i + 1, shape: p.shape,
}));
const levels: LevelsState = {
  status: 'ready',
  list: [...Array.from({ length: COUNT }, (_, i) => ({ id: i + 1, cells, par: 1 + (i % 15) })), ...roomLevels(small), ...roomLevels(ring)],
  chapters: [
    { id: 'first-light', name: 'First light', from: 1, to: 20 },
    { id: 'crossfade', name: 'Crossfade', from: 21, to: 40 },
    { id: 'blackout', name: 'Blackout', from: 41, to: 50 },
  ],
  packs: [classic, small, ring],
};
const scoring = { threeStarsWithin: 0, twoStarsWithin: 3, hintCost: 1, minStars: 1 };
const learnSlice = { status: 'ready' as const, lessonId: null, step: 0, completed: [], practice: null, assist: false };

/** stars per solved classic level from level 1; `rooms` adds room results by global id */
function progress(stars: number[], lastLevel = 0, rooms: Record<number, number> = {}): ProgressState {
  const results: ProgressState['save']['results'] = {};
  stars.forEach((s, i) => { results[String(i + 1)] = { stars: s as 1 | 2 | 3, bestMoves: 3, solvedAt: 1 }; });
  for (const [id, s] of Object.entries(rooms)) results[id] = { stars: s as 1 | 2 | 3, bestMoves: 3, solvedAt: 1 };
  const packs: NonNullable<ProgressState['packs']> = {};
  for (const p of [small, ring]) {
    let n = 0;
    while (results[String(p.first + n)]) n++;
    const solved = Object.keys(rooms).filter((id) => Number(id) >= p.first && Number(id) < p.first + p.count);
    packs[p.id] = { unlockedUpTo: Math.min(p.count, n + 1), solved: solved.length, stars: solved.reduce((a, id) => a + rooms[Number(id)]!, 0) };
  }
  return {
    status: 'ready', save: { version: 1, results, pendingHints: {}, lastLevel }, unlockedUpTo: Math.min(COUNT, stars.length + 1), scoring,
    packs, varietyOpen: results['20'] !== undefined,
  };
}

function boot(state: Partial<State> = {}) {
  return bootModule(homeView, {
    state: {
      levels, progress: progress([]), storage: { status: 'ok' }, sound: { enabled: true, status: 'idle' },
      nav: { screen: 'home', sheet: null }, variety: { room: null }, ...state,
    },
  });
}
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const row = (id: string) => $<HTMLButtonElement>(SEL.roomTile(id));
const contText = () => $(SEL.action('continue')).textContent;

beforeEach(() => document.body.replaceChildren());

describe('suggest (what Continue starts)', () => {
  const packs = levels.packs!;
  test('fresh progress starts classic level 1', () => {
    expect(suggest(packs, progress([]))).toMatchObject({ levelId: 1, fresh: true });
    expect(suggest(packs, undefined)).toMatchObject({ levelId: 1, fresh: true });
  });
  test('mid progress continues at the lowest unlocked unsolved classic level; a gap wins over the frontier', () => {
    expect(suggest(packs, progress([3, 3, 2, 3, 1, 2], 6))).toMatchObject({ levelId: 7, fresh: false });
    const p = progress([3, 3, 3], 3);
    const { ['2']: _gap, ...rest } = p.save.results;
    expect(suggest(packs, { ...p, save: { ...p.save, results: rest } }).levelId).toBe(2);
  });
  test('the board last played wins: a room level continues in that room', () => {
    const p = progress(Array(25).fill(3), 1003, { 1001: 3, 1002: 2 });
    expect(suggest(packs, p)).toMatchObject({ levelId: 1003, fresh: false, pack: small });
  });
  test('a room with nothing left falls back to classic, then to the first board with an open level', () => {
    const roomDone = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [1001 + i, 3]));
    expect(suggest(packs, progress(Array(25).fill(3), 1012, roomDone)).levelId).toBe(26);
    expect(suggest(packs, progress(Array(COUNT).fill(3), 1012, roomDone)).levelId).toBe(5001); // the ring is next in menu order
  });
  test('a last level in a locked room or out of range is ignored (classic)', () => {
    expect(suggest(packs, progress([3, 3], 1001)).levelId).toBe(3);
    expect(suggest(packs, progress([3, 3], 9999)).levelId).toBe(3);
  });
  test('everything solved suggests the last played level, else classic\'s last', () => {
    const all = Object.fromEntries([small, ring].flatMap((p) => Array.from({ length: 12 }, (_, i) => [p.first + i, 3])));
    expect(suggest(packs, progress(Array(COUNT).fill(3), 17, all))).toMatchObject({ levelId: 17, fresh: false });
    expect(suggest(packs, progress(Array(COUNT).fill(3), 5004, all)).levelId).toBe(5004);
    expect(suggest(packs, progress(Array(COUNT).fill(3), 0, all)).levelId).toBe(COUNT);
  });
});

describe('home-view: the menu', () => {
  test('Continue names the level; the caption counts open boards; the chip totals every board', () => {
    const t = boot({ progress: progress([3, 3, 2, 3, 1, 2], 6) });
    expect($('[data-star-total]').textContent).toBe('14');
    expect($('[data-star-total]').getAttribute('aria-label')).toBe('14 stars');
    expect(contText()).toBe('Continue·Level 7');
    expect($('[data-home-caption]').textContent).toBe('6 of 50 solved'); // the saved note is for a first visit only
    $<HTMLButtonElement>(SEL.action('continue')).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 7 });
  });

  test('fresh progress says Start · Level 1; memory storage drops the saved note', () => {
    boot();
    expect(contText()).toBe('Start·Level 1');
    expect($('[data-home-caption]').textContent).toBe('0 of 50 solved · Progress is saved on this device');
    document.body.replaceChildren();
    const t = boot({ storage: { status: 'memory', reason: 'blocked' } });
    expect($('[data-home-caption]').textContent).toBe('0 of 50 solved');
    $<HTMLButtonElement>(SEL.action('continue')).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 1 });
  });

  test('Continue in a room says the room and its index; stars and counts span every open board', () => {
    const t = boot({ progress: progress(Array(25).fill(3), 1003, { 1001: 3, 1002: 2 }) });
    expect(contText()).toBe('Continue·Small room 3');
    expect($('[data-star-total]').textContent).toBe(String(25 * 3 + 5));
    expect($('[data-home-caption]').textContent).toBe('27 of 74 solved');
    $<HTMLButtonElement>(SEL.action('continue')).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 1003 });
  });

  test('everything solved: Continue replays the last played level and the caption says so', () => {
    const all = Object.fromEntries([small, ring].flatMap((p) => Array.from({ length: 12 }, (_, i) => [p.first + i, 3])));
    boot({ progress: progress(Array(COUNT).fill(3), 23, all) });
    expect(contText()).toBe('Continue·Level 23');
    expect($('[data-home-caption]').textContent).toBe('Every level solved. Replay any level to improve your stars.');
  });

  test('one row per board in packs order, classic first, with name, meta, solved/count and stars', () => {
    boot({ progress: progress(Array(20).fill(3).concat([2]), 21, { 1001: 3, 1002: 2 }) });
    const rows = [...document.querySelectorAll<HTMLElement>('[data-room-tile]')];
    expect(rows.map((r) => r.dataset.room)).toEqual(['classic', '4x4', 'ring']);
    expect(rows.every((r) => r.tagName === 'BUTTON')).toBe(true);
    expect(row('classic').dataset).toMatchObject({ solved: '21', stars: '62', locked: 'false' });
    expect(row('classic').textContent).toBe('Classic5×5 · 50 levels21/5062');
    expect(row('classic').getAttribute('aria-label')).toBe('Classic: 21 of 50 solved, 62 stars');
    expect(row('4x4').textContent).toBe('Small room4×4 · 12 levels2/125');
    expect(row('ring').textContent).toBe('Ring12 levels0/120');
    expect(row('ring').querySelectorAll('.room-glyph > i[data-gap]').length).toBe(9); // the ring's hole
    expect(row('4x4').querySelectorAll('.room-glyph > i[data-lit="true"]').length).toBe(3); // 2 of 12 solved → 3 of 16 dots
    expect($('#home-boards').textContent).toBe('Boards');
  });

  test('a row opens its board; rooms are locked until classic level 20, classic never is', () => {
    const t = boot({ progress: progress([3, 3]) });
    expect(row('classic').dataset.locked).toBe('false');
    expect(row('4x4').dataset.locked).toBe('true');
    expect(row('4x4').getAttribute('aria-disabled')).toBe('true');
    expect(row('4x4').textContent).toBe('Small roomOpens after level 20'); // no numbers
    expect(row('4x4').querySelector<HTMLElement>('.home__row-score')!.hidden).toBe(true);
    row('4x4').click();
    expect(t.all('variety:open')).toEqual([]);
    row('classic').click();
    expect(t.all('variety:open')).toEqual([{ room: 'classic' }]);

    t.kernel.seed('progress', progress(Array(20).fill(3), 20));
    expect(row('4x4').dataset.locked).toBe('false');
    expect(row('4x4').hasAttribute('aria-disabled')).toBe(false);
    row('4x4').click();
    expect(t.seen('variety:open')).toEqual({ room: '4x4' });
  });

  test('rows update in place when progress changes', () => {
    const t = boot({ progress: progress(Array(20).fill(3), 20) });
    const before = row('4x4');
    t.kernel.seed('progress', progress(Array(20).fill(3), 1001, { 1001: 3 }));
    expect(row('4x4')).toBe(before);
    expect(before.dataset).toMatchObject({ solved: '1', stars: '3' });
    expect(contText()).toBe('Continue·Small room 2');
  });

  test('the boards hide without the variety module (nothing would open them); Continue still plays', () => {
    const t = boot({ variety: undefined });
    expect($<HTMLElement>('.home__boards').hidden).toBe(true);
    $<HTMLButtonElement>(SEL.action('continue')).click();
    expect(t.seen('levels:start')).toEqual({ levelId: 1 });
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

  test('learn: a row under the boards, plus a first-visit link until level 3 is solved; both hide without learn', () => {
    const t = boot({ learn: learnSlice });
    const [link, learnRow] = document.querySelectorAll<HTMLButtonElement>(SEL.action('learn'));
    expect(link!.hidden).toBe(false);
    expect(link!.textContent).toBe('New here? Learn the patterns');
    expect(learnRow!.closest<HTMLElement>('[hidden]')).toBeNull();
    expect(learnRow!.textContent).toBe('Learn the patternsLessons and a guide for each board');
    learnRow!.click();
    link!.click();
    expect(t.all('learn:open')).toEqual([{}, {}]);
    t.kernel.seed('progress', progress([3, 3, 2]));
    expect(link!.hidden).toBe(true);
    expect(learnRow!.closest<HTMLElement>('[hidden]')).toBeNull();

    document.body.replaceChildren();
    boot();
    for (const el of document.querySelectorAll<HTMLElement>(SEL.action('learn'))) expect(el.closest('[hidden]')).not.toBeNull();
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

  test('without progress every board is open and nothing breaks', () => {
    const t = boot({ progress: undefined });
    expect(row('ring').dataset.locked).toBe('false');
    expect($('[data-star-total]').hidden).toBe(true);
    expect($(SEL.action('reset')).hidden).toBe(true);
    row('ring').click();
    expect(t.seen('variety:open')).toEqual({ room: 'ring' });
  });

  test('levels error shows a plain message, no continue and no boards', () => {
    boot({ levels: { status: 'error', list: [], chapters: [], error: 'boom' } });
    expect($('.home__error').hidden).toBe(false);
    expect($(SEL.action('continue')).hidden).toBe(true);
    expect(document.querySelectorAll('[data-room-tile]').length).toBe(0);
    expect(document.querySelectorAll('[data-level-tile]').length).toBe(0);
  });
});
