// solver: provides the `solver` service (press, fewest-presses solve, solvability). No slice, no events.
import type { ModuleDef } from '../../contracts';
import { createGf2 } from './gf2';

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
    ctx.provide('solver', { press: gf2.press, solve: gf2.solve, isSolvable: gf2.isSolvable });
    return {
      debug: () => ({ rank: gf2.rank, solutionsPerBoard: gf2.nulls.length }),
      commands: {
        /** solve the board that's showing */
        solve() {
          const board = ctx.read('board');
          if (!board || board.status === 'empty') return 'No board is loaded';
          const s = gf2.solve(board.cells);
          return s ? `${s.length} presses: ${s.join(', ')}` : 'This board cannot be solved';
        },
      },
    };
  },
};
export default solver;
