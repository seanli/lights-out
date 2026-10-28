// solver: provides the `solver` service (press, fewest-presses solve, solvability) for boards of any shape.
// No slice, no events. Classic 5×5 keeps its table-driven fast path; other shapes are eliminated once and cached.
import type { Cells, ModuleDef, Shape } from '../../contracts';
import { shapeKey } from '../../lib/shape';
import { createGf2 } from './gf2';
import { createShaped, type Shaped } from './shaped';

const solver: ModuleDef = {
  manifest: {
    name: 'solver',
    emits: [],
    listens: [],
    owns: [],
    provides: ['solver'],
  },
  init(ctx) {
    const gf2 = createGf2();
    const byKey = new Map<string, Shaped | null>();
    /** the same frozen shape object comes back on every call from a slice: skip building its key */
    const byObject = new WeakMap<Shape, Shaped | null>();

    /** null = the classic board (fast path) */
    function engine(shape: Shape | undefined): Shaped | null {
      if (!shape) return null;
      const hit = byObject.get(shape);
      if (hit !== undefined) return hit;
      const key = shapeKey(shape);
      let e = byKey.get(key);
      if (e === undefined) {
        e = key === '5x5' ? null : createShaped(shape);
        byKey.set(key, e);
        if (e?.approximate) {
          ctx.log.warn(`Board ${key} has ${2 ** e.nullDim} solutions per board; solve gives a short one, not always the shortest`, { key, nullDim: e.nullDim });
        }
      }
      byObject.set(shape, e);
      return e;
    }

    ctx.provide('solver', {
      press: (cells: Cells, index: number, shape?: Shape) => (engine(shape) ?? gf2).press(cells, index),
      solve: (cells: Cells, shape?: Shape) => (engine(shape) ?? gf2).solve(cells),
      isSolvable: (cells: Cells, shape?: Shape) => (engine(shape) ?? gf2).isSolvable(cells),
    });
    return {
      debug: () => ({
        rank: gf2.rank,
        solutionsPerBoard: gf2.nulls.length,
        shapes: [...byKey].map(([key, e]) => (e ? { key, cells: e.cells, rank: e.rank, nullDim: e.nullDim } : { key })),
      }),
      commands: {
        /** solve the board that's showing */
        solve() {
          const board = ctx.read('board');
          if (!board || board.status === 'empty') return 'No board is loaded';
          const s = (engine(board.shape) ?? gf2).solve(board.cells);
          return s ? `${s.length} presses: ${s.join(', ')}` : 'This board cannot be solved';
        },
      },
    };
  },
};
export default solver;
