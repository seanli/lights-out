import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { bootModule, fixtureData } from '../../../test/fake-ctx';
import { refPress, refSolve } from '../../../test/ref-solver';
import { CLASSIC_SHAPE, type Cells, type LevelsState, type ProgressState, type Shape, type SolverService } from '../../contracts';
import { cubeShape } from '../../lib/cube';
import { chaseClears, chaseable, readableIn } from '../../lib/puzzle';
import { cellIndexes, fitsShape, gridSize, hexagonShape, isCell, isPressable, parseShape, pressTargets, shapeKey, shapeProblem, touching } from '../../lib/shape';
import { isPinwheel, symmetriesOfBoard } from '../../lib/symmetry';
import levels from './index';
import { looksFor, parsOf, type Looks } from './generate';

/**
 * independent reference for any board: BigInt elimination with one equation per real cell and one variable per
 * pressable cell (wiring makes the press map one-way, stuck cells have no variable), then the lightest of every solution.
 * The elimination is done once per shape, tracking which cells' equations each row sums, so a board only needs its
 * right-hand side.
 */
type RefElim = { real: number[]; vars: number[]; rows: bigint[]; sums: bigint[]; pivots: number[]; free: number[] };
const refElims = new Map<string, RefElim>();
const parity = (x: bigint) => { let n = 0; for (; x; x &= x - 1n) n ^= 1; return n; };
function refElim(shape: Shape): RefElim {
  const key = shapeKey(shape);
  const hit = refElims.get(key);
  if (hit) return hit;
  const real = cellIndexes(shape);
  const vars = real.filter((g) => isPressable(shape, g));
  const rows = real.map((g) => vars.reduce((row, v, j) => (pressTargets(shape, v).includes(g) ? row | (1n << BigInt(j)) : row), 0n));
  const sums = real.map((_, i) => 1n << BigInt(i));
  const pivots: number[] = [];
  for (let col = 0; col < vars.length; col++) {
    const bit = 1n << BigInt(col), rank = pivots.length;
    const p = rows.findIndex((row, i) => i >= rank && (row & bit) !== 0n);
    if (p < 0) continue;
    [rows[rank], rows[p]] = [rows[p]!, rows[rank]!];
    [sums[rank], sums[p]] = [sums[p]!, sums[rank]!];
    for (let r = 0; r < rows.length; r++) if (r !== rank && rows[r]! & bit) { rows[r]! ^= rows[rank]!; sums[r]! ^= sums[rank]!; }
    pivots.push(col);
  }
  const free = [...Array(vars.length).keys()].filter((c) => !pivots.includes(c));
  const e = { real, vars, rows, sums, pivots, free };
  refElims.set(key, e);
  return e;
}
function refShapedSolve(shape: Shape, cells: readonly boolean[]): number[] | null {
  if (!fitsShape(shape, cells)) return null;
  const { real, vars, rows, sums, pivots, free } = refElim(shape);
  const lit = real.reduce((m, g, i) => (cells[g] ? m | (1n << BigInt(i)) : m), 0n);
  const rhs = sums.map((x) => parity(x & lit));
  for (let r = pivots.length; r < rows.length; r++) if (rhs[r]) return null;
  let best: number[] = [];
  for (let combo = 0; combo < 1 << free.length; combo++) {
    const x = new Set<number>(free.filter((_, k) => combo & (1 << k)));
    pivots.forEach((pv, r) => {
      let bit = rhs[r]!;
      for (const f of free) if (x.has(f) && rows[r]! & (1n << BigInt(f))) bit ^= 1;
      if (bit) x.add(pv);
    });
    if (combo === 0 || x.size < best.length) best = [...x];
  }
  return best.map((j) => vars[j]!).sort((a, b) => a - b);
}
const shapedPress = (cells: Cells, i: number, shape?: Shape): Cells => {
  if (!shape) return refPress(cells, i);
  const out = cells.slice();
  for (const t of pressTargets(shape, i)) out[t] = !out[t];
  return out;
};
const shapedSolve = (cells: Cells, shape?: Shape) => (shape ? refShapedSolve(shape, cells) : refSolve(cells));

// modules never import each other: inject an independent reference solver
const solver: SolverService = { press: shapedPress, solve: shapedSolve, isSolvable: (c, s) => shapedSolve(c, s) !== null };
type Band = { pars: number[]; boss: number };
type Picture = { at: number; picture: 'all' | string[] };
type Room = { id: string; kind: string; group: string; cols?: number; rows?: number; side?: number; picture?: string[]; idBase: number; seed: number; bands: Band[]; pictures?: Picture[] };
const rules = (fixtureData.rules as { levels: Record<string, unknown> & { rooms: Room[]; pictures?: Picture[] } }).levels;
/** a picture level's board: every light on, or the picture's "X"s */
const pictureCells = (shape: Shape, p: Picture): boolean[] =>
  p.picture === 'all' ? Array.from({ length: gridSize(shape) }, (_, i) => isCell(shape, i)) : p.picture.join('').split('').map((ch) => ch === 'X');
const classicPictures = new Map((rules.pictures ?? []).map((p) => [p.at, pictureCells(CLASSIC_SHAPE, p)]));
const looks = rules.looks as Looks;
/** the pars the data asks for, except a picture's: whatever its board needs */
const target = parsOf(rules.bands as Band[]).map((par, i) => (classicPictures.has(i + 1) ? refSolve(classicPictures.get(i + 1)!)!.length : par));
const nine = (p: number) => Array<number>(9).fill(p);
const rooms = rules.rooms;
const roomNames = (fixtureData.copy as { levels: { rooms: Record<string, string> } }).levels.rooms;
const classicOf = (s: LevelsState) => s.list.filter((l) => l.pack === undefined);

function withRules(patch: Record<string, unknown>) {
  return { ...fixtureData, rules: { ...fixtureData.rules, levels: { ...rules, ...patch } } };
}
const boot = (opts: Parameters<typeof bootModule>[1] = {}) => bootModule(levels, { services: { solver }, ...opts });
const progress = (unlockedUpTo: number, variety: Pick<ProgressState, 'varietyOpen' | 'packs'> = {}): ProgressState => ({
  status: 'ready',
  save: { version: 1, results: {}, pendingHints: {}, lastLevel: 1 },
  unlockedUpTo,
  ...variety,
});

describe('levels', () => {
  const t = boot();
  const state = t.state('levels') as LevelsState;

  test('makes one level per par, with chapters named from copy', () => {
    expect(state.status).toBe('ready');
    expect(classicOf(state).map((l) => l.id)).toEqual(target.map((_, i) => i + 1));
    expect(state.list.slice(0, target.length)).toEqual(classicOf(state));
    expect(state.chapters).toEqual([
      { id: 'first-light', name: 'First light', from: 1, to: 20 },
      { id: 'crossfade', name: 'Crossfade', from: 21, to: 40 },
      { id: 'blackout', name: 'Blackout', from: 41, to: 50 },
    ]);
    expect(t.seen('levels:generated')).toEqual({ count: target.length, pars: target });
  });

  // pinned so an accidental change to generation or data shows up here; re-pinned on purpose with decision 45 (bosses),
  // decision 72 (from level 3 no board a plain chase clears) and decision 79 (symmetric and tangled boards, pictures)
  test('the classic 50 boards are exactly the ones players already have (pinned hash)', () => {
    const hash = createHash('sha256').update(JSON.stringify(classicOf(state))).digest('hex');
    expect(hash).toBe('8f2e1d32e71e14ce35f3f23b61611f9fa1e6e907a7887143b8223c4252beeb0c');
    // the tutorial's two levels never changed
    const on = (l: { cells: Cells }) => l.cells.flatMap((x, i) => (x ? [i] : []));
    expect(on(classicOf(state)[0]!)).toEqual([1, 5, 6, 7, 11]);
    expect(on(classicOf(state)[1]!)).toEqual([2, 6, 7, 8, 10, 12, 15, 16, 20]);
  });

  test('no free par: from level 3 a plain chase never clears a classic board (each needs the top-row fix)', () => {
    for (const level of classicOf(state).slice(2)) expect(chaseClears(CLASSIC_SHAPE, level.cells, solver), `level ${level.id}`).toBe(false);
  });

  test('every par is the solver’s fewest presses and matches the data (a picture: the picture, whatever it needs)', () => {
    for (const level of classicOf(state)) {
      expect(refSolve(level.cells)?.length).toBe(level.par);
      expect(level.par).toBe(target[level.id - 1]);
      if (classicPictures.has(level.id)) expect(level.cells).toEqual(classicPictures.get(level.id));
    }
    // the finale is every light on
    expect(classicOf(state)[49]!.cells.every(Boolean)).toBe(true);
  });

  test('from level 3 a board is symmetric (a mirror or a turn carries it onto itself) or, where the data says tangled, shows no symmetry at all; none is a pinwheel', () => {
    let tangled = 0;
    for (const level of classicOf(state).slice(2)) {
      if (classicPictures.has(level.id)) continue;
      const order = looksFor(looks, level.id, !!level.boss);
      if (!order) tangled++;
      expect(symmetriesOfBoard(CLASSIC_SHAPE, level.cells).length > 0, `level ${level.id}`).toBe(order !== null);
    }
    // about a third of the regular levels are asymmetric on purpose
    expect(tangled).toBeGreaterThanOrEqual(12);
    for (const level of state.list) expect(isPinwheel(level.shape ?? CLASSIC_SHAPE, level.cells), `level ${level.id}`).toBe(false);
  });

  test('every board is different', () => {
    const keys = classicOf(state).map((l) => l.cells.map(Number).join(''));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('same seed gives the same levels; another seed gives others; the session rng is never used', () => {
    expect((boot({ seed: 999 }).state('levels') as LevelsState).list).toEqual(state.list);
    const other = boot({ data: withRules({ seed: 2 }) }).state('levels') as LevelsState;
    expect(classicOf(other).map((l) => l.par)).toEqual(target);
    expect(classicOf(other)).not.toEqual(classicOf(state));
    // each room has its own seed: the classic seed doesn't touch them
    expect(other.list.filter((l) => l.pack)).toEqual(state.list.filter((l) => l.pack));
  });

  // the real solver makes them in about 200 ms in the browser (the probe's lo:interactive budget covers that)
  test('generates fast enough', () => {
    const t0 = performance.now();
    boot();
    const ms = performance.now() - t0;
    console.log(`levels: ${state.list.length} levels in ${ms.toFixed(1)} ms with the reference solver (the real one is faster)`);
    expect(ms).toBeLessThan(1500);
  });

  test('when tries run out it keeps the closest board and warns with the real par', () => {
    // random presses only (no symmetric boards, no pictures): a random 14- or 15-press board is rarely that par
    const b = boot({ data: withRules({ bands: [{ pars: nine(14), boss: 15 }], maxTries: 1, chapters: [{ id: 'first-light', from: 1, to: 10 }], rooms: [], pictures: [], looks: { ...(rules.looks as object), from: 11 } }) });
    const s = b.state('levels') as LevelsState;
    expect(s.status).toBe('ready');
    for (const l of s.list) {
      expect(refSolve(l.cells)?.length).toBe(l.par);
      expect(l.par).toBeLessThanOrEqual(15);
    }
    const wanted = (id: number) => (id === 10 ? 15 : 14);
    const missed = s.list.filter((l) => l.par !== wanted(l.id));
    expect(missed.length).toBeGreaterThan(0); // a random 14- or 15-press board is rarely that par
    const warns = b.kernel.debug.logs().filter((r) => r.level === 'warn' && r.source === 'levels');
    expect(warns.map((w) => w.msg)).toEqual(missed.map((l) => expect.stringContaining(`Level ${l.id} has par ${l.par}, not ${wanted(l.id)}`)));
  });

  test.each([
    [[{ id: 'first-light', from: 1, to: 20 }, { id: 'blackout', from: 41, to: 50 }], /No chapter covers levels 21–40/],
    [[{ id: 'first-light', from: 1, to: 20 }, { id: 'crossfade', from: 21, to: 40 }], /No chapter covers levels 41–50/],
    [[{ id: 'first-light', from: 2, to: 50 }], /No chapter covers level 1\b/],
    [[{ id: 'first-light', from: 1, to: 30 }, { id: 'crossfade', from: 25, to: 50 }], /starts at level 25, which an earlier chapter already covers/],
    [[{ id: 'first-light', from: 1, to: 51 }], /run to level 51, but there are only 50 levels/],
    [[{ id: 'nameless', from: 1, to: 50 }], /"nameless" has no name/],
  ])('chapters must cover every level exactly once (%#)', (chapters, message) => {
    expect(() => boot({ data: withRules({ chapters }) })).toThrow(message);
  });

  test('data with a par no board can have is rejected before init', () => {
    expect(() => boot({ data: withRules({ bands: [{ pars: nine(1), boss: 16 }] }) })).toThrow(/A classic par must be 1–15/);
    expect(() => boot({ data: withRules({ bands: [{ pars: nine(5), boss: 5 }] }) })).toThrow(/A boss must need more presses/);
    expect(() => boot({ data: withRules({ bands: [{ pars: [1, 2], boss: 5 }] }) })).toThrow(/A band has 9 levels before its boss/);
  });

  test('start loads the board and says so', () => {
    const b = boot();
    b.emit('levels:start', { levelId: 7 });
    const level = state.list[6]!;
    expect(b.seen('board:load')).toEqual({ levelId: 7, cells: level.cells, par: level.par });
    expect(b.seen('levels:started')).toEqual({ levelId: 7, par: level.par, count: 50, pack: 'classic', index: 7, next: 8 });
    b.emit('levels:start', { levelId: 50 });
    expect(b.seen('levels:started')).toMatchObject({ levelId: 50, count: 50, next: null });
    expect(b.all('levels:refused')).toEqual([]);
  });

  test('refuses unknown levels', () => {
    const b = boot();
    for (const levelId of [0, 51, 2.5, -1, 1000, 1013, 7000]) {
      b.emit('levels:start', { levelId });
      expect(b.seen('levels:refused')).toEqual({ levelId, reason: 'unknown' });
    }
    expect(b.all('board:load')).toEqual([]);
  });

  test('refuses locked levels when progress exists; everything is open without it', () => {
    const b = boot({ state: { progress: progress(3) } });
    b.emit('levels:start', { levelId: 4 });
    expect(b.seen('levels:refused')).toEqual({ levelId: 4, reason: 'locked' });
    b.emit('levels:start', { levelId: 3 });
    expect(b.seen('levels:started', { levelId: 3 })).toBeTruthy();
    expect(b.all('board:load').length).toBe(1);

    const open = boot();
    open.emit('levels:start', { levelId: 50 });
    expect(open.seen('levels:started', { levelId: 50 })).toBeTruthy();
  });

  test('refuses while not ready, and shows a failed generation as an error', () => {
    const broken: SolverService = { ...solver, solve: () => null };
    const b = boot({ services: { solver: broken } });
    const s = b.state('levels') as LevelsState;
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/Couldn't make the levels/);
    expect(b.all('levels:generated')).toEqual([]);
    b.emit('levels:start', { levelId: 1 });
    expect(b.seen('levels:refused')).toEqual({ levelId: 1, reason: 'not_ready' });
  });

  test('console commands', () => {
    const b = boot();
    const cmd = b.instance!.commands!;
    expect(String(cmd.list!([])).split('\n')[0]).toBe(`1: ${target[0]}`);
    const first = rooms[0]!;
    expect(String(cmd.list!([]))).toContain(`${first.idBase + 1}: ${first.bands[0]!.pars[0]} (${first.id} 1)`);
    expect(String(cmd.list!([]))).toContain('10: 7 boss');
    cmd.start!(['5']);
    expect(b.seen('levels:started', { levelId: 5 })).toBeTruthy();
    expect(cmd.start!([])).toMatch(/Usage/);
  });

  describe('Variety rooms', () => {
    const shapeOf = (r: Room): Shape => (r.kind === 'shape' ? parseShape(r.picture!)
      : r.kind === 'hex' ? hexagonShape(r.side!)
      : r.kind === 'cube' ? cubeShape(r.side!)
      : { cols: r.cols!, rows: r.rows!, mask: null });

    test('packs: classic first, then each room in data order, named from copy', () => {
      expect(state.packs).toEqual([
        { id: 'classic', name: 'Classic', kind: 'classic', group: 'boards', shape: { cols: 5, rows: 5, mask: null }, first: 1, count: 50 },
        ...rooms.map((r) => ({ id: r.id, name: roomNames[r.id], kind: r.kind, group: r.group, shape: shapeOf(r), first: r.idBase + 1, count: r.bands.length * 10 })),
      ]);
      expect(state.list.length).toBe(50 + rooms.reduce((n, r) => n + r.bands.length * 10, 0));
    });

    test.each(rooms.map((r) => [r.id, r] as const))('%s: ids, pack, index, shape; par = fewest presses = data; no repeats', (id, room) => {
      const shape = shapeOf(room);
      const list = state.list.filter((l) => l.pack === id);
      const pictures = new Map((room.pictures ?? []).map((p) => [p.at, pictureCells(shape, p)]));
      // a picture's par is what it needs on its board (in a stuck or wired room, with the stuck cells or wiring placed around it)
      const pars = parsOf(room.bands).map((par, i) => {
        if (!pictures.has(i + 1)) return par;
        const level = list[i]!;
        return refShapedSolve(level.shape!, pictures.get(i + 1)!)!.length;
      });
      expect(list.map((l) => l.id)).toEqual(pars.map((_, i) => room.idBase + i + 1));
      expect(list.map((l) => l.index)).toEqual(pars.map((_, i) => i + 1));
      expect(list.map((l) => l.par)).toEqual(pars);
      expect(list.filter((l) => l.boss).map((l) => l.index)).toEqual(room.bands.map((_, k) => (k + 1) * 10));
      for (const l of list) {
        // a stuck or wired room's level is the room's grid plus that level's own stuck cells or wiring
        const { stuck, wires, ...grid } = l.shape!;
        expect(grid).toEqual(shape);
        expect(stuck !== undefined).toBe(room.kind === 'stuck');
        expect(wires !== undefined).toBe(room.kind === 'wired');
        if (stuck) {
          expect(stuck).toHaveLength((room.bands[Math.floor((l.index! - 1) / 10)] as Band & { stuck: number }).stuck);
          // stuck plates sit apart and off the edge (decision 60)
          for (const g of stuck) {
            expect(touching(shape, g).length, `${id} level ${l.index}: stuck ${g} on the edge`).toBe(4);
            expect(stuck.some((h) => touching(shape, g).includes(h)), `${id} level ${l.index}: stuck ${g} touches another`).toBe(false);
          }
        }
        expect(shapeProblem(l.shape!)).toBeNull();
        expect(l.cells.length).toBe(gridSize(shape));
        expect(fitsShape(l.shape!, l.cells)).toBe(true);
        const fewest = refShapedSolve(l.shape!, l.cells)!;
        expect(fewest.length).toBe(l.par);
        if (pictures.has(l.index!)) {
          expect(l.cells).toEqual(pictures.get(l.index!));
          continue;
        }
        // the openings don't give themselves away: no press of a fewest solution shows as its whole footprint
        expect(readableIn(l.shape!, l.cells, fewest)).toBe(0);
        // symmetric: a mirror or a turn carries the board (lights, stuck cells and wiring) onto itself; tangled: nothing does
        expect(symmetriesOfBoard(l.shape!, l.cells).length > 0, `${id} level ${l.index}`).toBe(looksFor(looks, l.index!, !!l.boss) !== null);
        // no free par: from level 3 on a board you chase, a plain chase never clears it
        if (l.index! >= 3 && chaseable(l.shape!)) expect(chaseClears(l.shape!, l.cells, solver), `${id} level ${l.index}`).toBe(false);
      }
      expect(new Set(list.map((l) => l.cells.map(Number).join(''))).size).toBe(list.length);
    });

    test('a room’s levels come from its own seed only', () => {
      const changed = boot({ data: withRules({ rooms: rooms.map((r) => (r.id === 'ring' ? { ...r, seed: r.seed + 1 } : r)) }) }).state('levels') as LevelsState;
      for (const l of changed.list) {
        const was = state.list.find((o) => o.id === l.id)!;
        if (l.pack === 'ring') continue;
        expect(l).toEqual(was);
      }
      expect(changed.list.filter((l) => l.pack === 'ring')).not.toEqual(state.list.filter((l) => l.pack === 'ring'));
      const none = boot({ data: withRules({ rooms: [] }) }).state('levels') as LevelsState;
      expect(none.list).toEqual(classicOf(state));
      expect(none.packs!.map((p) => p.id)).toEqual(['classic']);
    });

    test('starting a room level loads its shape and says where it sits in the room', () => {
      const b = boot();
      const ring = rooms.find((r) => r.id === 'ring')!;
      const level = state.list.find((l) => l.id === 5001)!;
      b.emit('levels:start', { levelId: 5001 });
      expect(b.seen('board:load')).toEqual({ levelId: 5001, cells: level.cells, par: level.par, shape: shapeOf(ring) });
      expect(b.seen('levels:started')).toEqual({ levelId: 5001, par: level.par, count: 30, pack: 'ring', index: 1, next: 5002 });
      b.emit('levels:start', { levelId: 5030 });
      expect(b.seen('levels:started')).toMatchObject({ levelId: 5030, pack: 'ring', index: 30, next: null, boss: true });
    });

    test('rooms stay locked until Variety opens, then unlock one at a time inside each room', () => {
      const closed = boot({ state: { progress: progress(50) } });
      closed.emit('levels:start', { levelId: 3001 });
      expect(closed.seen('levels:refused')).toEqual({ levelId: 3001, reason: 'locked' });

      const open = boot({ state: { progress: progress(21, { varietyOpen: true, packs: { '7x7': { unlockedUpTo: 3, solved: 2, stars: 6 } } }) } });
      for (const id of [3001, 3003, 13001]) {
        open.emit('levels:start', { levelId: id });
        expect(open.seen('levels:started', { levelId: id })).toBeTruthy();
      }
      for (const id of [3004, 13002]) {
        open.emit('levels:start', { levelId: id });
        expect(open.seen('levels:refused')).toEqual({ levelId: id, reason: 'locked' });
      }
      // classic locking is untouched by rooms
      open.emit('levels:start', { levelId: 22 });
      expect(open.seen('levels:refused')).toEqual({ levelId: 22, reason: 'locked' });

      const free = boot();
      free.emit('levels:start', { levelId: 6030 });
      expect(free.seen('levels:started', { levelId: 6030 })).toBeTruthy();
    });

    test.each([
      ['no name in copy', { rooms: [{ ...rooms[0]!, id: 'nameless' }] }, /"nameless" has no name/],
      ['ids that overlap the classic path', { rooms: [{ ...rooms[0]!, idBase: 40 }] }, /overlap "classic"/],
      ['ids that overlap another room', { rooms: [rooms[0]!, { ...rooms[1]!, idBase: rooms[0]!.idBase + 5 }] }, /overlap "7x7"/],
      ['the same room twice', { rooms: [rooms[0]!, rooms[0]!] }, /Two rooms are called "7x7"/],
      ['a par above the cell count', { rooms: [{ ...rooms[0]!, bands: [{ pars: nine(1), boss: 50 }] }] }, /par 50, but its board has only 49 cells/],
      ['a ragged picture', { rooms: [{ ...rooms.find((r) => r.kind === 'shape')!, picture: ['XXX', 'XX', 'XXX'] }] }, /same length/],
      ['a level picture past its last level', { rooms: [{ ...rooms[0]!, pictures: [{ at: 31, picture: 'all' }] }] }, /level 31's picture: the pack has only 30 levels/],
      ['a level picture lighting a gap', { rooms: [{ ...rooms.find((r) => r.id === 'ring')!, pictures: [{ at: 5, picture: Array(7).fill('XXXXXXX') }] }] }, /level 5's picture lights a gap/],
      ['a level picture the wrong size', { rooms: [{ ...rooms[0]!, pictures: [{ at: 5, picture: ['XX', 'XX'] }] }] }, /level 5's picture must be 7 rows of 7/],
      ['a level picture that can\'t be solved', { pictures: [{ at: 20, picture: ['X....', '.....', '.....', '.....', '.....'] }] }, /Classic level 20's picture can't be solved/],
    ])('a room with %s stops the game with a plain message', (_, patch, message) => {
      expect(() => boot({ data: withRules(patch) })).toThrow(message);
    });

    test.each([
      ['both a size and a picture', { ...rooms[0]!, picture: ['XXX', 'XXX', 'XXX'] }, /needs cols and rows \(and no picture\)/],
      ['a 21-wide board', { ...rooms[0]!, cols: 21, rows: 8 }, /Invalid value/],
      ['a hex room without a side', { ...rooms.find((r) => r.kind === 'hex')!, side: undefined }, /needs a side/],
      ['stuck cells on a room that isn\'t stuck', { ...rooms[0]!, bands: rooms[0]!.bands.map((b) => ({ ...b, stuck: 2 })) }, /Only a stuck room/],
    ])('data with %s is rejected before init', (_, room, message) => {
      expect(() => boot({ data: withRules({ rooms: [room] }) })).toThrow(message);
    });
  });
});

describe('bosses', () => {
  const st = boot().state('levels') as LevelsState;
  const packIds = ['classic', ...rooms.map((r) => r.id)];
  test.each(packIds)('%s: every 10th level is a boss, at least 1.5× the hardest level in its band', (id) => {
    const list = st.list.filter((l) => (l.pack ?? 'classic') === id);
    expect(list.length % 10).toBe(0);
    list.forEach((l, i) => {
      expect(l.boss === true).toBe((i + 1) % 10 === 0);
      if (!l.boss) return;
      const band = list.slice(i - 9, i);
      expect(l.par).toBeGreaterThanOrEqual(Math.ceil(1.5 * Math.max(...band.map((x) => x.par))));
    });
  });
  test('the level-10 boss says so when it starts', () => {
    const b = boot();
    b.emit('levels:start', { levelId: 10 });
    expect(b.seen('levels:started')).toMatchObject({ levelId: 10, boss: true });
    b.emit('levels:start', { levelId: 9 });
    expect(b.seen('levels:started', { levelId: 9 })).not.toHaveProperty('boss');
  });
});
