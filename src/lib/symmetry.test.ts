import { describe, expect, it } from 'vitest';
import { CLASSIC_SHAPE, type Shape } from '../contracts';
import { WIRINGS } from './puzzle';
import { cubeShape } from './cube';
import { cellIndexes, hexagonShape, parseShape } from './shape';
import { isPinwheel, orbits, symmetries, symmetriesOfBoard, symmetryNamed } from './symmetry';

const names = (s: Shape) => symmetries(s).map((x) => x.name);

describe('symmetries', () => {
  it('a square board has every square symmetry; a long one only the mirrors and the half turn', () => {
    expect(names(CLASSIC_SHAPE)).toEqual(['mirror', 'flip', 'turn', 'both', 'diagonal', 'full']);
    expect(names({ cols: 6, rows: 5, mask: null })).toEqual(['mirror', 'flip', 'turn', 'both']);
  });

  it('a hexagon of hexagons has its mirrors and every turn', () => {
    const hex = hexagonShape(4);
    expect(names(hex)).toEqual(['mirror', 'flip', 'turn', 'both', 'third', 'full']);
    // 37 cells under every turn and mirror: the centre alone, then orbits of six and twelve
    expect(orbits(symmetryNamed(hex, 'full')!, cellIndexes(hex)).map((o) => o.length).sort((a, b) => a - b)).toEqual([1, 6, 6, 6, 6, 12]);
  });

  it('a cube has its mirrors, turns and the turns about a corner; every light lands on a light', () => {
    const cube = cubeShape(3);
    expect(names(cube)).toEqual(['mirror', 'flip', 'turn', 'both', 'diagonal', 'third', 'full']);
    // 54 lights under all 48: the six face centres, the 24 edge lights, the 24 corner lights
    expect(orbits(symmetryNamed(cube, 'full')!, cellIndexes(cube)).map((o) => o.length).sort((a, b) => a - b)).toEqual([6, 24, 24]);
  });

  it('every map carries the real cells onto the real cells, one to one', () => {
    for (const s of [CLASSIC_SHAPE, cubeShape(3), cubeShape(4), hexagonShape(3), hexagonShape(4), parseShape(['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'])]) {
      const real = cellIndexes(s);
      for (const sym of symmetries(s)) for (const m of sym.maps) expect(real.map((i) => m[i]).sort((a, b) => a! - b!)).toEqual(real);
    }
  });

  it('gaps and stuck cells must land on their own kind', () => {
    const ring = parseShape(['XXXXX', 'XX.XX', 'XXXXX', 'XXXXX', 'XXXXX']);
    expect(names(ring)).toEqual(['mirror']);
    expect(names({ ...CLASSIC_SHAPE, stuck: [6, 8] })).toEqual(['mirror']);
    expect(names({ ...CLASSIC_SHAPE, stuck: [6, 8, 16, 18] })).toEqual(['mirror', 'flip', 'turn', 'both', 'diagonal', 'full']);
  });

  it('wiring turns with the board: a tee pointing left mirrors into one pointing right', () => {
    const plus = new Array<number>(25).fill(WIRINGS.plus);
    expect(names({ ...CLASSIC_SHAPE, wires: plus }).length).toBe(6);
    const tee = [...plus];
    tee[12] = WIRINGS.teeLeft;
    expect(names({ ...CLASSIC_SHAPE, wires: tee })).toEqual(['flip']);
    const pair = [...plus];
    pair[11] = WIRINGS.teeLeft;
    pair[13] = WIRINGS.teeRight;
    expect(names({ ...CLASSIC_SHAPE, wires: pair })).toContain('mirror');
    // full's second element is the quarter turn
    expect(symmetryNamed(CLASSIC_SHAPE, 'full')!.wires![1]!(WIRINGS.across)).toBe(WIRINGS.updown);
  });

  it('reads which symmetries a board shows', () => {
    const all = new Array<boolean>(25).fill(true);
    expect(symmetriesOfBoard(CLASSIC_SHAPE, all).length).toBe(6);
    const left = all.map((_, i) => i % 5 === 0);
    expect(symmetriesOfBoard(CLASSIC_SHAPE, left)).toEqual(['flip']);
  });

  it('spots a pinwheel, whole or inside a bigger board, and lets mirrored patterns be', () => {
    const board = (rows: string[]) => rows.join('').split('').map((ch) => ch === 'X');
    const wheel = ['..XX.', 'X.X..', 'XXXXX', '..X.X', '.XX..'];
    expect(isPinwheel(CLASSIC_SHAPE, board(wheel))).toBe(true);
    // the same arms inside a 7×7
    const big = ['.......', ...wheel.map((r) => `.${r}.`), '.......'];
    expect(isPinwheel({ cols: 7, rows: 7, mask: null }, board(big))).toBe(true);
    // a plus, a ring, a checkerboard: turned and mirrored alike
    expect(isPinwheel(CLASSIC_SHAPE, board(['..X..', '..X..', 'XXXXX', '..X..', '..X..']))).toBe(false);
    expect(isPinwheel(CLASSIC_SHAPE, board(['.XXX.', 'X...X', 'X...X', 'X...X', '.XXX.']))).toBe(false);
    expect(isPinwheel(CLASSIC_SHAPE, board(['X.X.X', '.X.X.', 'X.X.X', '.X.X.', 'X.X.X']))).toBe(false);
    // a honeycomb: three arms turning one way, then the same with their mirror images added
    const hex = hexagonShape(4);
    const real = cellIndexes(hex);
    const full = symmetryNamed(hex, 'full')!.maps;
    const arms = new Array<boolean>(hex.cols * hex.rows).fill(false);
    // full's elements: turn by k·60°, then that turn mirrored; elements 0, 4, 8 turn by 0°, 120°, 240°
    for (const e of [0, 4, 8]) for (const k of [1, 5]) arms[full[e]![real[k]!]!] = true;
    expect(symmetriesOfBoard(hex, arms)).toEqual([]);
    expect(isPinwheel(hex, arms)).toBe(true);
    const third = symmetryNamed(hex, 'third')!;
    const trefoil = arms.map((_, i) => third.maps.some((m) => arms[m[i]!]));
    expect(isPinwheel(hex, trefoil)).toBe(false);
  });
});
