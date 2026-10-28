// hints: picks one cell of a fewest-presses solution and shows it until the board changes.
// The star cost belongs to progress (it counts hints:shown).
import * as v from 'valibot';
import type { HintsState, ModuleDef } from '../../contracts';

const IDLE: HintsState = { status: 'idle', levelId: null, cell: null };

const hints: ModuleDef = {
  manifest: {
    name: 'hints',
    emits: ['hints:shown', 'hints:cleared', 'hints:refused'],
    listens: ['hints:request', 'board:pressed', 'board:undone', 'board:restarted', 'board:loaded', 'board:solved'],
    owns: ['hints'],
    uses: ['solver', 'rng'],
    data: {
      rules: v.object({ choice: v.picklist(['random', 'first']) }),
      flags: v.object({ enabled: v.boolean() }),
    },
  },
  init(ctx) {
    if (!ctx.data.flags.enabled) {
      ctx.log.info('Hints are switched off in flags.json');
      return;
    }
    const solver = ctx.need('solver');
    const rng = ctx.need('rng');
    const choice: 'random' | 'first' = ctx.data.rules.choice;
    ctx.write('hints', IDLE);

    ctx.on('hints:request', () => {
      const board = ctx.read('board');
      if (board?.status !== 'playing' || board.levelId === null) return ctx.emit('hints:refused', { reason: 'not_playing' });
      if (ctx.read('hints')?.status === 'showing') return ctx.emit('hints:refused', { reason: 'already_showing' });
      const solution = solver.solve(board.cells);
      if (!solution || solution.length === 0) {
        ctx.log.warn('No hint: the solver found no way to clear this board', { levelId: board.levelId, cells: board.cells });
        return ctx.emit('hints:refused', { reason: 'unsolvable' });
      }
      const cell = choice === 'first' ? Math.min(...solution) : rng.pick(solution);
      ctx.write('hints', { status: 'showing', levelId: board.levelId, cell });
      ctx.emit('hints:shown', { levelId: board.levelId, index: cell });
    });

    type Reason = 'pressed' | 'level_changed' | 'undone' | 'restarted' | 'solved';
    const clear = (reason: Reason) => {
      if (ctx.read('hints')?.status !== 'showing') return;
      ctx.write('hints', IDLE);
      ctx.emit('hints:cleared', { reason });
    };
    // board:pressed always arrives before board:solved, so the winning press reports 'solved' itself
    ctx.on('board:pressed', ({ litCount }) => clear(litCount === 0 ? 'solved' : 'pressed'));
    ctx.on('board:solved', () => clear('solved'));
    ctx.on('board:undone', () => clear('undone'));
    ctx.on('board:restarted', () => clear('restarted'));
    ctx.on('board:loaded', () => clear('level_changed'));

    return { debug: () => ({ choice, hint: ctx.read('hints') }) };
  },
};
export default hints;
