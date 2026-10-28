import { describe, expect, test } from 'vitest';
import { FACES, IDENTITY, apply, cellCentre, cellFace, cubeNeighbours, cubeShape, facesShowing, frontFace, isCubeNet, turn, type Mat } from './cube';
import { cellCount, cellIndexes, hexagonShape, isPressable, pressTargets, shapeKey, shapeProblem, touching, PLUS_WIRES } from './shape';

const at = (n: number, face: string, a: number, b: number) => {
  const f = FACES.find((x) => x.id === face)!;
  return (f.by * n + b) * 3 * n + f.bx * n + a;
};

describe('cube geometry', () => {
  test('the net holds six faces of n×n and is recognised as a cube', () => {
    for (const n of [3, 4]) {
      const s = cubeShape(n);
      expect(cellCount(s)).toBe(6 * n * n);
      expect(isCubeNet(s)).toBe(true);
      expect(shapeProblem(s)).toBeNull();
    }
    expect(isCubeNet({ ...cubeShape(3), mask: cubeShape(3).mask!.map((m, i) => (i === 3 ? !m : m)) })).toBe(false);
  });

  test('every light touches exactly four others, and touching is mutual', () => {
    for (const n of [2, 3, 4]) {
      const nb = cubeNeighbours(n);
      for (const i of cellIndexes(cubeShape(n))) {
        expect(nb[i]).toHaveLength(4);
        for (const j of nb[i]!) expect(nb[j]).toContain(i);
      }
    }
  });

  test('a press reaches round the edges: the front face\'s top-left corner touches the up and left faces', () => {
    const n = 3;
    const s = cubeShape(n);
    const corner = at(n, 'front', 0, 0);
    const reach = pressTargets(s, corner);
    expect(reach).toContain(at(n, 'front', 1, 0));
    expect(reach).toContain(at(n, 'front', 0, 1));
    expect(reach).toContain(at(n, 'up', 0, n - 1)); // the up face's bottom row meets the front's top row
    expect(reach).toContain(at(n, 'left', n - 1, 0)); // the left face's right column meets the front's left column
    // the back face folds under the down face: their shared edge is down's last row and back's first row
    expect(pressTargets(s, at(n, 'down', 1, n - 1))).toContain(at(n, 'back', 1, 0));
    // and the back's last row meets the up face's first row
    expect(pressTargets(s, at(n, 'back', 1, n - 1))).toContain(at(n, 'up', 1, 0));
  });

  test('each face frame is right-handed (u × v = outward normal), so faces show their front side', () => {
    for (const f of FACES) {
      const [u, v] = [f.u, f.v];
      expect([u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]].map((x) => x + 0)).toEqual([...f.n].map((x) => x + 0));
    }
    expect(cellFace(3, at(3, 'right', 2, 1))).toMatchObject({ a: 2, b: 1 });
    expect(cellCentre(3, at(3, 'front', 1, 1))).toEqual([0, 0, 1.5]);
  });

  test('quarter turns: four of any turn come back, and frontFace brings each face to the front', () => {
    for (const d of ['left', 'right', 'up', 'down'] as const) {
      let m: Mat = IDENTITY;
      for (let k = 0; k < 4; k++) m = turn(m, d);
      expect(m).toEqual(IDENTITY);
    }
    for (const f of FACES) expect(apply(frontFace(f.id), f.n)).toEqual([0, 0, 1]);
    // a swipe left brings the right face to the front
    expect(apply(turn(IDENTITY, 'left'), [1, 0, 0])).toEqual([0, 0, 1]);
  });

  test('the tilted view shows the front, the top and the right side', () => {
    expect(facesShowing(IDENTITY, -30, -35).sort()).toEqual(['front', 'right', 'up']);
    expect(facesShowing(turn(IDENTITY, 'left'), -30, -35)).toContain('right');
  });
});

describe('honeycomb and twists', () => {
  test('hexagons of side 3, 4, 5 hold 19, 37 and 61 lights; inner lights touch six', () => {
    for (const [side, lights] of [[3, 19], [4, 37], [5, 61]] as const) {
      const s = hexagonShape(side);
      expect(cellCount(s)).toBe(lights);
      const six = cellIndexes(s).filter((i) => touching(s, i).length === 6).length;
      expect(six).toBe(3 * (side - 1) * (side - 2) + 1); // the inner hexagon of side − 1
      for (const i of cellIndexes(s)) for (const j of touching(s, i)) expect(touching(s, j)).toContain(i);
    }
  });

  test('wiring decides what a press flips; the plus wiring is the classic press', () => {
    const plain = { cols: 3, rows: 3, mask: null };
    const plus = { ...plain, wires: new Array(9).fill(PLUS_WIRES) };
    for (let i = 0; i < 9; i++) expect([...pressTargets(plus, i)].sort()).toEqual([...pressTargets(plain, i)].sort());
    const diag = { ...plain, wires: new Array(9).fill(0b10101010) }; // the four corners
    expect([...pressTargets(diag, 4)].sort()).toEqual([0, 2, 4, 6, 8]);
    expect(pressTargets({ ...plain, wires: new Array(9).fill(0) }, 4)).toEqual([4]);
    expect(shapeKey(diag)).not.toBe(shapeKey(plain));
  });

  test('a stuck cell has no press of its own but is still reached by its neighbours', () => {
    const s = { cols: 4, rows: 4, mask: null, stuck: [5] };
    expect(isPressable(s, 5)).toBe(false);
    expect(pressTargets(s, 5)).toEqual([]);
    expect(pressTargets(s, 4)).toContain(5);
    expect(shapeProblem({ ...s, stuck: [5, 5] })).toMatch(/twice/);
    expect(shapeProblem({ cols: 3, rows: 3, mask: null, grid: 'hex', wires: new Array(9).fill(1) })).toMatch(/square/);
  });
});
