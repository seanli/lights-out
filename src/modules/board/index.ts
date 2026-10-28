// board: the rules of the game. Owns the 5×5 grid, presses, undo, restart and solve detection.
import { CELL_COUNT, SIZE, type BoardState, type Cells, type ModuleDef } from '../../contracts';

/** Toggle cell i and its up/down/left/right neighbours in place (no wrap-around). */
function toggleAt(cells: boolean[], i: number): void {
  const row = (i / SIZE) | 0;
  const col = i - row * SIZE;
  cells[i] = !cells[i];
  if (row > 0) cells[i - SIZE] = !cells[i - SIZE];
  if (row < SIZE - 1) cells[i + SIZE] = !cells[i + SIZE];
  if (col > 0) cells[i - 1] = !cells[i - 1];
  if (col < SIZE - 1) cells[i + 1] = !cells[i + 1];
}

function countLit(cells: readonly boolean[]): number {
  let n = 0;
  for (let k = 0; k < CELL_COUNT; k++) if (cells[k]) n++;
  return n;
}

function isBoard(cells: unknown): cells is Cells {
  if (!Array.isArray(cells) || cells.length !== CELL_COUNT) return false;
  for (let k = 0; k < CELL_COUNT; k++) if (typeof cells[k] !== 'boolean') return false;
  return true;
}

const isIndex = (i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < CELL_COUNT;

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
    const off = (): Cells => new Array<boolean>(CELL_COUNT).fill(false);
    ctx.write('board', { status: 'empty', levelId: null, start: off(), cells: off(), par: 0, moves: 0, history: [] });

    const read = () => ctx.read('board')!;

    ctx.on('board:load', (p) => {
      const { levelId, cells, par } = p ?? ({} as typeof p);
      const okId = Number.isInteger(levelId) && levelId >= 1;
      const okPar = typeof par === 'number' && Number.isFinite(par) && par >= 0;
      if (!isBoard(cells) || countLit(cells) === 0 || !okId || !okPar) {
        ctx.log.warn('Refused to load a bad board', { levelId, par, cells });
        ctx.emit('board:refused', { command: 'board:load', reason: 'bad_board' });
        return;
      }
      const fresh = cells.slice();
      ctx.write('board', { status: 'playing', levelId, start: fresh, cells: fresh, par, moves: 0, history: [] });
      ctx.emit('board:loaded', { levelId, cells: fresh, par });
    });

    ctx.on('board:press', (p) => {
      const cur = read();
      if (cur.status !== 'playing') return ctx.emit('board:refused', { command: 'board:press', reason: 'not_playing' });
      const index = p?.index;
      if (!isIndex(index)) {
        ctx.log.warn('Refused a press on a cell that does not exist', { index });
        return ctx.emit('board:refused', { command: 'board:press', reason: 'bad_index' });
      }
      const cells = cur.cells.slice();
      toggleAt(cells, index);
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
      toggleAt(cells, index);
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

    const show = (): string => {
      const b = read();
      const rows: string[] = [];
      for (let r = 0; r < SIZE; r++) {
        let line = '';
        for (let c = 0; c < SIZE; c++) line += (c ? ' ' : '') + (b.cells[r * SIZE + c] ? '#' : '.');
        rows.push(line);
      }
      return `level ${b.levelId ?? '-'} · ${b.status} · moves ${b.moves} · par ${b.par}\n${rows.join('\n')}`;
    };

    return {
      debug: () => ({ lit: countLit(read().cells), grid: show() }),
      commands: {
        /** set 0100011100... : load a 25-char 0/1 board under the current level id (or 1) */
        set(args) {
          const text = (args[0] ?? '').trim();
          if (!/^[01]{25}$/.test(text)) return 'usage: board.set <25 characters of 0/1, row by row>';
          const cells = Array.from(text, (ch) => ch === '1');
          if (countLit(cells) === 0) return 'refused: a board needs at least one lit cell';
          const solution = ctx.service('solver')?.solve(cells);
          ctx.emit('board:load', { levelId: read().levelId ?? 1, cells, par: solution ? solution.length : 0 });
          return solution === null ? `${show()}\n(this board can't be solved)` : show();
        },
        /** presses the solver's fewest-presses solution */
        win() {
          const solver = ctx.service('solver');
          if (!solver) return 'no solver service, so the board cannot solve itself';
          const b = read();
          if (b.status !== 'playing') return `nothing to win: the board is ${b.status}`;
          const solution = solver.solve(b.cells);
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
