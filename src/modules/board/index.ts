// board: the rules of the game. Owns the grid (classic 5×5 or any Variety shape), presses, undo, restart and solve detection.
import * as v from 'valibot';
import { CLASSIC_SHAPE, ShapeSchema, type BoardState, type Cells, type ModuleDef, type Shape } from '../../contracts';
import { emptyCells, fitsShape, gridSize, isCell, pressTargets, sameShape, shapeOf } from '../../lib/shape';

/** Toggle what a press at i reaches (i and its up/down/left/right neighbours that are real cells), in place. */
function toggleAt(shape: Shape, cells: boolean[], i: number): void {
  for (const t of pressTargets(shape, i)) cells[t] = !cells[t];
}

function countLit(cells: readonly boolean[]): number {
  let n = 0;
  for (let k = 0; k < cells.length; k++) if (cells[k]) n++;
  return n;
}

function isBoard(cells: unknown, shape: Shape): cells is Cells {
  if (!Array.isArray(cells) || cells.length !== gridSize(shape)) return false;
  for (let k = 0; k < cells.length; k++) if (typeof cells[k] !== 'boolean') return false;
  return fitsShape(shape, cells);
}

/** a shape from a payload: absent = classic; anything that fails the schema (or a mask of the wrong length) = null */
function readShape(raw: unknown): Shape | null {
  if (raw === undefined) return CLASSIC_SHAPE;
  const parsed = v.safeParse(ShapeSchema, raw);
  if (!parsed.success) return null;
  const s = parsed.output;
  if (s.mask && s.mask.length !== s.cols * s.rows) return null;
  return s;
}

const board: ModuleDef = {
  manifest: {
    name: 'board',
    emits: ['board:loaded', 'board:pressed', 'board:undone', 'board:restarted', 'board:solved', 'board:refused', 'board:load', 'board:press'],
    listens: ['board:load', 'board:press', 'board:undo', 'board:restart'],
    owns: ['board'],
    /** only the console commands use it (par for `set`, the solution for `win`) */
    optional: ['solver'],
  },
  init(ctx) {
    const off = (): Cells => emptyCells(CLASSIC_SHAPE);
    ctx.write('board', { status: 'empty', levelId: null, start: off(), cells: off(), par: 0, moves: 0, history: [] });

    const read = () => ctx.read('board')!;
    const shapeNow = () => shapeOf(read().shape);

    ctx.on('board:load', (p) => {
      const { levelId, cells, par } = p ?? ({} as typeof p);
      const shape = readShape(p?.shape);
      const okId = Number.isInteger(levelId) && levelId >= 1;
      const okPar = typeof par === 'number' && Number.isFinite(par) && par >= 0;
      if (!shape || !isBoard(cells, shape) || countLit(cells) === 0 || !okId || !okPar) {
        ctx.log.warn('Refused to load a bad board', { levelId, par, cells, shape: p?.shape });
        ctx.emit('board:refused', { command: 'board:load', reason: 'bad_board' });
        return;
      }
      const fresh = cells.slice();
      // the classic board stores no shape, so classic snapshots and payloads stay exactly as before
      const classic = sameShape(shape, CLASSIC_SHAPE);
      const extra = classic ? {} : { shape };
      ctx.write('board', { status: 'playing', levelId, start: fresh, cells: fresh, par, moves: 0, history: [], ...extra });
      ctx.emit('board:loaded', { levelId, cells: fresh, par, ...extra });
    });

    ctx.on('board:press', (p) => {
      const cur = read();
      if (cur.status !== 'playing') return ctx.emit('board:refused', { command: 'board:press', reason: 'not_playing' });
      const index = p?.index;
      const shape = shapeOf(cur.shape);
      if (typeof index !== 'number' || !isCell(shape, index)) {
        ctx.log.warn('Refused a press on a cell that does not exist', { index });
        return ctx.emit('board:refused', { command: 'board:press', reason: 'bad_index' });
      }
      const cells = cur.cells.slice();
      toggleAt(shape, cells, index);
      const litCount = countLit(cells);
      const moves = cur.moves + 1;
      const levelId = cur.levelId!;
      const next: BoardState = { ...cur, status: litCount === 0 ? 'solved' : 'playing', cells, moves, history: [...cur.history, index] };
      ctx.write('board', next);
      ctx.emit('board:pressed', { levelId, index, cells, moves, litCount });
      if (litCount === 0) ctx.emit('board:solved', { levelId, moves, par: cur.par });
    });

    ctx.on('board:undo', () => {
      const cur = read();
      if (cur.status !== 'playing') return ctx.emit('board:refused', { command: 'board:undo', reason: 'not_playing' });
      const n = cur.history.length;
      if (n === 0) return ctx.emit('board:refused', { command: 'board:undo', reason: 'nothing_to_undo' });
      const index = cur.history[n - 1]!;
      const cells = cur.cells.slice();
      toggleAt(shapeOf(cur.shape), cells, index);
      const moves = Math.max(0, cur.moves - 1);
      ctx.write('board', { ...cur, cells, moves, history: cur.history.slice(0, -1) });
      ctx.emit('board:undone', { levelId: cur.levelId!, index, cells, moves });
    });

    ctx.on('board:restart', () => {
      const cur = read();
      if (cur.status === 'empty') return ctx.emit('board:refused', { command: 'board:restart', reason: 'not_playing' });
      ctx.write('board', { ...cur, status: 'playing', cells: cur.start, moves: 0, history: [] });
      ctx.emit('board:restarted', { levelId: cur.levelId!, cells: cur.start });
    });

    /** '#' lit, '.' off, ' ' a gap */
    const show = (): string => {
      const b = read();
      const shape = shapeOf(b.shape);
      const rows: string[] = [];
      for (let r = 0; r < shape.rows; r++) {
        let line = '';
        for (let c = 0; c < shape.cols; c++) {
          const i = r * shape.cols + c;
          line += (c ? ' ' : '') + (!isCell(shape, i) ? ' ' : b.cells[i] ? '#' : '.');
        }
        rows.push(line.trimEnd());
      }
      const size = b.shape ? ` · ${shape.cols}×${shape.rows}` : '';
      return `level ${b.levelId ?? '-'} · ${b.status} · moves ${b.moves} · par ${b.par}${size}\n${rows.join('\n')}`;
    };

    return {
      debug: () => ({ lit: countLit(read().cells), grid: show() }),
      commands: {
        /** set 0100011100... : load a 0/1 board (one char per grid position, row by row) on the current shape, under the current level id (or 1) */
        set(args) {
          const shape = shapeNow();
          const size = gridSize(shape);
          const text = (args[0] ?? '').trim();
          if (!new RegExp(`^[01]{${size}}$`).test(text)) return `usage: board.set <${size} characters of 0/1, row by row> (the current board is ${shape.cols}×${shape.rows})`;
          const cells = Array.from(text, (ch) => ch === '1');
          if (countLit(cells) === 0) return 'refused: a board needs at least one lit cell';
          if (!fitsShape(shape, cells)) return 'refused: a gap can never be lit';
          const solution = ctx.service('solver')?.solve(cells, read().shape);
          const s = read().shape;
          ctx.emit('board:load', { levelId: read().levelId ?? 1, cells, par: solution ? solution.length : 0, ...(s ? { shape: s } : {}) });
          return solution === null ? `${show()}\n(this board can't be solved)` : show();
        },
        /** presses the solver's fewest-presses solution */
        win() {
          const solver = ctx.service('solver');
          if (!solver) return 'no solver service, so the board cannot solve itself';
          const b = read();
          if (b.status !== 'playing') return `nothing to win: the board is ${b.status}`;
          const solution = solver.solve(b.cells, b.shape);
          if (!solution) return "this board can't be solved";
          for (const index of solution) ctx.emit('board:press', { index });
          return `pressed ${solution.join(', ')}\n${show()}`;
        },
        show,
      },
    };
  },
};
export default board;
